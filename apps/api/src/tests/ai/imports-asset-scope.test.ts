/**
 * AI-08 / P2: an import's asset source must belong to the batch's tenant
 * (real SQL via bun:sqlite).
 *
 * Breakage hypotheses:
 * - H1 tenant A attaches tenant B's asset id to its own import batch.
 * - H2 a soft-deleted asset of the same tenant is still accepted.
 * - H3 an empty or unknown asset id is stored as a "ready" source.
 */
import { describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import type { Database } from '@/database/db'
import type { Env } from '@/env'
import { aiImportSources, assets } from '@/database/schema'
import { aiImportService } from '@/ai/imports.service'
import { aiImportsRepository } from '@/ai/imports.repository'
import { createSqliteD1 } from '../helpers/sqlite-d1'

const NOW = '2026-11-01T00:00:00.000Z'

async function setup() {
  const { d1 } = createSqliteD1()
  const db = drizzle(d1) as unknown as Database
  const env = { MEDIA: { put: async () => null, delete: async () => undefined } } as unknown as Env
  for (const [id, tenantId, deletedAt] of [
    ['asset-a', 'tenant-a', null],
    ['asset-b', 'tenant-b', null],
    ['asset-a-deleted', 'tenant-a', NOW],
  ] as const) {
    await db.insert(assets).values({
      id,
      tenantId,
      filename: `${id}.png`,
      mimeType: 'image/png',
      size: 10,
      originalKey: `${tenantId}/assets/${id}.png`,
      deletedAt,
      createdAt: NOW,
      updatedAt: NOW,
    })
  }
  const batch = await aiImportsRepository.createBatch(db, {
    id: 'batch-a',
    tenantId: 'tenant-a',
    createdByUserId: 'user-a',
    status: 'draft',
    intent: 'import',
    createdAt: NOW,
    updatedAt: NOW,
  })
  return { db, env, batch }
}

async function sourceCount(db: Database) {
  return (await db.select().from(aiImportSources).where(eq(aiImportSources.batchId, 'batch-a')).all())
    .length
}

describe('AI import asset sources are tenant-scoped (AI-08, P2)', () => {
  it('H1: rejects another tenant’s asset id and stores no source', async () => {
    const { db, env } = await setup()
    await expect(
      aiImportService.addSource(db, env, 'batch-a', { kind: 'asset', existingAssetId: 'asset-b' }, 'tenant-a')
    ).rejects.toThrow('Asset was not found')
    expect(await sourceCount(db)).toBe(0)
  })

  it('H2: rejects a soft-deleted asset of the same tenant', async () => {
    const { db, env } = await setup()
    await expect(
      aiImportService.addSource(
        db,
        env,
        'batch-a',
        { kind: 'asset', existingAssetId: 'asset-a-deleted' },
        'tenant-a'
      )
    ).rejects.toThrow('Asset was not found')
    expect(await sourceCount(db)).toBe(0)
  })

  it('H3: rejects an empty or unknown asset id', async () => {
    const { db, env } = await setup()
    for (const existingAssetId of ['', 'missing']) {
      await expect(
        aiImportService.addSource(db, env, 'batch-a', { kind: 'asset', existingAssetId }, 'tenant-a')
      ).rejects.toThrow('Asset was not found')
    }
    expect(await sourceCount(db)).toBe(0)
  })

  it('accepts the tenant’s own asset', async () => {
    const { db, env } = await setup()
    const source = await aiImportService.addSource(
      db,
      env,
      'batch-a',
      { kind: 'asset', existingAssetId: 'asset-a' },
      'tenant-a'
    )
    expect(source.existingAssetId).toBe('asset-a')
    expect(source.tenantId).toBe('tenant-a')
    expect(await sourceCount(db)).toBe(1)
  })
})
