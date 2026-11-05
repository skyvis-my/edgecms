/**
 * AI-05 bypass tests: execution must be accepted only when it exactly matches
 * the reviewed preview. Runs the real command engine, AI service and MCP
 * adapter against a migrated SQLite database (no engine or handler mocks).
 */
import { beforeEach, describe, expect, it } from 'bun:test'
import type { Database } from '@/database/db'
import type { Env } from '@/env'
import type { CommandContext } from '@/commands/engine'
import type { CommandEnvelope, CommandResult } from '@edgecms/schemas/commands'
import { executeCommand } from '@/commands/engine'
import { executeGeneratedCommands } from '@/ai/ai.service'
import { processMcpMessage } from '@/mcp/mcp-server'
import {
  __resetPreviewReceiptStoreForTests,
  createPreviewReceipt,
} from '@/ai/preview-receipt.service'
import { createPrivacyFixture } from '../privacy/privacy-test-seed'
import { aiSwitchD1 } from './ai-enabled-d1'

/** Minimal KV with the same semantics the receipt store relies on. */
function createFakeKv() {
  const store = new Map<string, string>()
  const kv = {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value)
    },
    delete: async (key: string) => {
      store.delete(key)
    },
  } as unknown as KVNamespace
  return { kv, store }
}

let db: Database
let sqlite: Awaited<ReturnType<typeof createPrivacyFixture>>['sqlite']
let kv: KVNamespace
let kvStore: Map<string, string>

function ctxFor(tenantScope: string, userId = 'alice'): CommandContext {
  return {
    db,
    kv,
    actor: { userId, source: 'ai' },
    tenantScope,
    env: { DB: aiSwitchD1(true) } as unknown as Env,
  }
}

function entryTitle(id = 'e1'): string {
  const row = sqlite.query('SELECT data FROM entries WHERE id = ?').get(id) as { data: string }
  return (JSON.parse(row.data) as { title: string }).title
}

function updateEnvelope(title: string, userId = 'alice'): CommandEnvelope {
  return {
    type: 'updateEntry',
    payload: { entryId: 'e1', data: { title } },
    actor: { userId, source: 'ai' },
    timestamp: new Date().toISOString(),
  }
}

async function previewViaEngine(title: string, tenant = 't1', userId = 'alice') {
  const result: CommandResult = await executeCommand(ctxFor(tenant, userId), {
    ...updateEnvelope(title, userId),
    dryRun: true,
  })
  expect(result.status).toBe('dry_run')
  expect(result.previewReceipt).toStartWith('rcpt_')
  return result.previewReceipt as string
}

beforeEach(async () => {
  __resetPreviewReceiptStoreForTests()
  const fixture = await createPrivacyFixture()
  db = fixture.db
  sqlite = fixture.sqlite
  // The seed already snapshots versions 1 and 2 of e1; updates snapshot the current one.
  sqlite.exec(`UPDATE entries SET version = 3 WHERE id = 'e1'`)
  const fake = createFakeKv()
  kv = fake.kv
  kvStore = fake.store
})

describe('AI-05 command engine: preview receipts', () => {
  it('executes the exact reviewed envelope once', async () => {
    const receipt = await previewViaEngine('Reviewed')
    const result = await executeCommand(ctxFor('t1'), {
      ...updateEnvelope('Reviewed'),
      previewReceipt: receipt,
    })
    expect(result.error).toBeUndefined()
    expect(result.status).toBe('success')
    expect(entryTitle()).toBe('Reviewed')
  })

  it('rejects an envelope modified after preview (HASH_MISMATCH)', async () => {
    const receipt = await previewViaEngine('Reviewed')
    const result = await executeCommand(ctxFor('t1'), {
      ...updateEnvelope('Tampered'),
      previewReceipt: receipt,
    })
    expect(result.status).toBe('failed')
    expect(result.error?.code).toBe('INVALID_PREVIEW_RECEIPT')
    expect(result.error?.reason).toBe('HASH_MISMATCH')
    expect(entryTitle()).toBe('Hello by Alice')
  })

  it('rejects a reused receipt (RECEIPT_ALREADY_USED)', async () => {
    const receipt = await previewViaEngine('Once')
    const first = await executeCommand(ctxFor('t1'), { ...updateEnvelope('Once'), previewReceipt: receipt })
    expect(first.status).toBe('success')

    const replay = await executeCommand(ctxFor('t1'), { ...updateEnvelope('Once'), previewReceipt: receipt })
    expect(replay.status).toBe('failed')
    expect(replay.error?.reason).toBe('RECEIPT_ALREADY_USED')
  })

  it('rejects a replay served from a stale receipt copy (other isolate / stale KV)', async () => {
    const receipt = await previewViaEngine('Once')
    const kvKey = [...kvStore.keys()].find((key) => key.endsWith(receipt))
    expect(kvKey).toBeDefined()
    const staleRecord = kvStore.get(kvKey as string) as string

    const first = await executeCommand(ctxFor('t1'), { ...updateEnvelope('Once'), previewReceipt: receipt })
    expect(first.status).toBe('success')

    // Another isolate never saw the consumption: empty memory, unconsumed KV copy.
    __resetPreviewReceiptStoreForTests()
    kvStore.set(kvKey as string, staleRecord)
    sqlite.exec(`UPDATE entries SET data = '{"title":"Edited later"}' WHERE id = 'e1'`)

    const replay = await executeCommand(ctxFor('t1'), { ...updateEnvelope('Once'), previewReceipt: receipt })
    expect(replay.status).toBe('failed')
    expect(replay.error?.reason).toBe('RECEIPT_ALREADY_USED')
    expect(entryTitle()).toBe('Edited later')
  })

  it('accepts only one of two concurrent executions of the same receipt', async () => {
    const receipt = await previewViaEngine('Race')
    const results = await Promise.all([
      executeCommand(ctxFor('t1'), { ...updateEnvelope('Race'), previewReceipt: receipt }),
      executeCommand(ctxFor('t1'), { ...updateEnvelope('Race'), previewReceipt: receipt }),
    ])
    expect(results.map((r) => r.status).sort()).toEqual(['failed', 'success'])
    expect(results.find((r) => r.status === 'failed')?.error?.reason).toBe('RECEIPT_ALREADY_USED')
  })

  it('rejects a receipt minted for another tenant (TENANT_MISMATCH)', async () => {
    const receipt = await previewViaEngine('Cross', 't2')
    const result = await executeCommand(ctxFor('t1'), { ...updateEnvelope('Cross'), previewReceipt: receipt })
    expect(result.status).toBe('failed')
    expect(result.error?.reason).toBe('TENANT_MISMATCH')
    expect(entryTitle()).toBe('Hello by Alice')
  })

  it('rejects a receipt minted for another actor (ACTOR_MISMATCH)', async () => {
    const receipt = await previewViaEngine('Other actor', 't1', 'bob')
    const result = await executeCommand(ctxFor('t1', 'alice'), {
      ...updateEnvelope('Other actor', 'alice'),
      previewReceipt: receipt,
    })
    expect(result.status).toBe('failed')
    expect(result.error?.reason).toBe('ACTOR_MISMATCH')
  })

  it('rejects an expired receipt (RECEIPT_EXPIRED)', async () => {
    const record = await createPreviewReceipt({
      commands: [updateEnvelope('Late')],
      userId: 'alice',
      tenantId: 't1',
      kv,
      ttlSeconds: -1,
    })
    const result = await executeCommand(ctxFor('t1'), { ...updateEnvelope('Late'), previewReceipt: record.receiptId })
    expect(result.status).toBe('failed')
    expect(result.error?.reason).toBe('RECEIPT_EXPIRED')
  })

  it('rejects an unknown receipt (RECEIPT_NOT_FOUND)', async () => {
    const result = await executeCommand(ctxFor('t1'), {
      ...updateEnvelope('Ghost'),
      previewReceipt: 'rcpt_forged',
    })
    expect(result.status).toBe('failed')
    expect(result.error?.reason).toBe('RECEIPT_NOT_FOUND')
  })

  it('rejects a transaction that repeats or drops reviewed commands', async () => {
    const reviewed = [updateEnvelope('A'), { ...updateEnvelope('B'), payload: { entryId: 'e1', slug: 'b' } }]
    const record = await createPreviewReceipt({ commands: reviewed, userId: 'alice', tenantId: 't1', kv })

    const repeated = await executeCommand(ctxFor('t1'), {
      type: 'transaction',
      payload: { commands: [reviewed[0], reviewed[0], reviewed[0]] },
      actor: { userId: 'alice', source: 'ai' },
      previewReceipt: record.receiptId,
      timestamp: new Date().toISOString(),
    })
    expect(repeated.status).toBe('failed')
    expect(repeated.error?.reason).toBe('HASH_MISMATCH')

    const dropped = await executeCommand(ctxFor('t1'), {
      type: 'transaction',
      payload: { commands: [reviewed[0]] },
      actor: { userId: 'alice', source: 'ai' },
      previewReceipt: record.receiptId,
      timestamp: new Date().toISOString(),
    })
    expect(dropped.status).toBe('failed')
    expect(dropped.error?.reason).toBe('HASH_MISMATCH')
    expect(entryTitle()).toBe('Hello by Alice')
  })
})

describe('AI-05 admin AI flow: preview receipts', () => {
  async function aiExecute(previewReceipt: string, tenantId = 't1', userId = 'alice') {
    return executeGeneratedCommands({
      previewReceipt,
      userId,
      db,
      kv,
      env: {} as Env,
      enforcePreviewReceipt: true,
      metadata: { tenantId },
    })
  }

  async function aiPreview(title: string, tenantId = 't1') {
    const record = await createPreviewReceipt({
      commands: [updateEnvelope(title)],
      userId: 'alice',
      tenantId,
      kv,
    })
    return record.receiptId
  }

  it('executes a reviewed receipt once and rejects reuse with a typed error', async () => {
    const receipt = await aiPreview('AI reviewed')
    const first = await aiExecute(receipt)
    expect(first.status).toBe('success')
    expect(entryTitle()).toBe('AI reviewed')

    await expect(aiExecute(receipt)).rejects.toMatchObject({ code: 'RECEIPT_ALREADY_USED' })
  })

  it('rejects concurrent executions of one receipt', async () => {
    const receipt = await aiPreview('AI race')
    const settled = await Promise.allSettled([aiExecute(receipt), aiExecute(receipt)])
    expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1)
    const rejected = settled.find((s) => s.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toMatchObject({ code: 'RECEIPT_ALREADY_USED' })
  })

  it('rejects a cross-tenant receipt with a typed error', async () => {
    const receipt = await aiPreview('AI cross', 't2')
    await expect(aiExecute(receipt, 't1')).rejects.toMatchObject({ code: 'TENANT_MISMATCH' })
    expect(entryTitle()).toBe('Hello by Alice')
  })

  it('rejects another actor executing the receipt', async () => {
    const receipt = await aiPreview('AI actor')
    await expect(aiExecute(receipt, 't1', 'bob')).rejects.toMatchObject({ code: 'ACTOR_MISMATCH' })
  })
})

describe('AI-05 MCP preview/execute: preview receipts', () => {
  async function callTool(ctx: CommandContext, name: string, args: Record<string, unknown>) {
    const response = await processMcpMessage(ctx, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    })
    const result = response?.result as { isError?: boolean; content: Array<{ text: string }> }
    return { isError: Boolean(result.isError), body: JSON.parse(result.content[0]?.text ?? '{}') }
  }

  async function mcpPreview(ctx: CommandContext, title: string) {
    const preview = await callTool(ctx, 'edgecms_preview_command', {
      type: 'updateEntry',
      payload: { entryId: 'e1', data: { title } },
    })
    expect(preview.isError).toBe(false)
    return preview.body as { previewReceipt: string }
  }

  it('executes once and rejects reuse', async () => {
    const { previewReceipt } = await mcpPreview(ctxFor('t1'), 'MCP reviewed')
    const first = await callTool(ctxFor('t1'), 'edgecms_execute_command', { previewReceipt })
    expect(first.isError).toBe(false)
    expect(entryTitle()).toBe('MCP reviewed')

    const replay = await callTool(ctxFor('t1'), 'edgecms_execute_command', { previewReceipt })
    expect(replay.isError).toBe(true)
    expect(replay.body.error.code).toBe('RECEIPT_ALREADY_USED')
  })

  it('rejects a modified command supplied with the receipt', async () => {
    const { previewReceipt } = await mcpPreview(ctxFor('t1'), 'MCP reviewed')
    const tampered = await callTool(ctxFor('t1'), 'edgecms_execute_command', {
      previewReceipt,
      command: updateEnvelope('MCP tampered'),
    })
    expect(tampered.isError).toBe(true)
    expect(tampered.body.error.code).toBe('HASH_MISMATCH')
    expect(entryTitle()).toBe('Hello by Alice')
  })

  it('rejects a receipt from another tenant session', async () => {
    const { previewReceipt } = await mcpPreview(ctxFor('t2'), 'MCP cross')
    const result = await callTool(ctxFor('t1'), 'edgecms_execute_command', { previewReceipt })
    expect(result.isError).toBe(true)
    expect(result.body.error.code).toBe('TENANT_MISMATCH')
    expect(entryTitle()).toBe('Hello by Alice')
  })

  it('accepts only one of two concurrent executions', async () => {
    const { previewReceipt } = await mcpPreview(ctxFor('t1'), 'MCP race')
    const results = await Promise.all([
      callTool(ctxFor('t1'), 'edgecms_execute_command', { previewReceipt }),
      callTool(ctxFor('t1'), 'edgecms_execute_command', { previewReceipt }),
    ])
    expect(results.filter((r) => !r.isError)).toHaveLength(1)
    expect(results.find((r) => r.isError)?.body.error.code).toBe('RECEIPT_ALREADY_USED')
  })

  it('does not issue a receipt for a preview that failed', async () => {
    // Unknown command type: the engine fails the dry run.
    const preview = await callTool(ctxFor('t1'), 'edgecms_preview_command', {
      type: 'rewriteEverything',
      payload: {},
    })
    expect(preview.isError).toBe(true)
    expect(preview.body.previewReceipt).toBeUndefined()
  })
})
