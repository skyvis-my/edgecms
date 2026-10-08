import { describe, expect, it, vi } from 'bun:test'
import type { Collection, Entry } from '../../../ai/context/context-builder'

const { buildContextPack, formatContextPack } = await import(
  `../../../ai/context/context-builder?bypass=${Date.now()}`
)

vi.mock('@/collections/collections.repository', () => ({
  collectionsRepository: {
    findAll: vi.fn(),
  },
}))
vi.mock('@/entries/entries.repository', () => ({
  entriesRepository: {
    findById: vi.fn(),
  },
}))

const { buildContextPackFromDb } = await import(
  `../../../ai/context/context-builder?bypass=db-${Date.now()}`
)
const { collectionsRepository } = await import('@/collections/collections.repository')
const { entriesRepository } = await import('@/entries/entries.repository')
const mockedCollectionsRepository = collectionsRepository as unknown as {
  findAll: ReturnType<typeof vi.fn>
}
const mockedEntriesRepository = entriesRepository as unknown as {
  findById: ReturnType<typeof vi.fn>
}

const collections: Collection[] = [
  {
    id: 'c-posts',
    name: 'Posts',
    slug: 'posts',
    singleton: false,
    defaultLocale: 'en',
    supportedLocales: ['en', 'fr'],
    fields: [
      { name: 'title', type: 'text', required: true, localizable: true },
      {
        name: 'author',
        type: 'relation',
        required: false,
        localizable: false,
        options: { collection: 'c-authors', relationType: 'many-to-one' },
      },
      {
        name: 'tags',
        type: 'reference',
        required: false,
        localizable: false,
        options: { collection: 'c-tags', multiple: true },
      },
    ],
  },
  {
    id: 'c-authors',
    name: 'Authors',
    slug: 'authors',
    singleton: false,
    defaultLocale: 'en',
    supportedLocales: ['en'],
    fields: [],
  },
]

describe('context-builder', () => {
  it('buildContextPack maps relation/reference fields for a selected collection', () => {
    const context = buildContextPack({
      collections,
      collectionSlug: 'posts',
      locale: 'fr',
      tenant: { slug: 'acme', name: 'Acme' },
    })

    expect(context.locale).toBe('fr')
    expect(context.tenant).toEqual({ slug: 'acme', name: 'Acme' })
    expect(context.availableRelations?.length).toBe(2)
    expect(context.availableRelations?.[0]?.fieldName).toBe('author')
    expect(context.availableRelations?.[0]?.relationType).toBe('many-to-one')
    expect(context.availableRelations?.[0]?.targetCollection?.id).toBe('c-authors')
    expect(context.availableRelations?.[1]?.relationType).toBe('one-to-many')
  })

  it('buildContextPack falls back to default locale and empty relation list when collection missing', () => {
    const context = buildContextPack({ collections, collectionSlug: 'missing' })
    expect(context.locale).toBe('en')
    expect(context.availableRelations).toBeUndefined()
  })

  it('formatContextPack renders all present sections', () => {
    const currentEntry: Entry = {
      id: 'e1',
      collectionId: 'c-posts',
      slug: 'hello-world',
      status: 'draft',
      data: { title: { en: 'Hello' } },
      version: 3,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    }
    const related: Entry[] = [
      {
        id: 'e2',
        collectionId: 'c-authors',
        slug: 'jane-doe',
        status: 'published',
        data: {},
        version: 1,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
    ]

    const output = formatContextPack({
      collections,
      locale: 'en',
      tenant: { slug: 'acme', name: 'Acme' },
      currentEntry,
      relatedEntries: related,
      availableRelations: [
        {
          fieldName: 'author',
          targetCollection: collections[1],
          relationType: 'many-to-one',
        },
      ],
    })

    expect(output).toContain('**Workspace**: Acme (acme)')
    expect(output).toContain('**Current Locale**: en')
    expect(output).toContain('Collection: Posts')
    expect(output).toContain('author → Authors (many-to-one)')
    expect(output).toContain('Authors: jane-doe')
  })

  it('buildContextPackFromDb loads collections and optional current entry from repositories', async () => {
    mockedCollectionsRepository.findAll.mockResolvedValueOnce(collections)
    mockedEntriesRepository.findById.mockResolvedValueOnce({
      id: 'e1',
      collectionId: 'c-posts',
      slug: 'hello-world',
      status: 'draft',
      data: { title: { en: 'Hello' } },
      version: 3,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    })

    const context = await buildContextPackFromDb({
      db: {} as D1Database,
      collectionSlug: 'posts',
      entryId: 'e1',
      tenantId: 'tenant-a',
      locale: 'en',
    })

    expect(context.collections.length).toBe(2)
    expect(context.currentEntry?.id).toBe('e1')
    expect(mockedCollectionsRepository.findAll).toHaveBeenCalledWith({} as D1Database, 'tenant-a')
    expect(mockedEntriesRepository.findById).toHaveBeenCalledWith({} as D1Database, 'e1', 'tenant-a')
  })
})
