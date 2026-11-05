/**
 * PL-03: per-collection content grants are enforced wherever commands run for
 * a user (command engine, MCP tools, AI execution, sync push) and on the
 * direct entry CRUD routes. Real SQL (bun:sqlite with every migration).
 */
import { beforeEach, describe, expect, it } from 'bun:test'
import type { CommandEnvelope } from '@edgecms/schemas/commands'
import {
  createContentAccess,
  FULL_CONTENT_ACCESS,
  READ_ONLY_CONTENT_ACCESS,
  type ContentAccess,
} from '@/auth/content-access'
import { executeCommand, type CommandContext } from '@/commands/engine'
import { createDb, type Database } from '@/database/db'
import { processMcpMessage } from '@/mcp/mcp-server'
import { executeGeneratedCommands } from '@/ai/ai.service'
import { createPreviewReceipt } from '@/ai/preview-receipt.service'
import type { Env } from '@/env'
import { executeSyncPushCommands } from '@/sync/sync.service'
import { createSqliteD1 } from '../helpers/sqlite-d1'
import type { Database as Sqlite } from 'bun:sqlite'

const TENANT = 'tenant-a'
const NOW = '2026-01-01T00:00:00.000Z'

const BLOG_WRITER: ContentAccess = createContentAccess([
  { subject: 'entry:blog', action: 'read' },
  { subject: 'entry:blog', action: 'create' },
  { subject: 'entry:blog', action: 'update' },
])

let sqlite: Sqlite
let db: Database

function seed() {
  const created = createSqliteD1()
  sqlite = created.sqlite
  db = createDb(created.d1)
  sqlite
    .query(
      `insert into tenants (id, slug, name, status, localeCatalog, mediaAllowedMimeTypes, createdAt, updatedAt)
       values (?, 'acme', 'Acme', 'active', '["en"]', '["image/png"]', ?, ?)`
    )
    .run(TENANT, NOW, NOW)
  const fields = JSON.stringify([{ name: 'title', type: 'text', required: false }])
  for (const slug of ['blog', 'news']) {
    sqlite
      .query(
        `insert into collections (id, tenantId, name, slug, singleton, fields, defaultLocale, supportedLocales, createdAt, updatedAt)
         values (?, ?, ?, ?, 0, ?, 'en', '["en"]', ?, ?)`
      )
      .run(`col-${slug}`, TENANT, slug, slug, fields, NOW, NOW)
    sqlite
      .query(
        `insert into entries (id, collectionId, slug, status, data, version, createdAt, updatedAt)
         values (?, ?, ?, 'draft', '{"title":"x"}', 1, ?, ?)`
      )
      .run(`entry-${slug}`, `col-${slug}`, `${slug}-one`, NOW, NOW)
  }
}

function ctx(contentAccess?: ContentAccess): CommandContext {
  return {
    db,
    actor: { userId: 'u-1', source: 'admin' },
    tenantScope: TENANT,
    contentAccess,
  }
}

function command(type: CommandEnvelope['type'], payload: Record<string, unknown>, extra: Partial<CommandEnvelope> = {}): CommandEnvelope {
  return {
    type,
    payload,
    actor: { userId: 'u-1', source: 'admin' },
    timestamp: NOW,
    ...extra,
  }
}

function entryTitle(id: string): string | undefined {
  const row = sqlite.query('select data from entries where id = ?').get(id) as { data: string } | null
  return row ? (JSON.parse(row.data) as { title?: string }).title : undefined
}

function entryCount(collectionId: string): number {
  return (sqlite.query('select count(*) as c from entries where collectionId = ?').get(collectionId) as { c: number }).c
}

beforeEach(() => {
  seed()
})

describe('command engine: per-collection grants', () => {
  it('allows a custom role inside its granted collection', async () => {
    const created = await executeCommand(
      ctx(BLOG_WRITER),
      command('createEntry', { collectionId: 'col-blog', slug: 'blog-two', data: { title: 'b' } })
    )
    expect(created.error?.code).not.toBe('FORBIDDEN')
    expect(created.status).toBe('success')

    const updated = await executeCommand(
      ctx(BLOG_WRITER),
      command('updateEntry', { entryId: 'entry-blog', data: { title: 'edited' } }, { optimisticVersion: 1 })
    )
    expect(updated.status).toBe('success')
    expect(entryTitle('entry-blog')).toBe('edited')
  })

  it('denies writes to another collection and leaves data unchanged', async () => {
    const created = await executeCommand(
      ctx(BLOG_WRITER),
      command('createEntry', { collectionId: 'col-news', slug: 'news-two', data: { title: 'n' } })
    )
    expect(created.status).toBe('failed')
    expect(created.error?.code).toBe('FORBIDDEN')
    expect(entryCount('col-news')).toBe(1)

    const updated = await executeCommand(
      ctx(BLOG_WRITER),
      command('updateEntry', { entryId: 'entry-news', data: { title: 'hacked' } }, { optimisticVersion: 1 })
    )
    expect(updated.error?.code).toBe('FORBIDDEN')
    expect(entryTitle('entry-news')).toBe('x')
  })

  it('denies actions the role lacks, even in its own collection', async () => {
    for (const envelope of [
      command('deleteEntry', { entryId: 'entry-blog' }),
      command('publishNow', { entryId: 'entry-blog' }),
    ]) {
      const result = await executeCommand(ctx(BLOG_WRITER), envelope)
      expect(result.error?.code).toBe('FORBIDDEN')
    }
    expect(entryCount('col-blog')).toBe(1)
  })

  it('denies dry runs it could not execute', async () => {
    const result = await executeCommand(
      ctx(BLOG_WRITER),
      command('deleteEntry', { entryId: 'entry-news' }, { dryRun: true })
    )
    expect(result.error?.code).toBe('FORBIDDEN')
  })

  it('checks every command inside a transaction and bulk updates', async () => {
    const tx = await executeCommand(
      ctx(BLOG_WRITER),
      command('transaction', {
        commands: [
          command('updateEntry', { entryId: 'entry-blog', data: { title: 'ok' } }, { optimisticVersion: 1 }),
          command('updateEntry', { entryId: 'entry-news', data: { title: 'hacked' } }, { optimisticVersion: 1 }),
        ],
      })
    )
    expect(tx.error?.code).toBe('FORBIDDEN')
    expect(entryTitle('entry-blog')).toBe('x')
    expect(entryTitle('entry-news')).toBe('x')

    const bulk = await executeCommand(
      ctx(BLOG_WRITER),
      command('bulkUpdate', { entryIds: ['entry-blog', 'entry-news'], updates: { data: { title: 'bulk' } } })
    )
    expect(bulk.error?.code).toBe('FORBIDDEN')
  })

  it('fails closed for ids outside the tenant', async () => {
    const result = await executeCommand(
      ctx(BLOG_WRITER),
      command('updateEntry', { entryId: 'does-not-exist', data: {} })
    )
    expect(result.error?.code).toBe('FORBIDDEN')
  })

  it('denies all writes to a read-only role and allows everything with full access', async () => {
    const readOnly = await executeCommand(
      ctx(READ_ONLY_CONTENT_ACCESS),
      command('updateEntry', { entryId: 'entry-blog', data: { title: 'no' } }, { optimisticVersion: 1 })
    )
    expect(readOnly.error?.code).toBe('FORBIDDEN')

    const full = await executeCommand(
      ctx(FULL_CONTENT_ACCESS),
      command('updateEntry', { entryId: 'entry-news', data: { title: 'yes' } }, { optimisticVersion: 1 })
    )
    expect(full.status).toBe('success')
  })

  it('keeps system callers without content access unchanged', async () => {
    const result = await executeCommand(
      ctx(undefined),
      command('updateEntry', { entryId: 'entry-news', data: { title: 'system' } }, { optimisticVersion: 1 })
    )
    expect(result.status).toBe('success')
  })
})

describe('MCP tools use the same check', () => {
  async function callTool(access: ContentAccess, name: string, args: Record<string, unknown>) {
    const response = await processMcpMessage(
      { ...ctx(access), actor: { userId: 'u-1', source: 'ai' } },
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }
    )
    return response as { result?: { isError?: boolean; content: Array<{ text: string }> } }
  }

  it('denies previewing a command on an ungranted collection', async () => {
    const response = await callTool(BLOG_WRITER, 'edgecms_preview_command', {
      type: 'updateEntry',
      payload: { entryId: 'entry-news', data: { title: 'via-mcp' } },
      optimisticVersion: 1,
    })
    expect(JSON.stringify(response)).toContain('FORBIDDEN')
    expect(entryTitle('entry-news')).toBe('x')
  })

  it('denies executing a reviewed receipt once the role no longer allows it', async () => {
    const preview = await callTool(FULL_CONTENT_ACCESS, 'edgecms_preview_command', {
      type: 'updateEntry',
      payload: { entryId: 'entry-news', data: { title: 'via-mcp' } },
      optimisticVersion: 1,
    })
    const receipt = (JSON.parse(preview.result!.content[0]!.text) as { previewReceipt: string }).previewReceipt
    const response = await callTool(BLOG_WRITER, 'edgecms_execute_command', { previewReceipt: receipt })
    expect(JSON.stringify(response)).toContain('FORBIDDEN')
    expect(entryTitle('entry-news')).toBe('x')
  })

  it('denies reading entries of an ungranted collection', async () => {
    const list = await callTool(BLOG_WRITER, 'edgecms_list_entries', { collectionSlug: 'news' })
    expect(list.result?.isError).toBe(true)
    const get = await callTool(BLOG_WRITER, 'edgecms_get_entry', { entryId: 'entry-news' })
    expect(get.result?.isError).toBe(true)
    const allowed = await callTool(BLOG_WRITER, 'edgecms_get_entry', { entryId: 'entry-blog' })
    expect(allowed.result?.isError).toBeFalsy()
  })
})

describe('AI command execution uses the same check', () => {
  it('denies executing reviewed AI commands on an ungranted collection', async () => {
    const commands = [
      command('updateEntry', { entryId: 'entry-news', data: { title: 'via-ai' } }, {
        optimisticVersion: 1,
        actor: { userId: 'u-1', source: 'ai' },
      }),
    ]
    const receipt = await createPreviewReceipt({ commands, userId: 'u-1', tenantId: TENANT, kv: undefined })
    const result = await executeGeneratedCommands({
      previewReceipt: receipt.receiptId,
      userId: 'u-1',
      db,
      kv: undefined as unknown as KVNamespace,
      env: {} as Env,
      metadata: { tenantId: TENANT },
      contentAccess: BLOG_WRITER,
    })
    expect(result.status).toBe('failed')
    expect(result.results?.[0]?.error?.code).toBe('FORBIDDEN')
    expect(entryTitle('entry-news')).toBe('x')
  })
})

describe('sync push uses the same check', () => {
  it('denies a pushed command on an ungranted collection', async () => {
    const results = await executeSyncPushCommands({
      commands: [
        { type: 'updateEntry', payload: { entryId: 'entry-news', data: { title: 'sync' } }, optimisticVersion: 1 },
      ],
      userId: 'u-1',
      db,
      kv: undefined as unknown as KVNamespace,
      syncChannel: TENANT,
      executeCommandFn: executeCommand,
      contentAccess: BLOG_WRITER,
    })
    expect(results[0]?.status).toBe('failed')
    expect(entryTitle('entry-news')).toBe('x')
  })
})
