/**
 * AI-08 / AI-05: an AI import is applied only through a preview receipt that
 * matches the reviewed dry-run, is bound to the reviewer and tenant, and is
 * single use. The preview itself writes no content.
 */
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import type { Database } from '@/database/db'
import type { AiSuggestion, AiSuggestionSet } from '../../ai/imports.repository'

const mockAiImportsRepo = {
  findSuggestionSet: vi.fn(),
  updateSuggestionSet: vi.fn(),
  listSuggestions: vi.fn(),
  updateBatch: vi.fn(),
}
const mockExecuteCommand = vi.fn()

vi.mock('../../ai/imports.repository', () => ({ aiImportsRepository: mockAiImportsRepo }))
vi.mock('@/commands/engine', () => ({ executeCommand: mockExecuteCommand }))
vi.mock('../../ai/context/context-gateway', () => ({ runContextTool: vi.fn().mockResolvedValue([]) }))

const { aiImportService } = await import('../../ai/imports.service')
const { __resetPreviewReceiptStoreForTests } = await import('../../ai/preview-receipt.service')

const db = {} as Database
const kv = {} as KVNamespace

const accepted: AiSuggestion = {
  id: 'sug-1',
  suggestionSetId: 'set-1',
  tenantId: 'tenant-a',
  status: 'accepted',
  operation: 'update_entry',
  targetCollectionId: 'col-1',
  targetCollectionSlug: 'posts',
  targetEntryId: 'entry-1',
  fieldPath: 'title',
  locale: 'en',
  sourceLocale: 'en',
  suggestedValueJson: 'Imported title',
  editedValueJson: null,
  confidence: 70,
  citationsJson: [],
  warning: null,
  createdAt: '2026-11-05T00:00:00.000Z',
  updatedAt: '2026-11-05T00:00:00.000Z',
}

/** In-memory suggestion set that reflects what dry-run stored. */
let stored: AiSuggestionSet

function liveCalls() {
  return mockExecuteCommand.mock.calls.filter(([, command]) => command.dryRun === false)
}

async function dryRun(userId = 'reviewer', tenantId = 'tenant-a') {
  return aiImportService.dryRunSuggestionSet(db, kv, 'set-1', userId, tenantId)
}

describe('AI import apply requires an AI-05 preview receipt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetPreviewReceiptStoreForTests()
    stored = { id: 'set-1', batchId: 'batch-1', status: 'ready' } as AiSuggestionSet
    mockAiImportsRepo.findSuggestionSet.mockImplementation(async () => stored)
    mockAiImportsRepo.updateSuggestionSet.mockImplementation(async (_db, _id, _tenant, patch) => {
      stored = { ...stored, ...patch }
      return stored
    })
    mockAiImportsRepo.listSuggestions.mockResolvedValue({ rows: [accepted], total: 1 })
    mockExecuteCommand.mockImplementation(async (_ctx, command) => ({
      commandId: `cmd-${mockExecuteCommand.mock.calls.length}`,
      status: command.dryRun ? 'dry_run' : 'success',
    }))
  })

  it('dry-run runs every command as a dry run and returns a receipt', async () => {
    const preview = await dryRun()
    expect(mockExecuteCommand.mock.calls.every(([, command]) => command.dryRun === true)).toBe(true)
    expect(preview.previewReceipt).toMatch(/^rcpt_/)
    expect(typeof preview.expiresAt).toBe('string')
  })

  it('refuses apply without a preview receipt and runs nothing', async () => {
    const preview = await dryRun()
    await expect(
      aiImportService.applySuggestionSet(db, kv, 'set-1', preview.dryRunHash, 'reviewer', 'tenant-a')
    ).rejects.toThrow(/preview receipt/i)
    expect(liveCalls()).toHaveLength(0)
  })

  it('applies once with the matching receipt', async () => {
    const preview = await dryRun()
    const result = await aiImportService.applySuggestionSet(
      db, kv, 'set-1', preview.dryRunHash, 'reviewer', 'tenant-a', undefined, undefined, preview.previewReceipt
    )
    expect(result.status).toBe('applied')
    expect(liveCalls()).toHaveLength(1)
  })

  it('refuses a replay of the same receipt', async () => {
    const preview = await dryRun()
    await aiImportService.applySuggestionSet(
      db, kv, 'set-1', preview.dryRunHash, 'reviewer', 'tenant-a', undefined, undefined, preview.previewReceipt
    )
    stored = { ...stored, status: 'dry_run_ready' } // even if the set were reset
    await expect(
      aiImportService.applySuggestionSet(
        db, kv, 'set-1', preview.dryRunHash, 'reviewer', 'tenant-a', undefined, undefined, preview.previewReceipt
      )
    ).rejects.toMatchObject({ code: 'RECEIPT_ALREADY_USED' })
    expect(liveCalls()).toHaveLength(1)
  })

  it('refuses another actor using the reviewer receipt', async () => {
    const preview = await dryRun('reviewer')
    await expect(
      aiImportService.applySuggestionSet(
        db, kv, 'set-1', preview.dryRunHash, 'someone-else', 'tenant-a', undefined, undefined, preview.previewReceipt
      )
    ).rejects.toThrow() // stale payload (actor is part of it) or ACTOR_MISMATCH
    expect(liveCalls()).toHaveLength(0)
  })

  it('refuses the receipt from another tenant', async () => {
    const preview = await dryRun('reviewer', 'tenant-a')
    await expect(
      aiImportService.applySuggestionSet(
        db, kv, 'set-1', preview.dryRunHash, 'reviewer', 'tenant-b', undefined, undefined, preview.previewReceipt
      )
    ).rejects.toMatchObject({ code: expect.stringMatching(/TENANT_MISMATCH|RECEIPT_NOT_FOUND/) })
    expect(liveCalls()).toHaveLength(0)
  })

  it('refuses an old receipt after the set was dry-run again with different suggestions', async () => {
    const first = await dryRun('reviewer')
    mockAiImportsRepo.listSuggestions.mockResolvedValue({
      rows: [{ ...accepted, editedValueJson: 'Changed after review' }],
      total: 1,
    })
    const second = await dryRun('reviewer')
    await expect(
      aiImportService.applySuggestionSet(
        db, kv, 'set-1', second.dryRunHash, 'reviewer', 'tenant-a', undefined, undefined, first.previewReceipt
      )
    ).rejects.toMatchObject({ code: 'HASH_MISMATCH' })
    expect(liveCalls()).toHaveLength(0)
  })

  it('refuses to dry-run or apply a set that was already applied', async () => {
    const preview = await dryRun()
    await aiImportService.applySuggestionSet(
      db, kv, 'set-1', preview.dryRunHash, 'reviewer', 'tenant-a', undefined, undefined, preview.previewReceipt
    )
    expect(stored.status).toBe('applied')
    await expect(dryRun()).rejects.toThrow(/already applied/i)
  })

  it('does not issue a receipt when a dry-run command fails', async () => {
    mockExecuteCommand.mockResolvedValue({ commandId: 'cmd-x', status: 'failed', error: 'bad' })
    const preview = await dryRun()
    expect(preview.previewReceipt).toBeUndefined()
  })
})
