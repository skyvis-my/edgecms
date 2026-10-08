import { beforeEach, describe, expect, it, vi } from 'bun:test'
import type { Database } from '@/database/db'
import type { EntryRow } from '@/entries/entries.repository'

const { computeDiff } = await import(`../../commands/diff.service?bypass=${Date.now()}`)

import type { CommandContext } from '../../commands/engine'

vi.mock('@/entries/entries.repository', () => ({
  entriesRepository: {
    findById: vi.fn(),
    findAll: vi.fn(),
  },
}))

import { entriesRepository } from '@/entries/entries.repository'

const mockEntriesRepo = entriesRepository as unknown as {
  findById: ReturnType<typeof vi.fn>
  findAll: ReturnType<typeof vi.fn>
}

describe('computeDiff', () => {
  let ctx: CommandContext

  beforeEach(() => {
    vi.clearAllMocks()
    ctx = {
      db: {} as unknown as Database,
      actor: { userId: 'user1', source: 'admin' },
    }
  })

  describe('createEntry', () => {
    it('returns add diffs for all fields', async () => {
      const diffs = await computeDiff(ctx, 'createEntry', {
        collectionId: 'c1',
        slug: 'test',
        status: 'draft',
        data: { title: 'Hello', body: 'World' },
      })

      expect(diffs).toContainEqual({ field: 'status', before: null, after: 'draft', action: 'add' })
      expect(diffs).toContainEqual({ field: 'slug', before: null, after: 'test', action: 'add' })
      expect(diffs).toContainEqual({ field: 'title', before: null, after: 'Hello', action: 'add' })
      expect(diffs).toContainEqual({ field: 'body', before: null, after: 'World', action: 'add' })
    })

    it('defaults status to draft', async () => {
      const diffs = await computeDiff(ctx, 'createEntry', {
        collectionId: 'c1',
        data: { title: 'Test' },
      })

      const statusDiff = diffs.find((d: { field: string; after: unknown }) => d.field === 'status')
      expect(statusDiff?.after).toBe('draft')
    })
  })

  describe('updateEntry', () => {
    it('computes update diffs against existing entry', async () => {
      mockEntriesRepo.findById.mockResolvedValue(
        makeEntry({
          id: 'e1',
          slug: 'old-slug',
          status: 'draft',
          data: { title: 'Old Title', body: 'Old Body' },
        })
      )

      const diffs = await computeDiff(ctx, 'updateEntry', {
        entryId: 'e1',
        slug: 'new-slug',
        status: 'published',
        data: { title: 'New Title' },
      })

      expect(diffs).toContainEqual({
        field: 'slug',
        before: 'old-slug',
        after: 'new-slug',
        action: 'update',
      })
      expect(diffs).toContainEqual({
        field: 'status',
        before: 'draft',
        after: 'published',
        action: 'update',
      })
      expect(diffs).toContainEqual({
        field: 'title',
        before: 'Old Title',
        after: 'New Title',
        action: 'update',
      })
    })

    it('returns empty diffs when entry not found', async () => {
      mockEntriesRepo.findById.mockResolvedValue(undefined)

      const diffs = await computeDiff(ctx, 'updateEntry', {
        entryId: 'nonexistent',
        data: { title: 'X' },
      })

      expect(diffs).toEqual([])
    })

    it('detects add action for new fields', async () => {
      mockEntriesRepo.findById.mockResolvedValue(makeEntry({ id: 'e1', data: { title: 'Test' } }))

      const diffs = await computeDiff(ctx, 'updateEntry', {
        entryId: 'e1',
        data: { newField: 'value' },
      })

      const newFieldDiff = diffs.find(
        (d: { field: string; action: string; before?: unknown }) => d.field === 'newField'
      )
      expect(newFieldDiff?.action).toBe('add')
      expect(newFieldDiff?.before).toBeUndefined()
    })
  })

  describe('deleteEntry', () => {
    it('returns remove diffs for all fields', async () => {
      mockEntriesRepo.findById.mockResolvedValue(
        makeEntry({
          id: 'e1',
          slug: 'test',
          status: 'published',
          data: { title: 'Test', body: 'Content' },
        })
      )

      const diffs = await computeDiff(ctx, 'deleteEntry', { entryId: 'e1' })

      expect(diffs).toContainEqual({
        field: 'status',
        before: 'published',
        after: null,
        action: 'remove',
      })
      expect(diffs).toContainEqual({
        field: 'slug',
        before: 'test',
        after: null,
        action: 'remove',
      })
      expect(diffs).toContainEqual({
        field: 'title',
        before: 'Test',
        after: null,
        action: 'remove',
      })
    })

    it('returns empty diffs when entry not found', async () => {
      mockEntriesRepo.findById.mockResolvedValue(undefined)

      const diffs = await computeDiff(ctx, 'deleteEntry', { entryId: 'missing' })
      expect(diffs).toEqual([])
    })
  })

  describe('bulkUpdate', () => {
    it('returns diffs prefixed with entry IDs', async () => {
      mockEntriesRepo.findById
        .mockResolvedValueOnce(makeEntry({ id: 'e1', status: 'draft', data: {} }))
        .mockResolvedValueOnce(makeEntry({ id: 'e2', status: 'draft', data: {} }))

      const diffs = await computeDiff(ctx, 'bulkUpdate', {
        entryIds: ['e1', 'e2'],
        updates: { status: 'published' },
      })

      expect(diffs).toContainEqual({
        field: '[e1].status',
        before: 'draft',
        after: 'published',
        action: 'update',
      })
      expect(diffs).toContainEqual({
        field: '[e2].status',
        before: 'draft',
        after: 'published',
        action: 'update',
      })
    })
  })

  describe('updateSingleton', () => {
    it('computes update diff when singleton entry exists', async () => {
      mockEntriesRepo.findAll.mockResolvedValue({
        rows: [makeEntry({ id: 'e1', data: { title: 'Old' } })],
        total: 1,
      })
      mockEntriesRepo.findById.mockResolvedValue(makeEntry({ id: 'e1', data: { title: 'Old' } }))

      const diffs = await computeDiff(ctx, 'updateSingleton', {
        collectionId: 'c1',
        data: { title: 'New' },
      })

      expect(diffs).toContainEqual({
        field: 'title',
        before: 'Old',
        after: 'New',
        action: 'update',
      })
    })

    it('computes create diff when no singleton entry exists', async () => {
      mockEntriesRepo.findAll.mockResolvedValue({ rows: [], total: 0 })

      const diffs = await computeDiff(ctx, 'updateSingleton', {
        collectionId: 'c1',
        data: { title: 'New' },
      })

      expect(diffs).toContainEqual({
        field: 'title',
        before: null,
        after: 'New',
        action: 'add',
      })
    })
  })

  describe('linkRelation', () => {
    it('returns add diff for the relation field', async () => {
      const diffs = await computeDiff(ctx, 'linkRelation', {
        fieldName: 'author',
        targetEntryId: 'e2',
        sourceEntryId: 'e1',
      })

      expect(diffs).toEqual([{ field: 'author', before: null, after: 'e2', action: 'add' }])
    })
  })

  describe('unlinkRelation', () => {
    it('returns remove diff for the relation field', async () => {
      const diffs = await computeDiff(ctx, 'unlinkRelation', {
        fieldName: 'author',
        targetEntryId: 'e2',
        sourceEntryId: 'e1',
      })

      expect(diffs).toEqual([{ field: 'author', before: 'e2', after: null, action: 'remove' }])
    })
  })

  describe('publishNow', () => {
    it('returns status update diff', async () => {
      mockEntriesRepo.findById.mockResolvedValue(makeEntry({ id: 'e1', status: 'draft' }))

      const diffs = await computeDiff(ctx, 'publishNow', { entryId: 'e1' })
      expect(diffs).toEqual([
        { field: 'status', before: 'draft', after: 'published', action: 'update' },
      ])
    })
  })

  describe('unpublishNow', () => {
    it('returns status update diff', async () => {
      mockEntriesRepo.findById.mockResolvedValue(makeEntry({ id: 'e1', status: 'published' }))

      const diffs = await computeDiff(ctx, 'unpublishNow', { entryId: 'e1' })
      expect(diffs).toEqual([
        { field: 'status', before: 'published', after: 'draft', action: 'update' },
      ])
    })
  })

  describe('unknown command type', () => {
    it('returns empty diffs', async () => {
      const diffs = await computeDiff(ctx, 'unknownType', {})
      expect(diffs).toEqual([])
    })
  })
})

// ============================================================================
// Helpers
// ============================================================================

function makeEntry(overrides: Partial<EntryRow> = {}): EntryRow {
  return {
    id: 'test-entry',
    collectionId: 'c1',
    slug: 'test',
    status: 'draft',
    data: {},
    version: 1,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    publishAt: null,
    unpublishAt: null,
    ...overrides,
  }
}
