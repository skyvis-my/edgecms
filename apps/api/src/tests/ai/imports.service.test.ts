import { beforeEach, describe, expect, it, vi } from 'bun:test'
import type { Database } from '@/database/db'
import type { Env } from '@/env'
import type { AiImportBatch, AiImportSource, AiSuggestion, AiSuggestionSet } from '../../ai/imports.repository'
import { aiImportService, buildCommandPayloads } from '../../ai/imports.service'

const mockCollectionsRepo = {
  findBySlug: vi.fn(),
  findById: vi.fn(),
}

const mockEntriesRepo = {
  findById: vi.fn(),
}

const mockAiImportsRepo = {
  createBatch: vi.fn(),
  findBatch: vi.fn(),
  updateBatch: vi.fn(),
  createSource: vi.fn(),
  listSources: vi.fn(),
  createSuggestionSet: vi.fn(),
  findSuggestionSet: vi.fn(),
  updateSuggestionSet: vi.fn(),
  latestSuggestionSet: vi.fn(),
  createSuggestions: vi.fn(),
  listSuggestions: vi.fn(),
  findSuggestion: vi.fn(),
  updateSuggestion: vi.fn(),
}

const mockExecuteCommand = vi.fn()
const mockRunContextTool = vi.fn().mockResolvedValue([])
const mockStageWordPressImportCommands = vi.fn().mockReturnValue({
  totalPosts: 1,
  commands: [],
})

vi.mock('@/collections/collections.repository', () => ({
  collectionsRepository: mockCollectionsRepo,
}))

vi.mock('@/entries/entries.repository', () => ({
  entriesRepository: mockEntriesRepo,
}))

vi.mock('../../ai/imports.repository', () => ({
  aiImportsRepository: mockAiImportsRepo,
}))

vi.mock('@/commands/engine', () => ({
  executeCommand: mockExecuteCommand,
}))

vi.mock('../../ai/context/context-gateway', () => ({
  runContextTool: mockRunContextTool,
}))

vi.mock('../../ai/wordpress-wxr-parser', () => ({
  stageWordPressImportCommands: mockStageWordPressImportCommands,
  parseWordPressWxr: vi.fn(),
  gutenbergToTipTap: vi.fn(),
}))

const baseSuggestion: AiSuggestion = {
  id: 'suggestion-1',
  suggestionSetId: 'set-1',
  tenantId: 'tenant-a',
  status: 'accepted',
  operation: 'update_entry',
  targetCollectionId: 'collection-1',
  targetCollectionSlug: 'products',
  targetEntryId: 'entry-1',
  fieldPath: 'title',
  locale: 'en',
  sourceLocale: 'en',
  suggestedValueJson: 'Imported title',
  editedValueJson: null,
  confidence: 70,
  citationsJson: [],
  warning: null,
  createdAt: '2026-06-03T00:00:00.000Z',
  updatedAt: '2026-06-03T00:00:00.000Z',
}

const mockDb = {} as Database
const mockKv = {} as KVNamespace
const mockMedia = {
  put: vi.fn().mockResolvedValue(undefined),
}
const mockEnv = {
  MEDIA: mockMedia,
} as unknown as Env

describe('aiImportService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('buildCommandPayloads', () => {
    it('maps accepted update suggestions to dry-run updateEntry commands only', () => {
      const commands = buildCommandPayloads([
        baseSuggestion,
        { ...baseSuggestion, id: 'manual-1', operation: 'manual' },
        { ...baseSuggestion, id: 'rejected-1', status: 'rejected' },
      ])

      expect(commands).toHaveLength(1)
      expect(commands[0]?.type).toBe('updateEntry')
      expect(commands[0]?.dryRun).toBe(true)
      expect(commands[0]?.payload).toEqual({
        entryId: 'entry-1',
        data: { title: 'Imported title' },
      })
    })

    it('maps accepted create suggestions to draft createEntry commands', () => {
      const commands = buildCommandPayloads([
        {
          ...baseSuggestion,
          operation: 'create_entry',
          targetEntryId: null,
          fieldPath: null,
          suggestedValueJson: { title: 'New imported product' },
        },
      ])

      expect(commands).toHaveLength(1)
      expect(commands[0]?.type).toBe('createEntry')
      expect(commands[0]?.payload).toEqual({
        collectionId: 'collection-1',
        slug: 'new-imported-product',
        status: 'draft',
        data: { title: 'New imported product' },
      })
    })
  })

  describe('createBatch', () => {
    it('throws when intent is empty or whitespace', async () => {
      await expect(
        aiImportService.createBatch(mockDb, { intent: '   ' }, 'user-1')
      ).rejects.toThrow('Intent is required')
    })

    it('validates locale formatting', async () => {
      await expect(
        aiImportService.createBatch(mockDb, { intent: 'test', sourceLocale: 'INVALID' }, 'user-1')
      ).rejects.toThrow('Unsupported locale code: INVALID')

      await expect(
        aiImportService.createBatch(mockDb, { intent: 'test', targetLocales: ['BAD'] }, 'user-1')
      ).rejects.toThrow('Unsupported locale code: BAD')
    })

    it('throws if target collection slug is not found', async () => {
      mockCollectionsRepo.findBySlug.mockResolvedValue(undefined)

      await expect(
        aiImportService.createBatch(mockDb, { intent: 'test', targetCollectionSlug: 'missing' }, 'user-1')
      ).rejects.toThrow('Target collection was not found')
    })

    it('throws if target entry id is not found', async () => {
      mockEntriesRepo.findById.mockResolvedValue(undefined)

      await expect(
        aiImportService.createBatch(mockDb, { intent: 'test', targetEntryId: 'missing-entry' }, 'user-1')
      ).rejects.toThrow('Target entry was not found')
    })

    it('creates batch successfully and defaults sourceLocale', async () => {
      mockCollectionsRepo.findBySlug.mockResolvedValue({ id: 'col-1', slug: 'articles' })
      mockEntriesRepo.findById.mockResolvedValue({ id: 'entry-1' })
      const expectedBatch = { id: 'b1', intent: 'import text' } as AiImportBatch
      mockAiImportsRepo.createBatch.mockResolvedValue(expectedBatch)

      const result = await aiImportService.createBatch(
        mockDb,
        { intent: 'import text', targetCollectionSlug: 'articles', targetEntryId: 'entry-1', targetLocales: ['fr', 'es'] },
        'user-1',
        'tenant-1'
      )

      expect(result).toBe(expectedBatch)
      expect(mockAiImportsRepo.createBatch).toHaveBeenCalledTimes(1)
      const callArg = mockAiImportsRepo.createBatch.mock.calls[0]![1]
      expect(callArg.sourceLocale).toBe('en')
      expect(callArg.targetLocalesJson).toEqual(['fr', 'es'])
    })
  })

  describe('addSource', () => {
    it('throws if import batch does not exist', async () => {
      mockAiImportsRepo.findBatch.mockResolvedValue(undefined)

      await expect(
        aiImportService.addSource(mockDb, mockEnv, 'b-none', { kind: 'text', text: 'hello' })
      ).rejects.toThrow('Import batch was not found')
    })

    it('creates text source and validates content length', async () => {
      mockAiImportsRepo.findBatch.mockResolvedValue({ id: 'b1' } as AiImportBatch)
      mockAiImportsRepo.createSource.mockImplementation(async (_db, src) => src)

      await expect(
        aiImportService.addSource(mockDb, mockEnv, 'b1', { kind: 'text', text: '   ' })
      ).rejects.toThrow('Source text is required')

      await expect(
        aiImportService.addSource(mockDb, mockEnv, 'b1', { kind: 'text', text: 'x'.repeat(100_001) })
      ).rejects.toThrow('Source text is too large')

      const src = await aiImportService.addSource(mockDb, mockEnv, 'b1', { kind: 'text', text: 'valid text' }, 'tenant-1')
      expect(src.kind).toBe('text')
      expect(src.extractedText).toBe('valid text')
      expect(src.extractionStatus).toBe('ready')
    })

    it('creates asset source', async () => {
      mockAiImportsRepo.findBatch.mockResolvedValue({ id: 'b1' } as AiImportBatch)
      mockAiImportsRepo.createSource.mockImplementation(async (_db, src) => src)

      const src = await aiImportService.addSource(
        mockDb,
        mockEnv,
        'b1',
        { kind: 'asset', existingAssetId: 'asset-123' },
        'tenant-1'
      )
      expect(src.kind).toBe('asset')
      expect(src.existingAssetId).toBe('asset-123')
    })

    it('creates file source and checks size/type limits', async () => {
      mockAiImportsRepo.findBatch.mockResolvedValue({ id: 'b1' } as AiImportBatch)
      mockAiImportsRepo.createSource.mockImplementation(async (_db, src) => src)

      // Oversized file
      const bigFile = new File(['x'.repeat(100)], 'big.txt', { type: 'text/plain' })
      Object.defineProperty(bigFile, 'size', { value: 6_000_000 })
      await expect(
        aiImportService.addSource(mockDb, mockEnv, 'b1', { kind: 'file', file: bigFile })
      ).rejects.toThrow('File is too large')

      // Unsupported type
      const badFile = new File(['audio'], 'music.mp3', { type: 'audio/mp3' })
      await expect(
        aiImportService.addSource(mockDb, mockEnv, 'b1', { kind: 'file', file: badFile })
      ).rejects.toThrow('File type is not supported')

      // Supported text file
      const textFile = new File(['file content'], 'doc.txt', { type: 'text/plain' })
      const textSource = await aiImportService.addSource(
        mockDb,
        mockEnv,
        'b1',
        { kind: 'file', file: textFile },
        'tenant-1'
      )
      expect(textSource.extractionStatus).toBe('ready')
      expect(mockMedia.put).toHaveBeenCalledTimes(1)

      // Supported image file
      const imgFile = new File([new Uint8Array([1, 2, 3])], 'photo.png', { type: 'image/png' })
      const imgSource = await aiImportService.addSource(
        mockDb,
        mockEnv,
        'b1',
        { kind: 'file', file: imgFile },
        'tenant-1'
      )
      expect(imgSource.extractionStatus).toBe('unsupported')
      expect(imgSource.mediaSummaryJson).toEqual({ filename: 'photo.png', contentType: 'image/png', sizeBytes: imgFile.size })
    })
  })

  describe('analyze', () => {
    it('throws if batch not found', async () => {
      mockAiImportsRepo.findBatch.mockResolvedValue(undefined)
      await expect(aiImportService.analyze(mockDb, 'b1')).rejects.toThrow('Import batch was not found')
    })

    it('throws if no sources are ready', async () => {
      mockAiImportsRepo.findBatch.mockResolvedValue({ id: 'b1', intent: 'test' } as AiImportBatch)
      mockAiImportsRepo.listSources.mockResolvedValue([{ extractionStatus: 'unsupported' }] as AiImportSource[])
      await expect(aiImportService.analyze(mockDb, 'b1')).rejects.toThrow('No extracted source is ready for analysis')
    })

    it('throws if target collection is missing', async () => {
      mockAiImportsRepo.findBatch.mockResolvedValue({
        id: 'b1',
        intent: 'test',
        targetCollectionSlug: 'missing',
      } as AiImportBatch)
      mockAiImportsRepo.listSources.mockResolvedValue([{ extractionStatus: 'ready', extractedText: 'content' }] as AiImportSource[])
      mockAiImportsRepo.createSuggestionSet.mockResolvedValue({ id: 's1' } as AiSuggestionSet)
      mockCollectionsRepo.findBySlug.mockResolvedValue(undefined)

      await expect(aiImportService.analyze(mockDb, 'b1')).rejects.toThrow('Target collection was not found')
    })

    it('analyzes and creates update_entry suggestion when targetEntryId is set', async () => {
      mockAiImportsRepo.findBatch.mockResolvedValue({
        id: 'b1',
        intent: 'update intent',
        targetCollectionSlug: 'posts',
        targetEntryId: 'entry-1',
        sourceLocale: 'en',
      } as AiImportBatch)
      mockAiImportsRepo.listSources.mockResolvedValue([
        { extractionStatus: 'ready', extractedText: 'analyzed content' },
      ] as AiImportSource[])
      mockAiImportsRepo.createSuggestionSet.mockResolvedValue({ id: 's1' } as AiSuggestionSet)
      mockCollectionsRepo.findBySlug.mockResolvedValue({
        id: 'col-1',
        slug: 'posts',
        defaultLocale: 'en',
        fields: [{ name: 'body', type: 'textarea' }],
      })

      const res = await aiImportService.analyze(mockDb, 'b1', 'tenant-1')
      expect(res.status).toBe('ready_for_review')
      expect(mockAiImportsRepo.createSuggestions).toHaveBeenCalledTimes(1)
      const suggestions = mockAiImportsRepo.createSuggestions.mock.calls[0]![1] as AiSuggestion[]
      expect(suggestions[0]?.operation).toBe('update_entry')
      expect(suggestions[0]?.targetEntryId).toBe('entry-1')
      expect(suggestions[0]?.fieldPath).toBe('body')
    })

    it('creates warning manual suggestion when collection has no text field', async () => {
      mockAiImportsRepo.findBatch.mockResolvedValue({
        id: 'b1',
        intent: 'create intent',
        targetCollectionSlug: 'numbers',
      } as AiImportBatch)
      mockAiImportsRepo.listSources.mockResolvedValue([
        { extractionStatus: 'ready', extractedText: 'number content' },
      ] as AiImportSource[])
      mockAiImportsRepo.createSuggestionSet.mockResolvedValue({ id: 's1' } as AiSuggestionSet)
      mockCollectionsRepo.findBySlug.mockResolvedValue({
        id: 'col-1',
        slug: 'numbers',
        defaultLocale: 'en',
        fields: [{ name: 'count', type: 'number' }],
      })

      const res = await aiImportService.analyze(mockDb, 'b1', 'tenant-1')
      expect(res.status).toBe('ready_for_review')
      const suggestions = mockAiImportsRepo.createSuggestions.mock.calls[0]![1] as AiSuggestion[]
      expect(suggestions[0]?.operation).toBe('manual')
      expect(suggestions[0]?.status).toBe('warning')
    })
  })

  describe('getBatchDetail', () => {
    it('throws if batch is missing', async () => {
      mockAiImportsRepo.findBatch.mockResolvedValue(undefined)
      await expect(aiImportService.getBatchDetail(mockDb, 'b1', 'tenant-1')).rejects.toThrow('Import batch was not found')
    })

    it('returns detail payload with sources and suggestions', async () => {
      const batch = { id: 'b1', sourceLocale: 'en', targetLocalesJson: ['fr'] } as AiImportBatch
      mockAiImportsRepo.findBatch.mockResolvedValue(batch)
      mockAiImportsRepo.listSources.mockResolvedValue([{ id: 'src-1' }] as AiImportSource[])
      mockAiImportsRepo.latestSuggestionSet.mockResolvedValue({ id: 's1', warningsJson: ['w1'] } as AiSuggestionSet)
      mockAiImportsRepo.listSuggestions.mockResolvedValue({ rows: [baseSuggestion], total: 1 })

      const detail = await aiImportService.getBatchDetail(mockDb, 'b1', 'tenant-1')
      expect(detail.batch).toBe(batch)
      expect(detail.sources).toHaveLength(1)
      expect(detail.suggestions.total).toBe(1)
      expect(detail.warnings).toEqual(['w1'])
      expect(detail.localeMatrix.targetLocales).toEqual(['fr'])
    })
  })

  describe('updateSuggestion', () => {
    it('throws if suggestion not found', async () => {
      mockAiImportsRepo.findSuggestion.mockResolvedValue(undefined)
      await expect(
        aiImportService.updateSuggestion(mockDb, 's1', 'tenant-1', { status: 'accepted' })
      ).rejects.toThrow('Suggestion was not found')
    })

    it('rejects update if suggestion is in warning status', async () => {
      mockAiImportsRepo.findSuggestion.mockResolvedValue({ ...baseSuggestion, status: 'warning' })
      await expect(
        aiImportService.updateSuggestion(mockDb, 's1', 'tenant-1', { status: 'accepted' })
      ).rejects.toThrow('Warning suggestions cannot be accepted')
    })

    it('validates target field when editedValue is supplied', async () => {
      mockAiImportsRepo.findSuggestion.mockResolvedValue({
        ...baseSuggestion,
        targetCollectionSlug: 'posts',
        fieldPath: 'invalid_field',
      })
      mockCollectionsRepo.findBySlug.mockResolvedValue({
        fields: [{ name: 'title', type: 'text' }],
      })

      await expect(
        aiImportService.updateSuggestion(mockDb, 's1', 'tenant-1', { editedValue: 'new title' })
      ).rejects.toThrow('Suggestion field path is not valid for target collection')
    })

    it('updates suggestion successfully', async () => {
      mockAiImportsRepo.findSuggestion.mockResolvedValue(baseSuggestion)
      mockAiImportsRepo.updateSuggestion.mockResolvedValue({ ...baseSuggestion, status: 'rejected' })

      const updated = await aiImportService.updateSuggestion(mockDb, 's1', 'tenant-1', { status: 'rejected' })
      expect(updated?.status).toBe('rejected')
    })
  })

  describe('dryRunSuggestionSet & applySuggestionSet', () => {
    it('dryRunSuggestionSet throws if suggestion set not found', async () => {
      mockAiImportsRepo.findSuggestionSet.mockResolvedValue(undefined)
      await expect(
        aiImportService.dryRunSuggestionSet(mockDb, mockKv, 's1', 'user-1')
      ).rejects.toThrow('Suggestion set was not found')
    })

    it('dryRunSuggestionSet executes commands in dryRun mode and records results', async () => {
      mockAiImportsRepo.findSuggestionSet.mockResolvedValue({ id: 's1' } as AiSuggestionSet)
      mockAiImportsRepo.listSuggestions.mockResolvedValue({ rows: [baseSuggestion], total: 1 })
      mockExecuteCommand.mockResolvedValue({ commandId: 'cmd-1', status: 'success' })

      const res = await aiImportService.dryRunSuggestionSet(mockDb, mockKv, 's1', 'user-1', 'tenant-1')
      expect(res.commands).toHaveLength(1)
      expect(res.commands[0]?.dryRun).toBe(true)
      expect(res.commandResults).toHaveLength(1)
      expect(mockAiImportsRepo.updateSuggestionSet).toHaveBeenCalledTimes(1)
      expect(mockAiImportsRepo.updateSuggestionSet.mock.calls[0]![3].status).toBe('dry_run_ready')
    })

    it('applySuggestionSet validates hash and executes commands in real mode', async () => {
      mockAiImportsRepo.findSuggestionSet.mockResolvedValue(undefined)
      await expect(
        aiImportService.applySuggestionSet(mockDb, mockKv, 's1', 'hash-1', 'user-1')
      ).rejects.toThrow('Suggestion set was not found')

      const cmd = {
        type: 'updateEntry' as const,
        payload: { entryId: 'e1', data: { title: 'T' } },
        actor: { userId: 'user-1', source: 'ai' as const },
        dryRun: true,
        timestamp: '2026-01-01',
      }
      const bytes = new TextEncoder().encode(JSON.stringify([cmd]))
      const digest = await crypto.subtle.digest('SHA-256', bytes)
      const correctHash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')

      mockAiImportsRepo.findSuggestionSet.mockResolvedValue({
        id: 's1',
        batchId: 'b1',
        dryRunHash: correctHash,
        dryRunPayloadJson: [cmd],
      } as AiSuggestionSet)

      // Test mismatched dryRunHash
      await expect(
        aiImportService.applySuggestionSet(mockDb, mockKv, 's1', 'mismatched-hash', 'user-1')
      ).rejects.toThrow('Latest dry-run hash is required before apply')

      // Test successful apply
      mockExecuteCommand.mockResolvedValue({ commandId: 'cmd-100', status: 'success' })
      const applyRes = await aiImportService.applySuggestionSet(mockDb, mockKv, 's1', correctHash, 'user-1', 'tenant-1')
      expect(applyRes.status).toBe('applied')
      expect(mockAiImportsRepo.updateBatch).toHaveBeenCalledWith(mockDb, 'b1', 'tenant-1', {
        status: 'applied',
        appliedCommandId: 'cmd-100',
      })
    })

    it('applySuggestionSet handles failed command execution', async () => {
      const cmd = {
        type: 'updateEntry' as const,
        payload: { entryId: 'e1', data: { title: 'T' } },
        actor: { userId: 'user-1', source: 'ai' as const },
        dryRun: true,
        timestamp: '2026-01-01',
      }
      const bytes = new TextEncoder().encode(JSON.stringify([cmd]))
      const digest = await crypto.subtle.digest('SHA-256', bytes)
      const correctHash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')

      mockAiImportsRepo.findSuggestionSet.mockResolvedValue({
        id: 's1',
        batchId: 'b1',
        dryRunHash: correctHash,
        dryRunPayloadJson: [cmd],
      } as AiSuggestionSet)
      mockExecuteCommand.mockResolvedValue({ commandId: 'cmd-err', status: 'failed' })

      const failRes = await aiImportService.applySuggestionSet(mockDb, mockKv, 's1', correctHash, 'user-1', 'tenant-1')
      expect(failRes.status).toBe('partial_failure')
      expect(mockAiImportsRepo.updateSuggestionSet).toHaveBeenCalledWith(mockDb, 's1', 'tenant-1', {
        status: 'ready',
        commandResultJson: [{ commandId: 'cmd-err', status: 'failed' }],
      })
    })
  })

  describe('stageWordPressImport', () => {
    it('throws if target collection is missing', async () => {
      mockCollectionsRepo.findBySlug.mockResolvedValue(undefined)
      await expect(
        aiImportService.stageWordPressImport(mockDb, 'missing-slug', '<xml></xml>')
      ).rejects.toThrow("Target collection 'missing-slug' was not found")
    })

    it('delegates to stageWordPressImportCommands when collection exists', async () => {
      mockCollectionsRepo.findBySlug.mockResolvedValue({ id: 'col-wp', slug: 'posts' })
      mockStageWordPressImportCommands.mockReturnValue({
        commands: [],
        summary: { totalItems: 1, stagedCount: 1, skippedCount: 0, postTypes: { post: 1 } },
      })
      const res = await aiImportService.stageWordPressImport(mockDb, 'posts', '<xml></xml>', {
        userId: 'admin-1',
        tenantId: 'tenant-1',
      })
      expect(res.summary.totalItems).toBe(1)
      expect(mockStageWordPressImportCommands).toHaveBeenCalledWith(
        '<xml></xml>',
        'col-wp',
        { postType: undefined, defaultStatus: undefined, actorUserId: 'admin-1' }
      )
    })
  })
})
