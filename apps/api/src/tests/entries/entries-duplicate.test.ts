import { describe, it, expect } from 'bun:test'
import type { Database } from '@/database/db'
import type { EntryRow } from '@/entries/entries.repository'
import { entriesRepository } from '@/entries/entries.repository'

const { entriesService } = await import(`@/entries/entries.service?bypass=${Date.now()}`)

describe('entriesService.duplicate', () => {
  const mockDb = {} as Database

  it('creates a new entry with cloned data and draft status', async () => {
    // Setup mock data
    const originalEntry: EntryRow = {
      id: 'entry-1',
      collectionId: 'col-1',
      slug: 'original-slug',
      status: 'published',
      data: { title: 'Original Title', content: 'Original Content' },
      version: 3,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-02T00:00:00Z',
      publishAt: null,
      unpublishAt: null,
    }

    // Mock the repository methods
    entriesRepository.findById = async () => originalEntry
    entriesRepository.findByCollectionAndSlug = async () => undefined
    entriesRepository.create = async (_db, data) => data as EntryRow

    const result = await entriesService.duplicate(mockDb, 'entry-1', 'user-1', 'tenant-1')

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.slug).toBe('original-slug-copy')
      expect(result.data.status).toBe('draft')
      expect(result.data.version).toBe(1)
      expect(result.data.data).toEqual(originalEntry.data)
    }
  })

  it('returns NOT_FOUND for non-existent entry', async () => {
    entriesRepository.findById = async () => undefined

    const result = await entriesService.duplicate(mockDb, 'non-existent-id', 'user-1', 'tenant-1')

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('NOT_FOUND')
    }
  })

  it('generates unique slug with suffix if copy already exists', async () => {
    const originalEntry: EntryRow = {
      id: 'entry-1',
      collectionId: 'col-1',
      slug: 'original-slug',
      status: 'published',
      data: { title: 'Original Title' },
      version: 1,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      publishAt: null,
      unpublishAt: null,
    }

    let slugCheckCount = 0
    entriesRepository.findById = async () => originalEntry
    entriesRepository.findByCollectionAndSlug = async (_db, _collectionId, slug) => {
      // First check: original-slug-copy exists
      // Second check: original-slug-copy-1 exists  
      // Third check: original-slug-copy-2 is available
      slugCheckCount++
      if (slug === 'original-slug-copy' && slugCheckCount === 1) {
        return { id: 'existing-copy-1' } as EntryRow
      }
      if (slug === 'original-slug-copy-1' && slugCheckCount === 2) {
        return { id: 'existing-copy-2' } as EntryRow
      }
      return undefined
    }
    entriesRepository.create = async (_db, data) => data as EntryRow

    const result = await entriesService.duplicate(mockDb, 'entry-1', 'user-1', 'tenant-1')

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.slug).toBe('original-slug-copy-2')
    }
  })

  it('does not copy publish or unpublish schedules', async () => {
    const originalEntry: EntryRow = {
      id: 'entry-scheduled',
      collectionId: 'col-1',
      slug: 'scheduled-entry',
      status: 'scheduled',
      data: { title: 'Scheduled Title' },
      version: 4,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-02T00:00:00Z',
      publishAt: '2026-07-01T00:00:00.000Z',
      unpublishAt: '2026-08-01T00:00:00.000Z',
    }

    entriesRepository.findById = async () => originalEntry
    entriesRepository.findByCollectionAndSlug = async () => undefined
    entriesRepository.create = async (_db, data) => data as EntryRow

    const result = await entriesService.duplicate(mockDb, 'entry-scheduled', 'user-1', 'tenant-1')

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.status).toBe('draft')
      expect(result.data.publishAt).toBeUndefined()
      expect(result.data.unpublishAt).toBeUndefined()
    }
  })

  it('preserves localized field data across all locales', async () => {
    const localizedData = {
      title: { en: 'Hello World', fr: 'Bonjour le monde', de: 'Hallo Welt' },
      description: { en: 'A description', fr: 'Une description', de: 'Eine Beschreibung' },
      category: 'news',
    }

    const originalEntry: EntryRow = {
      id: 'entry-localized',
      collectionId: 'col-1',
      slug: 'localized-entry',
      status: 'published',
      data: localizedData,
      version: 2,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-02T00:00:00Z',
      publishAt: null,
      unpublishAt: null,
    }

    entriesRepository.findById = async () => originalEntry
    entriesRepository.findByCollectionAndSlug = async () => undefined
    entriesRepository.create = async (_db, data) => data as EntryRow

    const result = await entriesService.duplicate(mockDb, 'entry-localized', 'user-1', 'tenant-1')

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.data).toEqual(localizedData)
      const clonedTitle = result.data.data.title as Record<string, string>
      expect(clonedTitle.en).toBe('Hello World')
      expect(clonedTitle.fr).toBe('Bonjour le monde')
      expect(clonedTitle.de).toBe('Hallo Welt')
      expect(result.data.data.category).toBe('news')
    }
  })
})
