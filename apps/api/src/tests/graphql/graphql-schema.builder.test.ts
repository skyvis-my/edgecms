import { beforeEach, describe, expect, it, vi } from 'bun:test'
import {
  execute,
  Kind,
  parse,
  type ObjectValueNode,
  type ListValueNode,
} from 'graphql'
import type { Database } from '@/database/db'
import {
  buildDynamicGraphQLSchema,
  clearGraphQLSchemaCache,
  GraphQLJSON,
  toGraphQLFieldName,
  toGraphQLTypeName,
} from '../../graphql/graphql-schema.builder'

const mockCollectionsRepo = {
  findAll: vi.fn(),
}

const mockEntriesRepo = {
  findAll: vi.fn(),
  findById: vi.fn(),
  findByCollectionAndSlug: vi.fn(),
}

vi.mock('@/collections/collections.repository', () => ({
  collectionsRepository: mockCollectionsRepo,
}))

vi.mock('@/entries/entries.repository', () => ({
  entriesRepository: mockEntriesRepo,
}))

const mockDb = {} as Database

describe('graphql-schema.builder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearGraphQLSchemaCache()
  })

  describe('toGraphQLTypeName', () => {
    it('formats normal slugs into PascalCase', () => {
      expect(toGraphQLTypeName('blog-posts')).toBe('BlogPosts')
      expect(toGraphQLTypeName('article_category')).toBe('ArticleCategory')
    })

    it('prefixes leading numbers with Col_', () => {
      expect(toGraphQLTypeName('123items')).toBe('Col_123items')
    })

    it('falls back to ContentItem for empty or all-special strings', () => {
      expect(toGraphQLTypeName('')).toBe('ContentItem')
      expect(toGraphQLTypeName('---')).toBe('ContentItem')
    })
  })

  describe('toGraphQLFieldName', () => {
    it('formats names into camelCase', () => {
      expect(toGraphQLFieldName('Post Title')).toBe('postTitle')
      expect(toGraphQLFieldName('user_first_name')).toBe('userFirstName')
    })

    it('prefixes leading numbers with f_', () => {
      expect(toGraphQLFieldName('1stPlace')).toBe('f_1stPlace')
    })

    it('falls back to item for empty strings', () => {
      expect(toGraphQLFieldName('')).toBe('item')
      expect(toGraphQLFieldName('!@#')).toBe('item')
    })
  })

  describe('GraphQLJSON scalar', () => {
    it('serialize and parseValue pass value through', () => {
      const obj = { a: 1, b: 'two' }
      expect(GraphQLJSON.serialize(obj)).toBe(obj)
      expect(GraphQLJSON.parseValue(obj)).toBe(obj)
    })

    it('parseLiteral parses all supported AST kinds', () => {
      expect(GraphQLJSON.parseLiteral({ kind: Kind.STRING, value: 'hello' } as any, {})).toBe('hello')
      expect(GraphQLJSON.parseLiteral({ kind: Kind.BOOLEAN, value: true } as any, {})).toBe(true)
      expect(GraphQLJSON.parseLiteral({ kind: Kind.INT, value: '42' } as any, {})).toBe(42)
      expect(GraphQLJSON.parseLiteral({ kind: Kind.FLOAT, value: '3.14' } as any, {})).toBe(3.14)
      expect(GraphQLJSON.parseLiteral({ kind: Kind.NULL } as any, {})).toBeNull()
      expect(GraphQLJSON.parseLiteral({ kind: Kind.VARIABLE, name: { kind: Kind.NAME, value: 'x' } } as any, {})).toBeNull()

      const listNode: ListValueNode = {
        kind: Kind.LIST,
        values: [
          { kind: Kind.STRING, value: 'first' },
          { kind: Kind.INT, value: '2' },
        ],
      }
      expect(GraphQLJSON.parseLiteral(listNode as any, {})).toEqual(['first', 2])

      const objNode: ObjectValueNode = {
        kind: Kind.OBJECT,
        fields: [
          {
            kind: Kind.OBJECT_FIELD,
            name: { kind: Kind.NAME, value: 'key' },
            value: { kind: Kind.STRING, value: 'val' },
          },
        ],
      }
      expect(GraphQLJSON.parseLiteral(objNode as any, {})).toEqual({ key: 'val' })
    })
  })

  describe('buildDynamicGraphQLSchema & query resolution', () => {
    const collections = [
      {
        id: 'col-settings',
        slug: 'site-settings',
        name: 'Site Settings',
        singleton: true,
        defaultLocale: 'en',
        supportedLocales: ['en'],
        fields: [
          { name: 'siteTitle', type: 'text' },
          { name: 'maxUsers', type: 'number' },
          { name: 'isActive', type: 'boolean' },
          { name: 'launchDate', type: 'date' },
          { name: 'metadata', type: 'json' },
          { name: 'tags', type: 'array' },
        ],
      },
      {
        id: 'col-articles',
        slug: 'articles',
        name: 'Articles',
        singleton: false,
        defaultLocale: 'en',
        supportedLocales: ['en', 'fr'],
        fields: [
          { name: 'headline', type: 'text' },
          { name: 'body', type: 'richtext' },
        ],
      },
    ]

    it('builds dynamic schema and uses schema cache', async () => {
      mockCollectionsRepo.findAll.mockResolvedValue(collections)

      const schema1 = await buildDynamicGraphQLSchema(mockDb, 'tenant-1')
      expect(schema1).toBeDefined()
      expect(mockCollectionsRepo.findAll).toHaveBeenCalledTimes(1)

      // Second call uses cache
      const schema2 = await buildDynamicGraphQLSchema(mockDb, 'tenant-1')
      expect(schema2).toBe(schema1)
      expect(mockCollectionsRepo.findAll).toHaveBeenCalledTimes(1)

      // Clearing cache re-fetches
      clearGraphQLSchemaCache('tenant-1')
      await buildDynamicGraphQLSchema(mockDb, 'tenant-1')
      expect(mockCollectionsRepo.findAll).toHaveBeenCalledTimes(2)
    })

    it('executes root meta query (_version and _collections)', async () => {
      mockCollectionsRepo.findAll.mockResolvedValue(collections)
      const schema = await buildDynamicGraphQLSchema(mockDb, 'tenant-1')

      const res = await execute({
        schema,
        document: parse('{ _version, _collections { id name slug singleton } }'),
      })

      expect(res.errors).toBeUndefined()
      expect(res.data?._version).toBeDefined()
      expect(res.data?._collections).toHaveLength(2)
    })

    it('resolves singleton query for published entry', async () => {
      mockCollectionsRepo.findAll.mockResolvedValue(collections)
      mockEntriesRepo.findAll.mockResolvedValue({
        rows: [
          {
            id: 'e-settings',
            collectionId: 'col-settings',
            status: 'published',
            data: { siteTitle: 'My Edge Site', maxUsers: 100, isActive: true },
          },
        ],
      })

      const schema = await buildDynamicGraphQLSchema(mockDb, 'tenant-1')
      const res = await execute({
        schema,
        document: parse('{ siteSettings { id siteTitle maxUsers isActive } }'),
      })

      expect(res.errors).toBeUndefined()
      expect(res.data?.siteSettings).toEqual({
        id: 'e-settings',
        siteTitle: 'My Edge Site',
        maxUsers: 100,
        isActive: true,
      })
    })

    it('returns null for singleton query if entry is missing or draft', async () => {
      mockCollectionsRepo.findAll.mockResolvedValue(collections)
      mockEntriesRepo.findAll.mockResolvedValue({ rows: [] })

      const schema = await buildDynamicGraphQLSchema(mockDb, 'tenant-1')
      const res = await execute({
        schema,
        document: parse('{ siteSettings { id } }'),
      })

      expect(res.errors).toBeUndefined()
      expect(res.data?.siteSettings).toBeNull()
    })

    it('resolves list and single entry queries for non-singleton collection', async () => {
      mockCollectionsRepo.findAll.mockResolvedValue(collections)
      const mockArticle = {
        id: 'art-1',
        slug: 'first-article',
        collectionId: 'col-articles',
        status: 'published',
        data: { headline: 'Breaking News', body: '<p>Content</p>' },
      }
      mockEntriesRepo.findAll.mockResolvedValue({ rows: [mockArticle] })
      mockEntriesRepo.findByCollectionAndSlug.mockResolvedValue(mockArticle)
      mockEntriesRepo.findById.mockResolvedValue(mockArticle)

      const schema = await buildDynamicGraphQLSchema(mockDb, 'tenant-1')

      // Test list query
      const listRes = await execute({
        schema,
        document: parse('{ articles { id headline body } }'),
      })
      expect(listRes.errors).toBeUndefined()
      expect(listRes.data?.articles).toHaveLength(1)

      // Test single entry by slug query
      const singleRes = await execute({
        schema,
        document: parse('{ article(slug: "first-article") { id headline } }'),
      })
      expect(singleRes.errors).toBeUndefined()
      expect(singleRes.data?.article).toEqual({ id: 'art-1', headline: 'Breaking News' })

      // Test single entry by id query
      const idRes = await execute({
        schema,
        document: parse('{ article(id: "art-1") { id headline } }'),
      })
      expect(idRes.errors).toBeUndefined()
      expect(idRes.data?.article).toEqual({ id: 'art-1', headline: 'Breaking News' })
    })

    it('returns null for single entry if not published or missing', async () => {
      mockCollectionsRepo.findAll.mockResolvedValue(collections)
      mockEntriesRepo.findByCollectionAndSlug.mockResolvedValue({
        id: 'draft-1',
        status: 'draft',
      })

      const schema = await buildDynamicGraphQLSchema(mockDb, 'tenant-1')
      const res = await execute({
        schema,
        document: parse('{ article(slug: "draft-slug") { id } }'),
      })

      expect(res.errors).toBeUndefined()
      expect(res.data?.article).toBeNull()
    })
  })
})
