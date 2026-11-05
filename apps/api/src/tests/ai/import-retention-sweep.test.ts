/**
 * AI-08 retention cleanup for import review records (real SQL via bun:sqlite).
 *
 * Breakage hypotheses:
 * - H1 an expired file source keeps its R2 object and extracted text forever.
 * - H2 the sweep touches sources or batches that have not expired yet.
 * - H3 a stored R2 key outside the row's own tenant/batch prefix (corrupt or
 *      forged row) makes the sweep delete another tenant's object.
 * - H4 a failed R2 delete marks the source purged, so the object leaks.
 * - H5 one run deletes an unbounded number of rows or objects.
 * - H6 an expired batch's suggestion sets, suggestions and tool invocations
 *      survive, or another tenant's still-live batch is deleted with it.
 * - H7 the cron entry point throws and aborts the other scheduled sweeps.
 */
import { describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import type { Database } from '@/database/db'
import type { Env } from '@/env'
import {
  aiImportBatches,
  aiImportSources,
  aiSuggestionSets,
  aiSuggestions,
  aiToolInvocations,
} from '@/database/schema'
import { purgeExpiredAiImports, runScheduledAiImportCleanup } from '@/ai/import-retention-sweep'
import { createSqliteD1 } from '../helpers/sqlite-d1'

const NOW = new Date('2026-11-05T00:00:00.000Z')
const LONG_AGO = '2026-09-01T00:00:00.000Z' // > 30 days before NOW
const RECENT = '2026-11-01T00:00:00.000Z'
const EXPIRED = '2026-10-01T00:00:00.000Z'
const FUTURE = '2026-12-01T00:00:00.000Z'

function setup() {
  const { d1 } = createSqliteD1()
  const db = drizzle(d1) as unknown as Database
  return { d1, db }
}

function fakeR2(opts: { failKeys?: string[] } = {}) {
  const deleted: string[] = []
  return {
    deleted,
    bucket: {
      delete: async (key: string) => {
        if (opts.failKeys?.includes(key)) throw new Error('r2 down')
        deleted.push(key)
      },
    } as unknown as R2Bucket,
  }
}

async function insertBatch(db: Database, id: string, tenantId: string, updatedAt = LONG_AGO) {
  await db.insert(aiImportBatches).values({
    id,
    tenantId,
    createdByUserId: 'user',
    status: 'ready_for_review',
    intent: 'import',
    createdAt: updatedAt,
    updatedAt,
  })
}

async function insertFileSource(
  db: Database,
  id: string,
  batchId: string,
  tenantId: string,
  expiresAt: string,
  r2ObjectKey = `${tenantId}/ai-imports/${batchId}/${id}/posts.csv`
) {
  await db.insert(aiImportSources).values({
    id,
    batchId,
    tenantId,
    kind: 'file',
    filename: 'posts.csv',
    r2ObjectKey,
    extractionStatus: 'ready',
    extractedText: 'secret draft text',
    expiresAt,
    createdAt: LONG_AGO,
  })
}

async function sourceRow(db: Database, id: string) {
  return (await db.select().from(aiImportSources).where(eq(aiImportSources.id, id)).all())[0]
}

async function batchExists(db: Database, id: string) {
  return (await db.select().from(aiImportBatches).where(eq(aiImportBatches.id, id)).all()).length === 1
}

describe('AI import retention cleanup (AI-08)', () => {
  it('H1: deletes an expired source’s R2 object and clears its stored text', async () => {
    const { db } = setup()
    const r2 = fakeR2()
    await insertBatch(db, 'b1', 'tenant-a', RECENT)
    await insertFileSource(db, 's1', 'b1', 'tenant-a', EXPIRED)

    const result = await purgeExpiredAiImports(db, r2.bucket, { now: NOW })

    expect(r2.deleted).toEqual(['tenant-a/ai-imports/b1/s1/posts.csv'])
    const row = await sourceRow(db, 's1')
    expect(row?.purgedAt).toBe(NOW.toISOString())
    expect(row?.extractedText).toBeNull()
    expect(row?.purgeAuditJson).toMatchObject({ r2: 'deleted' })
    expect(result.sourcesPurged).toBe(1)
    // Batch updated recently: kept until it is itself past retention.
    expect(await batchExists(db, 'b1')).toBe(true)
  })

  it('H2: leaves unexpired sources and recently updated batches alone', async () => {
    const { db } = setup()
    const r2 = fakeR2()
    await insertBatch(db, 'b-live', 'tenant-a', RECENT)
    await insertFileSource(db, 's-live', 'b-live', 'tenant-a', FUTURE)
    await insertBatch(db, 'b-old-live-source', 'tenant-a', LONG_AGO)
    await insertFileSource(db, 's-live-2', 'b-old-live-source', 'tenant-a', FUTURE)

    const result = await purgeExpiredAiImports(db, r2.bucket, { now: NOW })

    expect(r2.deleted).toEqual([])
    expect((await sourceRow(db, 's-live'))?.purgedAt).toBeNull()
    expect((await sourceRow(db, 's-live-2'))?.extractedText).toBe('secret draft text')
    expect(await batchExists(db, 'b-live')).toBe(true)
    expect(await batchExists(db, 'b-old-live-source')).toBe(true)
    expect(result).toMatchObject({ sourcesPurged: 0, batchesDeleted: 0 })
  })

  it('H3: never deletes an R2 key outside the row’s own tenant/batch prefix', async () => {
    const { db } = setup()
    const r2 = fakeR2()
    await insertBatch(db, 'b1', 'tenant-a', RECENT)
    await insertFileSource(db, 's-forged', 'b1', 'tenant-a', EXPIRED, 'tenant-b/ai-imports/b9/s9/x.csv')
    await insertFileSource(db, 's-asset', 'b1', 'tenant-a', EXPIRED, 'tenant-a/assets/photo.png')
    await insertFileSource(db, 's-other-batch', 'b1', 'tenant-a', EXPIRED, 'tenant-a/ai-imports/b2/s/x.csv')

    const result = await purgeExpiredAiImports(db, r2.bucket, { now: NOW })

    expect(r2.deleted).toEqual([])
    expect(result.r2Skipped).toBe(3)
    for (const id of ['s-forged', 's-asset', 's-other-batch']) {
      const row = await sourceRow(db, id)
      // Row content is still purged; only the foreign object is left alone.
      expect(row?.extractedText).toBeNull()
      expect(row?.purgeAuditJson).toMatchObject({ r2: 'skipped_prefix_mismatch' })
    }
  })

  it('H4: a failed R2 delete leaves the source unpurged for the next run', async () => {
    const { db } = setup()
    const key = 'tenant-a/ai-imports/b1/s1/posts.csv'
    await insertBatch(db, 'b1', 'tenant-a', LONG_AGO)
    await insertFileSource(db, 's1', 'b1', 'tenant-a', EXPIRED)

    const first = await purgeExpiredAiImports(db, fakeR2({ failKeys: [key] }).bucket, { now: NOW })
    expect(first.r2Failed).toBe(1)
    expect((await sourceRow(db, 's1'))?.purgedAt).toBeNull()
    expect(await batchExists(db, 'b1')).toBe(true)

    const r2 = fakeR2()
    const second = await purgeExpiredAiImports(db, r2.bucket, { now: NOW })
    expect(r2.deleted).toEqual([key])
    expect(second.batchesDeleted).toBe(1)
  })

  it('H5: purges at most the configured number of sources and batches per run', async () => {
    const { db } = setup()
    const r2 = fakeR2()
    for (let i = 0; i < 5; i++) {
      await insertBatch(db, `b${i}`, 'tenant-a', LONG_AGO)
      await insertFileSource(db, `s${i}`, `b${i}`, 'tenant-a', EXPIRED)
    }

    const result = await purgeExpiredAiImports(db, r2.bucket, {
      now: NOW,
      sourceLimit: 2,
      batchLimit: 1,
    })

    expect(r2.deleted).toHaveLength(2)
    expect(result.sourcesPurged).toBe(2)
    expect(result.batchesDeleted).toBe(1)
    const remaining = await db.select().from(aiImportBatches).all()
    expect(remaining).toHaveLength(4)
  })

  it('H6: deletes an expired batch with all its review records, but not another tenant’s', async () => {
    const { db } = setup()
    const r2 = fakeR2()
    await insertBatch(db, 'b-a', 'tenant-a', LONG_AGO)
    await insertFileSource(db, 's-a', 'b-a', 'tenant-a', EXPIRED)
    await db.insert(aiSuggestionSets).values({
      id: 'set-a',
      batchId: 'b-a',
      tenantId: 'tenant-a',
      status: 'ready',
      createdAt: LONG_AGO,
      updatedAt: LONG_AGO,
    })
    await db.insert(aiSuggestions).values({
      id: 'sug-a',
      suggestionSetId: 'set-a',
      tenantId: 'tenant-a',
      operation: 'create_entry',
      createdAt: LONG_AGO,
      updatedAt: LONG_AGO,
    })
    await db.insert(aiToolInvocations).values({
      id: 'inv-a',
      tenantId: 'tenant-a',
      batchId: 'b-a',
      toolName: 'cms.searchEntries',
      status: 'success',
      createdAt: LONG_AGO,
    })
    // Same age, other tenant, but its source has not expired.
    await insertBatch(db, 'b-b', 'tenant-b', LONG_AGO)
    await insertFileSource(db, 's-b', 'b-b', 'tenant-b', FUTURE)

    const result = await purgeExpiredAiImports(db, r2.bucket, { now: NOW })

    expect(result.batchesDeleted).toBe(1)
    expect(await batchExists(db, 'b-a')).toBe(false)
    expect(await sourceRow(db, 's-a')).toBeUndefined()
    expect(await db.select().from(aiSuggestionSets).all()).toHaveLength(0)
    expect(await db.select().from(aiSuggestions).all()).toHaveLength(0)
    expect(await db.select().from(aiToolInvocations).all()).toHaveLength(0)
    expect(await batchExists(db, 'b-b')).toBe(true)
    expect((await sourceRow(db, 's-b'))?.extractedText).toBe('secret draft text')
    expect(r2.deleted).toEqual(['tenant-a/ai-imports/b-a/s-a/posts.csv'])
  })

  it('H7: the cron entry point never throws', async () => {
    expect(await runScheduledAiImportCleanup(undefined)).toBeNull()
    const broken = {
      DB: { prepare: () => { throw new Error('d1 down') } },
      MEDIA: fakeR2().bucket,
    } as unknown as Env
    expect(await runScheduledAiImportCleanup(broken)).toBeNull()

    const { d1 } = setup()
    const r2 = fakeR2()
    const ok = await runScheduledAiImportCleanup({ DB: d1, MEDIA: r2.bucket } as unknown as Env)
    expect(ok).toMatchObject({ sourcesPurged: 0, batchesDeleted: 0 })
  })
})
