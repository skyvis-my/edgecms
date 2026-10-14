import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { Elysia } from 'elysia'

const mockCollectionsRepository = {
  findAll: vi.fn(),
}

const mockEntriesRepository = {
  findAll: vi.fn(),
  findById: vi.fn(),
  findByCollectionAndSlug: vi.fn(),
}

vi.mock('@/collections/collections.repository', () => ({
  collectionsRepository: mockCollectionsRepository,
}))

vi.mock('@/entries/entries.repository', () => ({
  entriesRepository: mockEntriesRepository,
}))

vi.mock('cloudflare:workers', () => ({
  env: { DB: {} as D1Database, CACHE: {} as KVNamespace, MEDIA: {} as R2Bucket },
}))

const { graphqlController } = await import(
  `../../graphql/graphql.controller?bypass=${Date.now()}`
)
const { clearGraphQLSchemaCache } = await import(
  '../../graphql/graphql-schema.builder'
)

describe('GraphQL Controller & GraphiQL Playground', () => {
  const app = new Elysia()
    .use(graphqlController)
    .group('/api/tenants/:tenantSlug', (groupApp) =>
      groupApp
        .derive(({ params }) => ({
          tenant: {
            tenant: { id: `tenant-${params.tenantSlug}`, slug: params.tenantSlug },
            resources: { mode: 'shared' as const },
          },
        }))
        .use(graphqlController)
    )

  beforeEach(() => {
    vi.clearAllMocks()
    clearGraphQLSchemaCache()
  })

  it('renders interactive GraphiQL HTML playground on GET without query', async () => {
    const response = await app.handle(
      new Request('http://localhost/api/graphql', {
        headers: { accept: 'text/html' },
      })
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    const html = await response.text()
    expect(html).toContain('GraphiQL')
    expect(html).toContain('id="graphiql"')
    expect(html).toContain('/api/graphql')
  })

  it('renders GraphiQL HTML for tenant-scoped GET endpoint', async () => {
    const response = await app.handle(
      new Request('http://localhost/api/tenants/acme/api/graphql', {
        headers: { accept: 'text/html' },
      })
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    const html = await response.text()
    expect(html).toContain('acme')
    expect(html).toContain('id="graphiql"')
  })

  it('executes GraphQL query on POST and returns data', async () => {
    mockCollectionsRepository.findAll.mockResolvedValue([
      {
        id: 'col-posts',
        name: 'Posts',
        slug: 'posts',
        singleton: false,
        fields: [{ name: 'title', type: 'text', required: true, localizable: false }],
        supportedLocales: ['en'],
        defaultLocale: 'en',
      },
    ])

    mockEntriesRepository.findAll.mockResolvedValue({
      rows: [
        {
          id: 'post-1',
          slug: 'hello',
          status: 'published',
          collectionId: 'col-posts',
          version: 1,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          data: { title: 'First Post' },
        },
      ],
      total: 1,
    })

    const response = await app.handle(
      new Request('http://localhost/api/tenants/acme/api/graphql', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query: '{ posts { id title } }',
        }),
      })
    )

    expect(response.status).toBe(200)
    const json = (await response.json()) as any
    expect(json.data).toEqual({
      posts: [{ id: 'post-1', title: 'First Post' }],
    })
    expect(mockCollectionsRepository.findAll).toHaveBeenCalledWith(expect.anything(), 'tenant-acme')
  })

  it('rejects queries exceeding depth limit of 3 with status 400', async () => {
    mockCollectionsRepository.findAll.mockResolvedValue([
      {
        id: 'col-posts',
        name: 'Posts',
        slug: 'posts',
        singleton: false,
        fields: [{ name: 'title', type: 'text', required: true, localizable: false }],
        supportedLocales: ['en'],
        defaultLocale: 'en',
      },
    ])

    const deepQuery = `
      query TooDeep {
        posts {
          level1: id
          level2: title
          sub: data {
            nested1: title {
              nested2: value
            }
          }
        }
      }
    `

    const response = await app.handle(
      new Request('http://localhost/api/tenants/acme/api/graphql', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: deepQuery }),
      })
    )

    expect(response.status).toBe(400)
    const json = (await response.json()) as any
    expect(json.errors).toBeDefined()
    expect(json.errors[0].message).toContain('depth')
  })

  it('rejects queries with non-existent fields with status 400 and validation error', async () => {
    mockCollectionsRepository.findAll.mockResolvedValue([])

    const response = await app.handle(
      new Request('http://localhost/api/graphql', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: '{ nonExistentField }' }),
      })
    )

    expect(response.status).toBe(400)
    const json = (await response.json()) as any
    expect(json.errors).toBeDefined()
    expect(json.errors[0].message).toContain('Cannot query field')
  })

  it('returns status 400 when GET requests application/json without a query parameter', async () => {
    const response = await app.handle(
      new Request('http://localhost/api/graphql', {
        headers: { accept: 'application/json' },
      })
    )

    expect(response.status).toBe(400)
    const json = (await response.json()) as any
    expect(json.errors).toBeDefined()
    expect(json.errors[0].message).toContain('Missing "query" parameter')
  })
})
