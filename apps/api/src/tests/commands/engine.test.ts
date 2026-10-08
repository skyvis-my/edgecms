import { afterEach, beforeEach, describe, expect, it, mock, vi } from 'bun:test'
import type { Database } from '@/database/db'
import type { CommandEnvelope } from '@edgecms/schemas/commands'
import type { CommandContext } from '../../commands/engine'

// Mock all handler modules
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

mock.module('@/commands/diff.service', () => ({
  computeDiff: vi.fn(),
}))

mock.module('@/cache/invalidation.service', () => ({
  extractCacheTagsFromCommand: vi.fn().mockReturnValue([]),
  invalidateByTags: vi.fn().mockResolvedValue({ invalidatedKeys: [] }),
}))

mock.module('@/sync/sync-events', () => ({
  publishSyncEvent: vi.fn(),
}))

mock.module('@/plugins/plugin-registry', () => ({
  pluginRegistry: {
    execute: vi.fn(),
  },
}))

import { extractCacheTagsFromCommand, invalidateByTags } from '@/cache/invalidation.service'
import { pluginRegistry } from '@/plugins/plugin-registry'
import { publishSyncEvent } from '@/sync/sync-events'
import { eventBus } from '@/webhooks/event-bus'
import { computeDiff, type DiffEntry } from '../../commands/diff.service'
import {
  handleBulkUpdate,
  handleCreateEntry,
  handleDeleteEntry,
  handleUpdateEntry,
} from '../../commands/handlers/entry-handlers'
import { handlePublishNow } from '../../commands/handlers/publishing-handlers'
import { handleLinkRelation } from '../../commands/handlers/relation-handlers'

// Dynamic import to bypass cache/mock from other tests
const { executeCommand } = await import(`../../commands/engine?bypass=${Date.now()}`)

const mockCreateEntry = handleCreateEntry as unknown as ReturnType<typeof mock>
const mockUpdateEntry = handleUpdateEntry as unknown as ReturnType<typeof mock>
const mockDeleteEntry = handleDeleteEntry as unknown as ReturnType<typeof mock>
const mockBulkUpdate = handleBulkUpdate as unknown as ReturnType<typeof mock>
const mockPublishNow = handlePublishNow as unknown as ReturnType<typeof mock>
const mockLinkRelation = handleLinkRelation as unknown as ReturnType<typeof mock>
const mockComputeDiff = computeDiff as unknown as ReturnType<typeof mock>
const mockExtractTags = extractCacheTagsFromCommand as unknown as ReturnType<typeof mock>
const mockInvalidateByTags = invalidateByTags as unknown as ReturnType<typeof mock>
const mockPublishSyncEvent = publishSyncEvent as unknown as ReturnType<typeof mock>
const mockPluginExecute = pluginRegistry.execute as unknown as ReturnType<typeof mock>
let mockEventBusEmit: ReturnType<typeof vi.spyOn>

describe('executeCommand', () => {
  let ctx: CommandContext
  const insertValues = vi.fn().mockReturnThis()
  const mockInsert = vi.fn().mockReturnValue({ values: insertValues })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(
      'cmd-uuid' as `${string}-${string}-${string}-${string}-${string}`
    )
    mockEventBusEmit = vi.spyOn(eventBus, 'emit').mockImplementation(async () => {})

    ctx = {
      db: {
        insert: mockInsert,
      } as unknown as Database,
      actor: { userId: 'user1', source: 'admin' },
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('handler routing', () => {
    it('routes createEntry to handleCreateEntry', async () => {
      mockCreateEntry.mockResolvedValue({
        success: true,
        data: { id: 'e1' },
        auditEntries: [],
      })

      const result = await executeCommand(ctx, {
        type: 'createEntry',
        payload: { collectionId: 'c1', data: {} },
        actor: { userId: 'user1', source: 'admin' },
        timestamp: new Date().toISOString(),
      })

      expect(result.status).toBe('success')
      expect(mockCreateEntry).toHaveBeenCalledWith(ctx, { collectionId: 'c1', data: {} }, undefined)
    })

    it('routes publishNow to handlePublishNow', async () => {
      mockPublishNow.mockResolvedValue({
        success: true,
        data: { id: 'e1', status: 'published' },
        auditEntries: [],
      })

      const result = await executeCommand(ctx, {
        type: 'publishNow',
        payload: { entryId: 'e1' },
        actor: { userId: 'user1', source: 'admin' },
        timestamp: new Date().toISOString(),
      })

      expect(result.status).toBe('success')
      expect(mockPublishNow).toHaveBeenCalled()
    })

    it('returns failed for unknown command type', async () => {
      const result = await executeCommand(ctx, {
        type: 'unknownCommand' as CommandEnvelope['type'],
        payload: {},
        actor: { userId: 'user1', source: 'admin' },
        timestamp: new Date().toISOString(),
      })

      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('UNKNOWN_COMMAND')
    })
  })

  describe('plugin hooks', () => {
    it('executes beforeCommand and afterCommand hooks with command metadata', async () => {
      mockCreateEntry.mockResolvedValue({
        success: true,
        data: { id: 'e1' },
        auditEntries: [],
      })

      const result = await executeCommand(
        {
          ...ctx,
          tenantScope: 'tenant-1',
          requestMeta: {
            requestId: 'req-1',
            pathname: '/api/admin/commands',
            method: 'POST',
          },
        },
        {
          type: 'createEntry',
          payload: { collectionId: 'c1', data: {} },
          actor: { userId: 'user1', source: 'admin' },
          timestamp: new Date().toISOString(),
        }
      )

      expect(result.status).toBe('success')
      expect(mockPluginExecute).toHaveBeenNthCalledWith(
        1,
        'beforeCommand',
        expect.objectContaining({
          requestId: 'req-1',
          pathname: '/api/admin/commands',
          method: 'POST',
          tenantScope: 'tenant-1',
          commandType: 'createEntry',
          actorSource: 'admin',
        })
      )
      expect(mockPluginExecute).toHaveBeenNthCalledWith(
        2,
        'afterCommand',
        expect.objectContaining({
          requestId: 'req-1',
          commandType: 'createEntry',
          commandStatus: 'success',
          commandId: 'cmd-uuid',
        })
      )
    })

    it('continues command execution when plugin hook throws', async () => {
      mockPluginExecute.mockRejectedValueOnce(new Error('Plugin failed'))
      mockCreateEntry.mockResolvedValue({
        success: true,
        data: { id: 'e1' },
        auditEntries: [],
      })

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const result = await executeCommand(ctx, {
        type: 'createEntry',
        payload: { collectionId: 'c1', data: {} },
        actor: { userId: 'user1', source: 'admin' },
        timestamp: new Date().toISOString(),
      })

      expect(result.status).toBe('success')
      expect(consoleSpy).toHaveBeenCalledWith(
        'plugin_hook_failed',
        expect.objectContaining({
          hook: 'beforeCommand',
          error: 'Plugin failed',
        })
      )
      consoleSpy.mockRestore()
    })
  })

  describe('dry-run mode', () => {
    it('computes diff without executing handler', async () => {
      const diffEntries = [{ field: 'status', before: null, after: 'draft', action: 'add' }]
      mockComputeDiff.mockResolvedValue(diffEntries as unknown as DiffEntry[])

      const result = await executeCommand(ctx, {
        type: 'createEntry',
        payload: { collectionId: 'c1', data: {} },
        actor: { userId: 'user1', source: 'admin' },
        timestamp: new Date().toISOString(),
        dryRun: true,
      })

      expect(result.status).toBe('dry_run')
      expect(result.diff).toBeDefined()
      // Handler should NOT be called
      expect(mockCreateEntry).not.toHaveBeenCalled()
    })

    it('returns failed on dry-run error', async () => {
      mockComputeDiff.mockRejectedValue(new Error('Diff computation failed'))

      const result = await executeCommand(ctx, {
        type: 'createEntry',
        payload: {},
        actor: { userId: 'user1', source: 'admin' },
        timestamp: new Date().toISOString(),
        dryRun: true,
      })

      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('DRY_RUN_ERROR')
    })
  })

  describe('handler result handling', () => {
    it('returns success with data on successful handler', async () => {
      mockCreateEntry.mockResolvedValue({
        success: true,
        data: { id: 'e1', slug: 'test' },
        auditEntries: [{ entityType: 'entry', entityId: 'e1', action: 'create' }],
      })

      const result = await executeCommand(ctx, {
        type: 'createEntry',
        payload: { collectionId: 'c1', data: {} },
        actor: { userId: 'user1', source: 'admin' },
        timestamp: new Date().toISOString(),
      })

      expect(result.status).toBe('success')
      expect(result.data).toEqual({ id: 'e1', slug: 'test' })
    })

    it('returns failed when handler reports failure', async () => {
      mockCreateEntry.mockResolvedValue({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Collection not found' },
      })

      const result = await executeCommand(ctx, {
        type: 'createEntry',
        payload: { collectionId: 'bad', data: {} },
        actor: { userId: 'user1', source: 'admin' },
        timestamp: new Date().toISOString(),
      })

      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('NOT_FOUND')
    })

    it('returns failed with INTERNAL_ERROR on handler exception', async () => {
      mockCreateEntry.mockRejectedValue(new Error('Unexpected DB error'))

      const result = await executeCommand(ctx, {
        type: 'createEntry',
        payload: {},
        actor: { userId: 'user1', source: 'admin' },
        timestamp: new Date().toISOString(),
      })

      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('INTERNAL_ERROR')
    })
  })

  describe('cache invalidation', () => {
    it('triggers cache invalidation when KV is available and command succeeds', async () => {
      const mockKV = {} as KVNamespace
      ctx.kv = mockKV

      mockCreateEntry.mockResolvedValue({
        success: true,
        data: { id: 'e1' },
        auditEntries: [],
      })
      mockExtractTags.mockReturnValue(['collection:c1'])
      mockInvalidateByTags.mockResolvedValue({ invalidatedKeys: ['key1'] })

      await executeCommand(ctx, {
        type: 'createEntry',
        payload: { collectionId: 'c1', data: {} },
        actor: { userId: 'user1', source: 'admin' },
        timestamp: new Date().toISOString(),
      })

      expect(mockExtractTags).toHaveBeenCalled()
      expect(mockInvalidateByTags).toHaveBeenCalledWith(ctx.db, mockKV, ['collection:c1'])
    })

    it('does not trigger cache invalidation without KV', async () => {
      ctx.kv = undefined

      mockCreateEntry.mockResolvedValue({
        success: true,
        data: { id: 'e1' },
        auditEntries: [],
      })

      await executeCommand(ctx, {
        type: 'createEntry',
        payload: {},
        actor: { userId: 'user1', source: 'admin' },
        timestamp: new Date().toISOString(),
      })

      expect(mockInvalidateByTags).not.toHaveBeenCalled()
    })

    it('passes updateEntry payload with only entryId to async tag extractor', async () => {
      const mockKV = {} as KVNamespace
      ctx.kv = mockKV

      mockUpdateEntry.mockResolvedValue({
        success: true,
        data: { id: 'e1' },
        auditEntries: [],
      })
      mockExtractTags.mockReturnValue(['collection:c1', 'entry:e1'])

      await executeCommand(ctx, {
        type: 'updateEntry',
        payload: { entryId: 'e1', data: { title: 'Updated' } },
        actor: { userId: 'user1', source: 'admin' },
        timestamp: new Date().toISOString(),
      })

      expect(mockExtractTags).toHaveBeenCalledWith(
        ctx.db,
        'updateEntry',
        expect.objectContaining({ entryId: 'e1' }),
        undefined
      )
      expect(mockInvalidateByTags).toHaveBeenCalledWith(ctx.db, mockKV, [
        'collection:c1',
        'entry:e1',
      ])
    })

    it('passes bulkUpdate entryIds payload through to tag extractor', async () => {
      const mockKV = {} as KVNamespace
      ctx.kv = mockKV

      mockBulkUpdate.mockResolvedValue({
        success: true,
        data: { updated: [], errors: [], totalUpdated: 0, totalFailed: 0 },
        auditEntries: [],
      })
      mockExtractTags.mockReturnValue(['entry:e1', 'entry:e2', 'collection:c1'])

      await executeCommand(ctx, {
        type: 'bulkUpdate',
        payload: { entryIds: ['e1', 'e2'], updates: { status: 'published' } },
        actor: { userId: 'user1', source: 'admin' },
        timestamp: new Date().toISOString(),
      })

      expect(mockExtractTags).toHaveBeenCalledWith(
        ctx.db,
        'bulkUpdate',
        expect.objectContaining({ entryIds: ['e1', 'e2'] }),
        undefined
      )
    })

    it('passes tenant sync channel to async tag extractor', async () => {
      const mockKV = {} as KVNamespace
      ctx.kv = mockKV
      ctx.syncChannel = 'tenant-1'

      mockUpdateEntry.mockResolvedValue({
        success: true,
        data: { id: 'e1' },
        auditEntries: [],
      })
      mockExtractTags.mockReturnValue(['collection:c1', 'entry:e1'])

      await executeCommand(ctx, {
        type: 'updateEntry',
        payload: { entryId: 'e1', data: { title: 'Updated' } },
        actor: { userId: 'user1', source: 'admin' },
        timestamp: new Date().toISOString(),
      })

      expect(mockExtractTags).toHaveBeenCalledWith(
        ctx.db,
        'updateEntry',
        expect.objectContaining({ entryId: 'e1' }),
        'tenant-1'
      )
      expect(mockInvalidateByTags).toHaveBeenCalledWith(ctx.db, mockKV, [
        'collection:c1',
        'entry:e1',
      ])
    })
  })

  describe('transaction handling', () => {
    it('executes sub-commands sequentially', async () => {
      mockCreateEntry.mockResolvedValue({
        success: true,
        data: { id: 'e1' },
        auditEntries: [],
      })
      mockUpdateEntry.mockResolvedValue({
        success: true,
        data: { id: 'e1' },
        auditEntries: [],
      })

      const result = await executeCommand(ctx, {
        type: 'transaction',
        payload: {
          commands: [
            {
              type: 'createEntry',
              payload: { collectionId: 'c1', data: {} },
              actor: { userId: 'user1', source: 'admin' },
              timestamp: new Date().toISOString(),
            },
            {
              type: 'updateEntry',
              payload: { entryId: 'e1', data: { title: 'Updated' } },
              actor: { userId: 'user1', source: 'admin' },
              timestamp: new Date().toISOString(),
            },
          ],
        },
        actor: { userId: 'user1', source: 'admin' },
        timestamp: new Date().toISOString(),
      })

      expect(result.type).toBe('transaction')
      expect(result.status).toBe('success')
    })

    it('stops on first failure in transaction', async () => {
      mockCreateEntry.mockResolvedValue({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Collection not found' },
      })

      const result = await executeCommand(ctx, {
        type: 'transaction',
        payload: {
          commands: [
            {
              type: 'createEntry',
              payload: { collectionId: 'bad', data: {} },
              actor: { userId: 'user1', source: 'admin' },
              timestamp: new Date().toISOString(),
            },
            {
              type: 'updateEntry',
              payload: { entryId: 'e1', data: {} },
              actor: { userId: 'user1', source: 'admin' },
              timestamp: new Date().toISOString(),
            },
          ],
        },
        actor: { userId: 'user1', source: 'admin' },
        timestamp: new Date().toISOString(),
      })

      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('TRANSACTION_FAILED')
      // Second command should not have been called
      expect(mockUpdateEntry).not.toHaveBeenCalled()
    })

    it('rejects transaction without commands array', async () => {
      const result = await executeCommand(ctx, {
        type: 'transaction',
        payload: {},
        actor: { userId: 'user1', source: 'admin' },
        timestamp: new Date().toISOString(),
      })

      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('VALIDATION_ERROR')
    })

    it('rejects transaction with empty commands array', async () => {
      const result = await executeCommand(ctx, {
        type: 'transaction',
        payload: { commands: [] },
        actor: { userId: 'user1', source: 'admin' },
        timestamp: new Date().toISOString(),
      })

      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('VALIDATION_ERROR')
      expect(mockCreateEntry).not.toHaveBeenCalled()
    })

    it('fails fast when transaction contains unknown command type', async () => {
      mockCreateEntry.mockResolvedValue({
        success: true,
        data: { id: 'e1' },
        auditEntries: [],
      })

      const result = await executeCommand(ctx, {
        type: 'transaction',
        payload: {
          commands: [
            {
              type: 'createEntry',
              payload: { collectionId: 'c1', data: {} },
              actor: { userId: 'user1', source: 'admin' },
              timestamp: new Date().toISOString(),
            },
            {
              type: 'unknownCommand' as CommandEnvelope['type'],
              payload: {},
              actor: { userId: 'user1', source: 'admin' },
              timestamp: new Date().toISOString(),
            },
          ],
        },
        actor: { userId: 'user1', source: 'admin' },
        timestamp: new Date().toISOString(),
      })

      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('VALIDATION_ERROR')
      expect(mockCreateEntry).not.toHaveBeenCalled()
    })

    it('rejects nested transactions before executing sub-commands', async () => {
      const result = await executeCommand(ctx, {
        type: 'transaction',
        payload: {
          commands: [
            {
              type: 'transaction',
              payload: { commands: [] },
              actor: { userId: 'user1', source: 'admin' },
              timestamp: new Date().toISOString(),
            } as CommandEnvelope,
          ],
        },
        actor: { userId: 'user1', source: 'admin' },
        timestamp: new Date().toISOString(),
      })

      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('VALIDATION_ERROR')
      expect(mockCreateEntry).not.toHaveBeenCalled()
      expect(mockUpdateEntry).not.toHaveBeenCalled()
    })
  })

  describe('webhook event emission', () => {
    it('does NOT emit events for dry-run commands', async () => {
      mockComputeDiff.mockResolvedValue([
        { field: 'status', before: null, after: 'draft', action: 'add' },
      ] as unknown as DiffEntry[])

      await executeCommand(ctx, {
        type: 'createEntry',
        payload: { collectionId: 'c1', data: {} },
        actor: { userId: 'user1', source: 'admin' },
        timestamp: new Date().toISOString(),
        dryRun: true,
      })

      expect(mockEventBusEmit).not.toHaveBeenCalled()
    })

    it('does NOT emit events for failed commands', async () => {
      mockCreateEntry.mockResolvedValue({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Collection not found' },
      })

      await executeCommand(ctx, {
        type: 'createEntry',
        payload: { collectionId: 'bad', data: {} },
        actor: { userId: 'user1', source: 'admin' },
        timestamp: new Date().toISOString(),
      })

      expect(mockEventBusEmit).not.toHaveBeenCalled()
    })

    it('emits entry.created event for successful createEntry', async () => {
      mockCreateEntry.mockResolvedValue({
        success: true,
        data: { id: 'e1', collectionId: 'c1' },
        auditEntries: [],
      })

      await executeCommand(ctx, {
        type: 'createEntry',
        payload: { collectionId: 'c1', data: { title: 'Test' } },
        actor: { userId: 'user1', source: 'admin' },
        timestamp: new Date().toISOString(),
      })

      expect(mockEventBusEmit).toHaveBeenCalledWith('entry.created', {
        before: null,
        after: { id: 'e1', collectionId: 'c1' },
        metadata: { commandId: 'cmd-uuid', actor: { userId: 'user1', source: 'admin' }, syncChannel: 'global' },
      })
    })

    it('emits entry.updated event for successful updateEntry', async () => {
      mockUpdateEntry.mockResolvedValue({
        success: true,
        data: { id: 'e1', data: { title: 'Updated' } },
        auditEntries: [],
      })

      await executeCommand(ctx, {
        type: 'updateEntry',
        payload: { entryId: 'e1', data: { title: 'Updated' } },
        actor: { userId: 'user1', source: 'admin' },
        timestamp: new Date().toISOString(),
      })

      expect(mockEventBusEmit).toHaveBeenCalledWith('entry.updated', {
        before: null,
        after: { id: 'e1', data: { title: 'Updated' } },
        metadata: { commandId: 'cmd-uuid', actor: { userId: 'user1', source: 'admin' }, syncChannel: 'global' },
      })
    })

    it('emits entry.deleted event for successful deleteEntry', async () => {
      mockDeleteEntry.mockResolvedValue({
        success: true,
        data: { id: 'e1' },
        auditEntries: [],
      })

      await executeCommand(ctx, {
        type: 'deleteEntry',
        payload: { entryId: 'e1' },
        actor: { userId: 'user1', source: 'admin' },
        timestamp: new Date().toISOString(),
      })

      expect(mockEventBusEmit).toHaveBeenCalledWith('entry.deleted', {
        before: null,
        after: { id: 'e1' },
        metadata: { commandId: 'cmd-uuid', actor: { userId: 'user1', source: 'admin' }, syncChannel: 'global' },
      })
    })

    it('emits entry.published event for successful publishNow', async () => {
      mockPublishNow.mockResolvedValue({
        success: true,
        data: { id: 'e1', status: 'published' },
        auditEntries: [],
      })

      await executeCommand(ctx, {
        type: 'publishNow',
        payload: { entryId: 'e1' },
        actor: { userId: 'user1', source: 'admin' },
        timestamp: new Date().toISOString(),
      })

      expect(mockEventBusEmit).toHaveBeenCalledWith('entry.published', {
        before: null,
        after: { id: 'e1', status: 'published' },
        metadata: { commandId: 'cmd-uuid', actor: { userId: 'user1', source: 'admin' }, syncChannel: 'global' },
      })
    })

    it('emits relation.linked event for successful linkRelation', async () => {
      mockLinkRelation.mockResolvedValue({
        success: true,
        data: { sourceId: 'e1', targetId: 'e2' },
        auditEntries: [],
      })

      await executeCommand(ctx, {
        type: 'linkRelation',
        payload: { sourceId: 'e1', targetId: 'e2', fieldId: 'author' },
        actor: { userId: 'user1', source: 'admin' },
        timestamp: new Date().toISOString(),
      })

      expect(mockEventBusEmit).toHaveBeenCalledWith('relation.linked', {
        before: null,
        after: { sourceId: 'e1', targetId: 'e2' },
        metadata: { commandId: 'cmd-uuid', actor: { userId: 'user1', source: 'admin' }, syncChannel: 'global' },
      })
    })

    it('does NOT throw if event emission fails', async () => {
      mockCreateEntry.mockResolvedValue({
        success: true,
        data: { id: 'e1' },
        auditEntries: [],
      })

      // Mock emit to throw an error
      mockEventBusEmit.mockRejectedValue(new Error('Queue unavailable'))

      const result = await executeCommand(ctx, {
        type: 'createEntry',
        payload: { collectionId: 'c1', data: {} },
        actor: { userId: 'user1', source: 'admin' },
        timestamp: new Date().toISOString(),
      })

      // Command should still succeed despite event emission failure
      expect(result.status).toBe('success')
      expect(mockEventBusEmit).toHaveBeenCalled()
    })
  })

  describe('sync event emission', () => {
    it('emits a sync change event for successful commands with audit entries', async () => {
      mockCreateEntry.mockResolvedValue({
        success: true,
        data: { id: 'e1', slug: 'test' },
        auditEntries: [{ entityType: 'entry', entityId: 'e1', action: 'create' }],
      })

      await executeCommand(
        {
          ...ctx,
          syncChannel: 'tenant-1',
        },
        {
          type: 'createEntry',
          payload: { collectionId: 'c1', data: { title: 'Test' } },
          actor: { userId: 'user1', source: 'admin' },
          timestamp: new Date().toISOString(),
        }
      )

      expect(mockPublishSyncEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'change' }),
        'tenant-1'
      )
    })

    it('does not emit sync change event when command has no audit entries', async () => {
      mockCreateEntry.mockResolvedValue({
        success: true,
        data: { id: 'e1' },
        auditEntries: [],
      })

      await executeCommand(ctx, {
        type: 'createEntry',
        payload: { collectionId: 'c1', data: { title: 'Test' } },
        actor: { userId: 'user1', source: 'admin' },
        timestamp: new Date().toISOString(),
      })

      expect(mockPublishSyncEvent).not.toHaveBeenCalled()
    })
  })

  describe('preview receipt consumption (C-10)', () => {
    it('consumes preview receipt directly inside executeCommand upon mutation success', async () => {
      const receiptModule = await import('@/ai/preview-receipt.service')
      const markConsumedSpy = vi.spyOn(receiptModule, 'markPreviewReceiptConsumed').mockResolvedValue(true)
      const verifyReceiptSpy = vi.spyOn(receiptModule, 'verifyPreviewReceipt').mockResolvedValue({
        valid: true,
      })

      mockCreateEntry.mockResolvedValue({
        success: true,
        data: { id: 'e1', title: 'Mutated' },
        auditEntries: [],
      })

      const result = await executeCommand(ctx, {
        type: 'createEntry',
        payload: { collectionId: 'c1', data: { title: 'Mutated' } },
        actor: { userId: 'user1', source: 'admin' },
        previewReceipt: 'rcpt-valid-1',
        timestamp: new Date().toISOString(),
      })

      expect(result.status).toBe('success')
      expect(verifyReceiptSpy).toHaveBeenCalled()
      expect(markConsumedSpy).toHaveBeenCalledWith('rcpt-valid-1', ctx.kv, undefined)

      markConsumedSpy.mockRestore()
      verifyReceiptSpy.mockRestore()
    })

    it('rejects execution when preview receipt verification fails', async () => {
      const receiptModule = await import('@/ai/preview-receipt.service')
      const verifyReceiptSpy = vi.spyOn(receiptModule, 'verifyPreviewReceipt').mockResolvedValue({
        valid: false,
        error: 'RECEIPT_ALREADY_USED',
        message: 'Preview receipt already executed',
      })

      const result = await executeCommand(ctx, {
        type: 'createEntry',
        payload: { collectionId: 'c1', data: { title: 'Replay' } },
        actor: { userId: 'user1', source: 'admin' },
        previewReceipt: 'rcpt-consumed-1',
        timestamp: new Date().toISOString(),
      })

      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('INVALID_PREVIEW_RECEIPT')
      expect(mockCreateEntry).not.toHaveBeenCalled()

      verifyReceiptSpy.mockRestore()
    })
  })

  describe('durable command idempotency (C-10)', () => {
    it('returns prior committed success result without re-executing mutations', async () => {
      const { commandsRepository } = await import('../../commands/commands.repository')
      const findByIdSpy = vi.spyOn(commandsRepository, 'findById').mockResolvedValue({
        id: 'idem_key-abc',
        commandType: 'createEntry',
        payload: { collectionId: 'c1', data: { title: 'First' } },
        actor: { userId: 'user1', source: 'admin' },
        result: { id: 'e1', title: 'First' },
        status: 'success',
        tenantScope: null,
        executedAt: '2026-06-08T00:00:00.000Z',
      })

      const result = await executeCommand(ctx, {
        type: 'createEntry',
        payload: { collectionId: 'c1', data: { title: 'First' } },
        actor: { userId: 'user1', source: 'admin' },
        idempotencyKey: 'key-abc',
        timestamp: new Date().toISOString(),
      })

      expect(result.status).toBe('success')
      expect(result.commandId).toBe('idem_key-abc')
      expect(result.data).toEqual({ id: 'e1', title: 'First' })
      expect(mockCreateEntry).not.toHaveBeenCalled()

      findByIdSpy.mockRestore()
    })

    it('returns IDEMPOTENCY_CONFLICT when key is reused with a different command type', async () => {
      const { commandsRepository } = await import('../../commands/commands.repository')
      const findByIdSpy = vi.spyOn(commandsRepository, 'findById').mockResolvedValue({
        id: 'idem_key-abc',
        commandType: 'deleteEntry',
        payload: {},
        actor: { userId: 'user1', source: 'admin' },
        result: {},
        status: 'success',
        tenantScope: null,
        executedAt: '2026-06-08T00:00:00.000Z',
      })

      const result = await executeCommand(ctx, {
        type: 'createEntry',
        payload: { collectionId: 'c1', data: { title: 'Mismatch' } },
        actor: { userId: 'user1', source: 'admin' },
        idempotencyKey: 'key-abc',
        timestamp: new Date().toISOString(),
      })

      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('IDEMPOTENCY_CONFLICT')
      expect(mockCreateEntry).not.toHaveBeenCalled()

      findByIdSpy.mockRestore()
    })

    it('returns IDEMPOTENCY_CONFLICT when key is reused with a different payload', async () => {
      const { commandsRepository } = await import('../../commands/commands.repository')
      const findByIdSpy = vi.spyOn(commandsRepository, 'findById').mockResolvedValue({
        id: 'idem_key-abc',
        commandType: 'createEntry',
        payload: { collectionId: 'c1', data: { title: 'Original' } },
        actor: { userId: 'user1', source: 'admin' },
        result: { id: 'e1' },
        status: 'success',
        tenantScope: null,
        executedAt: '2026-06-08T00:00:00.000Z',
      })

      const result = await executeCommand(ctx, {
        type: 'createEntry',
        payload: { collectionId: 'c1', data: { title: 'Different Payload' } },
        actor: { userId: 'user1', source: 'admin' },
        idempotencyKey: 'key-abc',
        timestamp: new Date().toISOString(),
      })

      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('IDEMPOTENCY_CONFLICT')
      expect(mockCreateEntry).not.toHaveBeenCalled()

      findByIdSpy.mockRestore()
    })

    it('supports durable idempotency retries for transaction commands', async () => {
      const { commandsRepository } = await import('../../commands/commands.repository')
      const findByIdSpy = vi.spyOn(commandsRepository, 'findById').mockResolvedValue({
        id: 'idem_tx-123',
        commandType: 'transaction',
        payload: { commands: [{ type: 'createEntry', payload: { a: 1 } }] },
        actor: { userId: 'user1', source: 'admin' },
        result: { subResults: [{ status: 'success' }], totalCommands: 1 },
        status: 'success',
        tenantScope: null,
        executedAt: '2026-06-08T00:00:00.000Z',
      })

      const result = await executeCommand(ctx, {
        type: 'transaction',
        payload: { commands: [{ type: 'createEntry', payload: { a: 1 } }] },
        actor: { userId: 'user1', source: 'admin' },
        idempotencyKey: 'tx-123',
        timestamp: new Date().toISOString(),
      })

      expect(result.status).toBe('success')
      expect(result.commandId).toBe('idem_tx-123')
      expect(mockCreateEntry).not.toHaveBeenCalled()

      findByIdSpy.mockRestore()
    })

    it('verifies and rejects transactions with invalid preview receipts', async () => {
      const receiptModule = await import('@/ai/preview-receipt.service')
      const verifyReceiptSpy = vi.spyOn(receiptModule, 'verifyPreviewReceipt').mockResolvedValue({
        valid: false,
        error: 'RECEIPT_ALREADY_USED',
        message: 'Preview receipt already executed',
      })

      const result = await executeCommand(ctx, {
        type: 'transaction',
        payload: { commands: [{ type: 'createEntry', payload: { a: 1 } }] },
        actor: { userId: 'user1', source: 'admin' },
        previewReceipt: 'rcpt-invalid',
        timestamp: new Date().toISOString(),
      })

      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('INVALID_PREVIEW_RECEIPT')
      expect(mockCreateEntry).not.toHaveBeenCalled()

      verifyReceiptSpy.mockRestore()
    })
  })
})

