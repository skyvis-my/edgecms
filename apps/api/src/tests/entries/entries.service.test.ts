import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import type { CollectionRow } from '@/collections/collections.repository'
import type { Database } from '@/database/db'
import { entryStatuses } from '@/shared/schemas/entry'
import { asMockedObj } from '../../../test-utils/typed-mock'
import type { EntryRow } from '../../entries/entries.repository'

type EntryStatus = (typeof entryStatuses)[number]

const { entriesService } = await import(`../../entries/entries.service?bypass=${Date.now()}`)

// Mock dependencies
vi.mock('../../entries/entries.repository', () => ({
  entriesRepository: {
    findAll: vi.fn(),
    findById: vi.fn(),
    findByCollectionAndSlug: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateWithVersion: vi.fn(),
    deleteById: vi.fn(),
    createVersion: vi.fn(),
    findVersions: vi.fn(),
  },
}))

vi.mock('@/collections/collections.repository', () => ({
  collectionsRepository: {
    findAll: vi.fn(),
    findById: vi.fn(),
    findBySlug: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    deleteById: vi.fn(),
  },
}))

import { collectionsRepository } from '@/collections/collections.repository'
import { entriesRepository } from '../../entries/entries.repository'

const mockEntriesRepo = asMockedObj(entriesRepository)
const mockCollectionsRepo = asMockedObj(collectionsRepository)

describe('entriesService', () => {
  const db = {} as Database

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(
      'mock-uuid-1234' as `${string}-${string}-${string}-${string}-${string}`
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('findAll', () => {
    it('returns entries with pagination data', async () => {
      const rows = [makeEntryRow({ id: 'e1' })]
      mockEntriesRepo.findAll.mockResolvedValue({ rows, total: 1 })

      const result = await entriesService.findAll(db)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.entries).toEqual(rows)
        expect(result.data.total).toBe(1)
        expect(result.data.page).toBe(1)
        expect(result.data.perPage).toBe(20)
      }
    })

    it('validates collection exists when collectionId filter provided', async () => {
      mockCollectionsRepo.findById.mockResolvedValue(undefined)

      const result = await entriesService.findAll(db, { collectionId: 'bad-id' })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND')
      }
    })

    it('rejects invalid status filter', async () => {
      const result = await entriesService.findAll(db, { status: 'invalid-status' })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('Invalid status')
      }
    })

    it.each([...entryStatuses])('accepts valid status filter %s', async (status: EntryStatus) => {
      mockEntriesRepo.findAll.mockResolvedValue({ rows: [], total: 0 })

      const result = await entriesService.findAll(db, { status })
      expect(result.success).toBe(true)
    })

    it('continues when collectionId filter points to an existing collection', async () => {
      mockCollectionsRepo.findById.mockResolvedValue(makeCollectionRow({ id: 'c1' }))
      mockEntriesRepo.findAll.mockResolvedValue({ rows: [], total: 0 })

      const result = await entriesService.findAll(db, { collectionId: 'c1' })
      expect(result.success).toBe(true)
    })

    it('does not re-fetch a collection already resolved by slug', async () => {
      const collection = makeCollectionRow({ id: 'c1', slug: 'articles' })
      mockCollectionsRepo.findBySlug.mockResolvedValue(collection)
      mockEntriesRepo.findAll.mockResolvedValue({ rows: [], total: 0 })

      const result = await entriesService.findAll(db, { collectionSlug: 'articles' }, 'tenant-1')

      expect(result.success).toBe(true)
      expect(mockCollectionsRepo.findBySlug).toHaveBeenCalledWith(db, 'articles', 'tenant-1')
      expect(mockCollectionsRepo.findById).not.toHaveBeenCalled()
      expect(mockEntriesRepo.findAll).toHaveBeenCalledWith(
        db,
        expect.objectContaining({ collectionId: 'c1', tenantId: 'tenant-1' })
      )
    })
  })

  describe('findById', () => {
    it('returns entry when found', async () => {
      const entry = makeEntryRow({ id: 'e1' })
      mockEntriesRepo.findById.mockResolvedValue(entry)

      const result = await entriesService.findById(db, 'e1')
      expect(result).toEqual({ success: true, data: entry })
    })

    it('returns NOT_FOUND when entry does not exist', async () => {
      mockEntriesRepo.findById.mockResolvedValue(undefined)

      const result = await entriesService.findById(db, 'nonexistent')
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND')
      }
    })
  })

  describe('findByIdWithLocale', () => {
    it('returns NOT_FOUND when entry does not exist', async () => {
      mockEntriesRepo.findById.mockResolvedValue(undefined)

      const result = await entriesService.findByIdWithLocale(db, 'missing', 'en')
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND')
      }
    })

    it('returns entry as-is when no locale specified', async () => {
      const entry = makeEntryRow({
        id: 'e1',
        data: { title: { en: 'Hello', fr: 'Bonjour' } },
      })
      mockEntriesRepo.findById.mockResolvedValue(entry)

      const result = await entriesService.findByIdWithLocale(db, 'e1')
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.data).toEqual({ title: { en: 'Hello', fr: 'Bonjour' } })
      }
    })

    it('flattens localized fields to requested locale', async () => {
      const entry = makeEntryRow({
        id: 'e1',
        collectionId: 'c1',
        data: { title: { en: 'Hello', fr: 'Bonjour' }, count: 42 },
      })
      mockEntriesRepo.findById.mockResolvedValue(entry)

      const collection = makeCollectionRow({
        id: 'c1',
        fields: [
          { name: 'title', type: 'text', required: true, localizable: true },
          { name: 'count', type: 'number', required: false, localizable: false },
        ],
        defaultLocale: 'en',
      })
      mockCollectionsRepo.findById.mockResolvedValue(collection)

      const result = await entriesService.findByIdWithLocale(db, 'e1', 'fr')
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.data.title).toBe('Bonjour')
        expect(result.data.data.count).toBe(42)
      }
    })

    it('falls back to default locale when requested locale not available', async () => {
      const entry = makeEntryRow({
        id: 'e1',
        collectionId: 'c1',
        data: { title: { en: 'Hello' } },
      })
      mockEntriesRepo.findById.mockResolvedValue(entry)

      const collection = makeCollectionRow({
        id: 'c1',
        fields: [{ name: 'title', type: 'text', required: true, localizable: true }],
        defaultLocale: 'en',
      })
      mockCollectionsRepo.findById.mockResolvedValue(collection)

      const result = await entriesService.findByIdWithLocale(db, 'e1', 'de')
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.data.title).toBe('Hello')
      }
    })

    it('returns NOT_FOUND when collection for locale flattening does not exist', async () => {
      const entry = makeEntryRow({
        id: 'e1',
        collectionId: 'missing-collection',
        data: { title: { en: 'Hello' } },
      })
      mockEntriesRepo.findById.mockResolvedValue(entry)
      mockCollectionsRepo.findById.mockResolvedValue(undefined)

      const result = await entriesService.findByIdWithLocale(db, 'e1', 'en')
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND')
        expect(result.error.message).toContain('Collection')
      }
    })
  })

  describe('findAllWithLocale', () => {
    it('returns upstream error when base findAll fails', async () => {
      mockCollectionsRepo.findById.mockResolvedValue(undefined)

      const result = await entriesService.findAllWithLocale(db, {
        locale: 'fr',
        collectionId: 'missing',
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND')
      }
    })

    it('returns base result when locale is not provided', async () => {
      const rows = [makeEntryRow({ id: 'e1' })]
      mockEntriesRepo.findAll.mockResolvedValue({ rows, total: 1 })

      const result = await entriesService.findAllWithLocale(db, {})
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.entries).toEqual(rows)
      }
    })

    it('flattens localized fields and leaves entries unchanged when collection lookup fails', async () => {
      const rows = [
        makeEntryRow({
          id: 'e1',
          collectionId: 'c1',
          data: { title: { en: 'Hello', fr: 'Bonjour' }, count: 1 },
        }),
        makeEntryRow({
          id: 'e2',
          collectionId: 'missing',
          data: { title: { en: 'Fallback' } },
        }),
      ]
      mockEntriesRepo.findAll.mockResolvedValue({ rows, total: 2 })
      mockCollectionsRepo.findById
        .mockResolvedValueOnce(
          makeCollectionRow({
            id: 'c1',
            fields: [
              { name: 'title', type: 'text', required: true, localizable: true },
              { name: 'count', type: 'number', required: false, localizable: false },
            ],
            defaultLocale: 'en',
          })
        )
        .mockResolvedValueOnce(undefined)

      const result = await entriesService.findAllWithLocale(db, { locale: 'fr' })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.entries[0]?.data).toEqual({ title: 'Bonjour', count: 1 })
        expect(result.data.entries[1]?.data).toEqual({ title: { en: 'Fallback' } })
      }
    })

    it('fetches each collection once when flattening a list by locale', async () => {
      const rows = [
        makeEntryRow({
          id: 'e1',
          collectionId: 'c1',
          data: { title: { en: 'Hello', fr: 'Bonjour' } },
        }),
        makeEntryRow({
          id: 'e2',
          collectionId: 'c1',
          data: { title: { en: 'Welcome', fr: 'Bienvenue' } },
        }),
        makeEntryRow({
          id: 'e3',
          collectionId: 'c2',
          data: { title: { en: 'Other', fr: 'Autre' } },
        }),
      ]
      mockEntriesRepo.findAll.mockResolvedValue({ rows, total: 3 })
      mockCollectionsRepo.findById.mockImplementation(async (_db, id) =>
        makeCollectionRow({
          id,
          fields: [{ name: 'title', type: 'text', required: true, localizable: true }],
          defaultLocale: 'en',
        })
      )

      const result = await entriesService.findAllWithLocale(db, { locale: 'fr' }, 'tenant-1')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.entries.map((entry: EntryRow) => entry.data.title)).toEqual([
          'Bonjour',
          'Bienvenue',
          'Autre',
        ])
      }
      expect(mockCollectionsRepo.findById).toHaveBeenCalledTimes(2)
      expect(mockCollectionsRepo.findById).toHaveBeenNthCalledWith(1, db, 'c1', 'tenant-1')
      expect(mockCollectionsRepo.findById).toHaveBeenNthCalledWith(2, db, 'c2', 'tenant-1')
    })
  })

  describe('create', () => {
    it('creates entry with valid fields', async () => {
      const collection = makeCollectionRow({ id: 'c1' })
      mockCollectionsRepo.findById.mockResolvedValue(collection)
      mockEntriesRepo.findByCollectionAndSlug.mockResolvedValue(undefined)
      const created = makeEntryRow({ id: 'mock-uuid-1234', collectionId: 'c1' })
      mockEntriesRepo.create.mockResolvedValue(created)

      const result = await entriesService.create(db, {
        collectionId: 'c1',
        data: { title: 'Test' },
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toEqual(created)
      }
    })

    it.each([...entryStatuses])('accepts valid create status %s', async (status: EntryStatus) => {
      const collection = makeCollectionRow({ id: 'c1' })
      mockCollectionsRepo.findById.mockResolvedValue(collection)
      mockEntriesRepo.findByCollectionAndSlug.mockResolvedValue(undefined)
      mockEntriesRepo.create.mockResolvedValue(makeEntryRow({ id: 'mock-uuid-1234', status }))

      const result = await entriesService.create(db, {
        collectionId: 'c1',
        status,
        data: { title: 'Test' },
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.status).toBe(status)
      }
    })

    it('derives slug from title field', async () => {
      const collection = makeCollectionRow({ id: 'c1' })
      mockCollectionsRepo.findById.mockResolvedValue(collection)
      mockEntriesRepo.findByCollectionAndSlug.mockResolvedValue(undefined)
      mockEntriesRepo.create.mockResolvedValue(makeEntryRow({ slug: 'hello-world' }))

      await entriesService.create(db, {
        collectionId: 'c1',
        data: { title: 'Hello World' },
      })

      expect(mockEntriesRepo.create).toHaveBeenCalledWith(
        db,
        expect.objectContaining({ slug: 'hello-world' })
      )
    })

    it('uses provided slug and does not derive from title/name fields', async () => {
      const collection = makeCollectionRow({ id: 'c1' })
      mockCollectionsRepo.findById.mockResolvedValue(collection)
      mockEntriesRepo.findByCollectionAndSlug.mockResolvedValue(undefined)
      mockEntriesRepo.create.mockResolvedValue(makeEntryRow({ slug: 'manual-slug' }))

      await entriesService.create(db, {
        collectionId: 'c1',
        slug: 'Manual Slug',
        data: { title: 'Should Not Be Used' },
      })

      expect(mockEntriesRepo.create).toHaveBeenCalledWith(
        db,
        expect.objectContaining({ slug: 'manual-slug' })
      )
    })

    it('derives slug from localized title using defaultLocale', async () => {
      const collection = makeCollectionRow({
        id: 'c1',
        defaultLocale: 'en',
        fields: [{ name: 'title', type: 'text', required: true, localizable: true }],
        supportedLocales: ['en', 'fr'],
      })
      mockCollectionsRepo.findById.mockResolvedValue(collection)
      mockEntriesRepo.findByCollectionAndSlug.mockResolvedValue(undefined)
      mockEntriesRepo.create.mockResolvedValue(makeEntryRow())

      await entriesService.create(db, {
        collectionId: 'c1',
        data: { title: { en: 'English Title', fr: 'Titre Francais' } },
      })

      expect(mockEntriesRepo.create).toHaveBeenCalledWith(
        db,
        expect.objectContaining({ slug: 'english-title' })
      )
    })

    it('rejects localized title when default-locale value is not a string', async () => {
      const collection = makeCollectionRow({
        id: 'c1',
        defaultLocale: 'en',
        supportedLocales: ['en', 'fr'],
        fields: [{ name: 'title', type: 'text', required: true, localizable: true }],
      })
      mockCollectionsRepo.findById.mockResolvedValue(collection)

      const result = await entriesService.create(db, {
        collectionId: 'c1',
        data: { title: { en: 123 } },
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
      }
    })

    it('rejects when collection not found', async () => {
      mockCollectionsRepo.findById.mockResolvedValue(undefined)

      const result = await entriesService.create(db, {
        collectionId: 'bad-id',
        data: {},
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND')
      }
    })

    it('rejects invalid status', async () => {
      const collection = makeCollectionRow({ id: 'c1' })
      mockCollectionsRepo.findById.mockResolvedValue(collection)

      const result = await entriesService.create(db, {
        collectionId: 'c1',
        status: 'invalid',
        data: {},
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
      }
    })

    it('validates localizable fields must be objects', async () => {
      const collection = makeCollectionRow({
        id: 'c1',
        fields: [{ name: 'title', type: 'text', required: true, localizable: true }],
        supportedLocales: ['en', 'fr'],
      })
      mockCollectionsRepo.findById.mockResolvedValue(collection)

      const result = await entriesService.create(db, {
        collectionId: 'c1',
        data: { title: 'plain string' },
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('localizable')
      }
    })

    it('rejects unsupported locale keys in localizable fields', async () => {
      const collection = makeCollectionRow({
        id: 'c1',
        fields: [{ name: 'title', type: 'text', required: true, localizable: true }],
        supportedLocales: ['en', 'fr'],
      })
      mockCollectionsRepo.findById.mockResolvedValue(collection)

      const result = await entriesService.create(db, {
        collectionId: 'c1',
        data: { title: { en: 'Hello', xx: 'Bad locale' } },
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('unsupported locale')
      }
    })

    it('handles slug conflict by appending suffix', async () => {
      const collection = makeCollectionRow({
        id: 'c1',
        fields: [{ name: 'title', type: 'text', required: false, localizable: false }],
      })
      mockCollectionsRepo.findById.mockResolvedValue(collection)
      mockEntriesRepo.findByCollectionAndSlug
        .mockResolvedValueOnce(makeEntryRow({ slug: 'test' }))
        .mockResolvedValueOnce(undefined)
      mockEntriesRepo.create.mockResolvedValue(makeEntryRow({ slug: 'test-1' }))

      await entriesService.create(db, {
        collectionId: 'c1',
        slug: 'test',
        data: { title: '' },
      })

      expect(mockEntriesRepo.create).toHaveBeenCalledWith(
        db,
        expect.objectContaining({ slug: 'test-1' })
      )
    })

    it('generates UUID-based slug when no slug can be derived', async () => {
      const collection = makeCollectionRow({
        id: 'c1',
        fields: [{ name: 'title', type: 'text', required: false, localizable: false }],
      })
      mockCollectionsRepo.findById.mockResolvedValue(collection)
      mockEntriesRepo.findByCollectionAndSlug.mockResolvedValue(undefined)
      mockEntriesRepo.create.mockResolvedValue(makeEntryRow())

      await entriesService.create(db, {
        collectionId: 'c1',
        data: { unknownField: true },
      })

      expect(mockEntriesRepo.create).toHaveBeenCalledWith(
        db,
        expect.objectContaining({ slug: 'mock-uui' })
      )
    })

    it('rejects localizable fields with empty locale object', async () => {
      const collection = makeCollectionRow({
        id: 'c1',
        fields: [{ name: 'title', type: 'text', required: true, localizable: true }],
        supportedLocales: ['en', 'fr'],
      })
      mockCollectionsRepo.findById.mockResolvedValue(collection)

      const result = await entriesService.create(db, {
        collectionId: 'c1',
        data: { title: {} },
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('no locale values')
      }
    })

    it('rejects when required fields are missing', async () => {
      const collection = makeCollectionRow({
        id: 'c1',
        fields: [{ name: 'title', type: 'text', required: true, localizable: false }],
      })
      mockCollectionsRepo.findById.mockResolvedValue(collection)

      const result = await entriesService.create(db, {
        collectionId: 'c1',
        data: {},
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain("required field 'title'")
      }
    })

    it('rejects incorrect primitive field types', async () => {
      const collection = makeCollectionRow({
        id: 'c1',
        fields: [{ name: 'views', type: 'number', required: false, localizable: false }],
      })
      mockCollectionsRepo.findById.mockResolvedValue(collection)

      const result = await entriesService.create(db, {
        collectionId: 'c1',
        data: { views: '10' },
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain("Field 'views'")
      }
    })

    it('rejects invalid media field payloads', async () => {
      const collection = makeCollectionRow({
        id: 'c1',
        fields: [{ name: 'cover', type: 'media', required: false, localizable: false }],
      })
      mockCollectionsRepo.findById.mockResolvedValue(collection)

      const result = await entriesService.create(db, {
        collectionId: 'c1',
        data: { cover: { assetId: '' } },
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain("Field 'cover'")
      }
    })

    it('rejects non-json-safe values for json fields', async () => {
      const collection = makeCollectionRow({
        id: 'c1',
        fields: [{ name: 'meta', type: 'json', required: false, localizable: false }],
      })
      mockCollectionsRepo.findById.mockResolvedValue(collection)

      const result = await entriesService.create(db, {
        collectionId: 'c1',
        data: { meta: { count: 10n } },
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain("Field 'meta'")
      }
    })
  })

  describe('update', () => {
    it('updates entry and increments version', async () => {
      const existing = makeEntryRow({ id: 'e1', version: 1, collectionId: 'c1' })
      mockEntriesRepo.findById.mockResolvedValue(existing)
      mockCollectionsRepo.findById.mockResolvedValue(makeCollectionRow({ id: 'c1' }))
      mockEntriesRepo.createVersion.mockResolvedValue({} as unknown)
      const updated = makeEntryRow({ id: 'e1', version: 2 })
      mockEntriesRepo.update.mockResolvedValue(updated)

      const result = await entriesService.update(db, 'e1', { data: { title: 'New' } })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.version).toBe(2)
      }

      // Verify version snapshot was created
      expect(mockEntriesRepo.createVersion).toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          entryId: 'e1',
          version: 1,
          data: existing.data,
        })
      )

      // Verify update was called with incremented version
      expect(mockEntriesRepo.update).toHaveBeenCalledWith(
        db,
        'e1',
        expect.objectContaining({ version: 2 })
      )
    })

    it('returns NOT_FOUND when entry does not exist', async () => {
      mockEntriesRepo.findById.mockResolvedValue(undefined)

      const result = await entriesService.update(db, 'nonexistent', { data: {} })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND')
      }
    })

    it('validates localized fields on data update', async () => {
      const existing = makeEntryRow({ id: 'e1', collectionId: 'c1' })
      mockEntriesRepo.findById.mockResolvedValue(existing)
      const collection = makeCollectionRow({
        id: 'c1',
        fields: [{ name: 'title', type: 'text', required: true, localizable: true }],
        supportedLocales: ['en'],
      })
      mockCollectionsRepo.findById.mockResolvedValue(collection)

      const result = await entriesService.update(db, 'e1', {
        data: { title: 'not-an-object' },
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
      }
    })

    it('rejects invalid status on update', async () => {
      const existing = makeEntryRow({ id: 'e1', collectionId: 'c1' })
      mockEntriesRepo.findById.mockResolvedValue(existing)
      mockCollectionsRepo.findById.mockResolvedValue(makeCollectionRow({ id: 'c1' }))

      const result = await entriesService.update(db, 'e1', { status: 'invalid' })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
      }
    })

    it.each([...entryStatuses])('accepts valid update status %s', async (status: EntryStatus) => {
      const existing = makeEntryRow({ id: 'e1', collectionId: 'c1', version: 1 })
      mockEntriesRepo.findById.mockResolvedValue(existing)
      mockCollectionsRepo.findById.mockResolvedValue(makeCollectionRow({ id: 'c1' }))
      mockEntriesRepo.createVersion.mockResolvedValue({} as unknown)
      const updated = makeEntryRow({ id: 'e1', collectionId: 'c1', version: 2, status })
      mockEntriesRepo.update.mockResolvedValue(updated)

      const result = await entriesService.update(db, 'e1', { status })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.status).toBe(status)
      }
    })

    it('rejects duplicate slug on update', async () => {
      const existing = makeEntryRow({ id: 'e1', slug: 'old-slug', collectionId: 'c1' })
      mockEntriesRepo.findById.mockResolvedValue(existing)
      mockCollectionsRepo.findById.mockResolvedValue(makeCollectionRow({ id: 'c1' }))
      mockEntriesRepo.findByCollectionAndSlug.mockResolvedValue(
        makeEntryRow({ id: 'other-entry', slug: 'taken-slug' })
      )

      const result = await entriesService.update(db, 'e1', { slug: 'taken-slug' })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('DUPLICATE_SLUG')
      }
    })

    it('returns NOT_FOUND when collection is missing during update validation', async () => {
      const existing = makeEntryRow({ id: 'e1', collectionId: 'missing-collection' })
      mockEntriesRepo.findById.mockResolvedValue(existing)
      mockCollectionsRepo.findById.mockResolvedValue(undefined)

      const result = await entriesService.update(db, 'e1', { data: { title: 'x' } })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND')
        expect(result.error.message).toContain('Collection')
      }
    })

    it('returns NOT_FOUND when repository update returns undefined after version snapshot', async () => {
      const existing = makeEntryRow({ id: 'e1', version: 2, collectionId: 'c1' })
      mockEntriesRepo.findById.mockResolvedValue(existing)
      mockCollectionsRepo.findById.mockResolvedValue(makeCollectionRow({ id: 'c1' }))
      mockEntriesRepo.createVersion.mockResolvedValue({} as unknown)
      mockEntriesRepo.update.mockResolvedValue(undefined)

      const result = await entriesService.update(db, 'e1', { data: { title: 'updated' } })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND')
      }
    })

    it('slugifies updated slug when no conflict is found', async () => {
      const existing = makeEntryRow({ id: 'e1', slug: 'old', collectionId: 'c1', version: 1 })
      mockEntriesRepo.findById.mockResolvedValue(existing)
      mockCollectionsRepo.findById.mockResolvedValue(makeCollectionRow({ id: 'c1' }))
      mockEntriesRepo.findByCollectionAndSlug.mockResolvedValue(undefined)
      mockEntriesRepo.createVersion.mockResolvedValue({} as unknown)
      mockEntriesRepo.update.mockResolvedValue(
        makeEntryRow({ id: 'e1', slug: 'new-slug', version: 2 })
      )

      const result = await entriesService.update(db, 'e1', { slug: 'New Slug' })
      expect(result.success).toBe(true)
      expect(mockEntriesRepo.update).toHaveBeenCalledWith(
        db,
        'e1',
        expect.objectContaining({ slug: 'new-slug' })
      )
    })

    it('returns VERSION_CONFLICT when optimistic version does not match current entry version', async () => {
      const existing = makeEntryRow({ id: 'e1', version: 3, collectionId: 'c1' })
      mockEntriesRepo.findById.mockResolvedValue(existing)
      mockCollectionsRepo.findById.mockResolvedValue(makeCollectionRow({ id: 'c1' }))

      const result = await entriesService.update(db, 'e1', { data: { title: 'new' } }, undefined, 2)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VERSION_CONFLICT')
      }
      expect(mockEntriesRepo.createVersion).not.toHaveBeenCalled()
    })

    it('validates relation payload shape on update', async () => {
      const existing = makeEntryRow({ id: 'e1', collectionId: 'c1' })
      mockEntriesRepo.findById.mockResolvedValue(existing)
      mockCollectionsRepo.findById.mockResolvedValue(
        makeCollectionRow({
          id: 'c1',
          fields: [
            {
              name: 'related',
              type: 'relation',
              required: false,
              localizable: false,
              options: { relationType: 'one-to-many' },
            },
          ],
        })
      )

      const result = await entriesService.update(db, 'e1', {
        data: { related: 'entry-a' },
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain("Field 'related'")
      }
    })
  })

  describe('deleteById', () => {
    it('deletes an existing entry', async () => {
      mockEntriesRepo.deleteById.mockResolvedValue(true)

      const result = await entriesService.deleteById(db, 'e1')
      expect(result).toEqual({ success: true, data: { id: 'e1' } })
    })

    it('returns NOT_FOUND when entry does not exist', async () => {
      mockEntriesRepo.deleteById.mockResolvedValue(false)

      const result = await entriesService.deleteById(db, 'nonexistent')
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND')
      }
    })
  })
})

// ============================================================================
// Helpers
// ============================================================================

function makeEntryRow(overrides: Partial<EntryRow> = {}): EntryRow {
  return {
    id: 'test-entry-id',
    collectionId: 'test-collection-id',
    slug: 'test-entry',
    status: 'draft',
    data: { title: 'Test Entry' },
    version: 1,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    publishAt: null,
    unpublishAt: null,
    ...overrides,
  }
}

function makeCollectionRow(overrides: Partial<CollectionRow> = {}): CollectionRow {
  return {
    id: 'test-collection-id',
    tenantId: 'tenant-1',
    name: 'Test Collection',
    slug: 'test-collection',
    singleton: false,
    fields: [{ name: 'title', type: 'text', required: true, localizable: false }],
    defaultLocale: 'en',
    supportedLocales: ['en'],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    displayName: null,
    description: null,
    icon: null,
    color: null,
    listFields: null,
    searchFields: null,
    defaultSort: null,
    defaultSortOrder: null,
    ...overrides,
  }
}
