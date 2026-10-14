/**
 * Engine outbox tests (H1 write path).
 *
 * H1: the success path must write the webhook outbox row in the SAME batch
 * as the processed command, so a crash between DB commit and queue.sendBatch
 * cannot lose the webhook. The emitted event and the outbox row share one
 * eventId (linked via metadata.outboxEventId) for producer close-out.
 */
import { afterEach, beforeEach, describe, expect, it, mock, vi } from 'bun:test'
import type { Database } from '@/database/db'
import type { CommandContext } from '../../commands/engine'
import { webhookOutbox } from '../../database/schema/webhooks.schema'

mock.module('@/commands/handlers/entry-handlers', () => ({
  handleCreateEntry: vi.fn(),
  handleUpdateEntry: vi.fn(),
  handleDeleteEntry: vi.fn(),
  handleBulkUpdate: vi.fn(),
  handleUpdateSingleton: vi.fn(),
}))
mock.module('@/commands/handlers/publishing-handlers', () => ({
  handlePublishNow: vi.fn(),
  handleUnpublishNow: vi.fn(),
  handleSchedulePublish: vi.fn(),
  handleScheduleUnpublish: vi.fn(),
  handleCancelSchedule: vi.fn(),
}))
mock.module('@/commands/handlers/relation-handlers', () => ({
  handleLinkRelation: vi.fn(),
  handleUnlinkRelation: vi.fn(),
}))
mock.module('@/cache/invalidation.service', () => ({
  extractCacheTagsFromCommand: vi.fn().mockReturnValue([]),
  invalidateByTags: vi.fn().mockResolvedValue({ invalidatedKeys: [] }),
}))
mock.module('@/sync/sync-events', () => ({
  publishSyncEvent: vi.fn(),
}))
mock.module('@/plugins/plugin-registry', () => ({
  pluginRegistry: { execute: vi.fn() },
}))

import { handleCreateEntry } from '../../commands/handlers/entry-handlers'
import { eventBus } from '../../webhooks/event-bus'

const { executeCommand } = await import(`../../commands/engine?bypass=${Date.now()}`)

const mockCreateEntry = handleCreateEntry as unknown as ReturnType<typeof mock>

function createBatchDb() {
  const builders: { table: unknown; values: Record<string, unknown> }[] = []
  const batches: unknown[][] = []
  return {
    builders,
    batches,
    db: {
      insert: vi.fn((table: unknown) => ({
        values: (v: Record<string, unknown>) => {
          const builder = { table, values: v }
          builders.push(builder)
          return builder
        },
      })),
      batch: vi.fn(async (qs: unknown[]) => {
        batches.push(qs)
        return []
      }),
    } as unknown as Database,
  }
}

describe('engine webhook outbox (H1)', () => {
  let emitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    emitSpy = vi.spyOn(eventBus, 'emit').mockImplementation(async () => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('writes the outbox row in the same batch as the processed command', async () => {
    mockCreateEntry.mockResolvedValue({
      success: true,
      data: { id: 'e1' },
      auditEntries: [],
    })
    const { db, builders, batches } = createBatchDb()
    const ctx: CommandContext = { db, actor: { userId: 'user1', source: 'admin' } }

    const result = await executeCommand(ctx, {
      type: 'createEntry',
      payload: { collectionId: 'c1', data: {} },
      actor: { userId: 'user1', source: 'admin' },
      timestamp: new Date().toISOString(),
    })

    expect(result.status).toBe('success')
    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveLength(2)
    const outboxBuilder = builders.find((b) => b.table === webhookOutbox)
    expect(outboxBuilder).toBeDefined()
    expect(outboxBuilder?.values).toMatchObject({
      eventType: 'entry.created',
      status: 'pending',
      tenantScope: 'global',
    })
    const payload = outboxBuilder?.values.payload as Record<string, unknown>
    expect(payload.event).toBe('entry.created')
    const metadata = payload.metadata as Record<string, unknown>
    expect(typeof metadata.outboxEventId).toBe('string')
    expect(metadata.commandId).toBe(result.commandId)
  })

  it('links the emitted event to the outbox row via metadata.outboxEventId', async () => {
    mockCreateEntry.mockResolvedValue({
      success: true,
      data: { id: 'e1' },
      auditEntries: [],
    })
    const { db, builders } = createBatchDb()
    const ctx: CommandContext = { db, actor: { userId: 'user1', source: 'admin' } }

    await executeCommand(ctx, {
      type: 'createEntry',
      payload: { collectionId: 'c1', data: {} },
      actor: { userId: 'user1', source: 'admin' },
      timestamp: new Date().toISOString(),
    })

    const outboxBuilder = builders.find((b) => b.table === webhookOutbox)
    if (!outboxBuilder) throw new Error('expected outbox insert in batch')
    const outboxEventId = outboxBuilder.values.payload as Record<string, unknown>
    expect(emitSpy).toHaveBeenCalledTimes(1)
    const firstCall = emitSpy.mock.calls[0]
    if (!firstCall) throw new Error('expected emit to be called')
    const emittedData = firstCall[1] as { metadata: Record<string, unknown> }
    const rowMetadata = outboxEventId.metadata as Record<string, unknown>
    expect(emittedData.metadata.outboxEventId).toBe(rowMetadata.outboxEventId)
  })

  it('writes no outbox row when the handler fails', async () => {
    mockCreateEntry.mockResolvedValue({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'bad' },
    })
    const { db, builders, batches } = createBatchDb()
    const ctx: CommandContext = { db, actor: { userId: 'user1', source: 'admin' } }

    const result = await executeCommand(ctx, {
      type: 'createEntry',
      payload: { collectionId: 'c1', data: {} },
      actor: { userId: 'user1', source: 'admin' },
      timestamp: new Date().toISOString(),
    })

    expect(result.status).toBe('failed')
    expect(batches).toHaveLength(0)
    expect(builders.find((b) => b.table === webhookOutbox)).toBeUndefined()
    expect(emitSpy).not.toHaveBeenCalled()
  })
})
