/**
 * OF-04: a sync push VERSION_CONFLICT lists only the fields changed on both sides
 * relative to the version the client started from (optimisticVersion), read from the
 * entry_versions snapshot. Real engine and SQLite with every migration applied.
 */
import { describe, expect, it, mock } from 'bun:test'
import type { CommandEnvelope } from '@edgecms/schemas/commands'
import type { CommandContext } from '@/commands/engine'
import { createSqliteD1 } from '../helpers/sqlite-d1'

mock.module('cloudflare:workers', () => ({ env: {} }))

const { createDb } = await import('@/database/db')
const { executeCommand } = await import('@/commands/engine')
const { executeSyncPushCommands } = await import('@/sync/sync.service')

const TENANT = 't-acme'
const actor = { userId: 'u1', source: 'admin' as const }

const kv = {
  get: async () => null,
  put: async () => {},
  delete: async () => {},
  list: async () => ({ keys: [], list_complete: true, cursor: '' }),
} as unknown as KVNamespace

async function setup() {
  const { d1, sqlite } = createSqliteD1()
  const now = new Date().toISOString()
  sqlite.exec(`
    INSERT INTO tenants (id, slug, name, status, createdAt, updatedAt, localeCatalog, mediaUploadMaxBytes, mediaUploadMaxDimension, mediaAllowedMimeTypes, aiEnabled, requireMfa)
    VALUES ('${TENANT}', 'acme', 'Acme', 'active', '${now}', '${now}', '[]', 1000000, 4000, '[]', 1, 0);
    INSERT INTO collections (id, name, slug, singleton, fields, defaultLocale, supportedLocales, createdAt, updatedAt, tenantId)
    VALUES ('col-posts', 'Posts', 'posts', 0, '[{"name":"title","type":"text"},{"name":"body","type":"text"},{"name":"summary","type":"text"}]', 'en', '["en"]', '${now}', '${now}', '${TENANT}');
    INSERT INTO entries (id, collectionId, slug, status, data, version, createdAt, updatedAt)
    VALUES ('post-1', 'col-posts', 'post-1', 'draft', '{"title":"Hello","body":"Body","summary":"Sum"}', 1, '${now}', '${now}');
  `)
  const db = createDb(d1)
  const ctx: CommandContext = { db, kv, actor, tenantScope: TENANT, syncChannel: TENANT }
  // Someone else saves v2: body changes, title and summary stay.
  const theirs = await executeCommand(ctx, {
    type: 'updateEntry',
    payload: { entryId: 'post-1', data: { title: 'Hello', body: 'Body (theirs)', summary: 'Sum' } },
    actor,
    optimisticVersion: 1,
    timestamp: now,
  } as CommandEnvelope)
  expect(theirs.status).toBe('success')

  const push = (data: Record<string, unknown>, optimisticVersion = 1) =>
    executeSyncPushCommands({
      commands: [{ type: 'updateEntry', payload: { entryId: 'post-1', data }, optimisticVersion }],
      userId: 'u1',
      db,
      kv,
      syncChannel: TENANT,
      executeCommandFn: executeCommand,
    })
  return { push, sqlite }
}

describe('sync push conflictingFields (OF-04)', () => {
  it('runs a pushed update in the sync tenant (no false NOT_FOUND)', async () => {
    const { push, sqlite } = await setup()
    const [result] = await push({ title: 'Hello (mine)', body: 'Body (theirs)', summary: 'Sum' }, 2)
    expect(result?.status).toBe('success')
    const row = sqlite.query(`SELECT version, data FROM entries WHERE id = 'post-1'`).get() as {
      version: number
      data: string
    }
    expect(row.version).toBe(3)
    expect(JSON.parse(row.data).title).toBe('Hello (mine)')
  })

  it('omits fields only the client changed', async () => {
    const { push } = await setup()
    const [result] = await push({ title: 'Hello (mine)', body: 'Body', summary: 'Sum (mine)' })
    expect(result?.status).toBe('conflict')
    expect(result?.serverState?.version).toBe(2)
    expect(result?.serverState?.conflictingFields).toEqual([])
  })

  it('lists fields both sides changed to different values', async () => {
    const { push } = await setup()
    const [result] = await push({ title: 'Hello (mine)', body: 'Body (mine)', summary: 'Sum' })
    expect(result?.serverState?.conflictingFields).toEqual(['body'])
  })

  it('does not list a field both sides changed to the same value', async () => {
    const { push } = await setup()
    const [result] = await push({ title: 'Hello', body: 'Body (theirs)', summary: 'Sum' })
    expect(result?.serverState?.conflictingFields).toEqual([])
  })

  it('without a base snapshot lists sent fields that differ from the server', async () => {
    const { push, sqlite } = await setup()
    sqlite.exec(`DELETE FROM entry_versions WHERE entryId = 'post-1'`)
    const [result] = await push({ title: 'Hello (mine)', body: 'Body (theirs)', summary: 'Sum' })
    expect(result?.serverState?.conflictingFields).toEqual(['title'])
  })
})
