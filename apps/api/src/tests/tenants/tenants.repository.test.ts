import { describe, expect, it, vi } from 'bun:test'
import { DEFAULT_ASSET_ALLOWED_MIME_TYPES } from '@/assets/file-policy'
import type { Database } from '@/database/db'

const { tenantsRepository } = await import(`../../tenants/tenants.repository?bypass=${Date.now()}`)

describe('tenantsRepository', () => {
  it('covers tenant CRUD and membership queries', async () => {
    const row = { id: 't1', slug: 'acme', name: 'Acme', status: 'active' }
    const db = createDbMock({
      selectResults: [
        [row], // findAll
        [row], // findById
        [row], // findBySlug
        [{ tenant: row }], // findUserTenants
        [{ tenantId: 't1', userId: 'u1', role: 'admin' }], // findTenantUsers
        [{ tenantId: 't1', userId: 'u1', role: 'admin' }], // findTenantUser
      ],
      returningResults: [
        [row], // create
        [{ ...row, name: 'Acme Updated' }], // update
        [{ id: 't1' }], // deleteById
        [{ tenantId: 't1', userId: 'u1', role: 'editor' }], // addUserToTenant
        [{ tenantId: 't1' }], // removeUserFromTenant
        [{ tenantId: 't1', userId: 'u1', role: 'viewer' }], // updateUserRole
      ],
    })

    expect(await tenantsRepository.findAll(db as unknown as Database)).toEqual([row])
    expect(await tenantsRepository.findById(db as unknown as Database, 't1')).toEqual(row)
    expect(await tenantsRepository.findBySlug(db as unknown as Database, 'acme')).toEqual(row)
    expect(await tenantsRepository.create(db as unknown as Database, row)).toEqual(row)
    expect(
      await tenantsRepository.update(db as unknown as Database, 't1', { name: 'Acme Updated' })
    ).toEqual({
      ...row,
      name: 'Acme Updated',
    })
    expect(await tenantsRepository.deleteById(db as unknown as Database, 't1')).toBe(true)
    expect(await tenantsRepository.findUserTenants(db as unknown as Database, 'u1')).toEqual([row])
    expect(await tenantsRepository.findTenantUsers(db as unknown as Database, 't1')).toEqual([
      { tenantId: 't1', userId: 'u1', role: 'admin' },
    ])
    expect(await tenantsRepository.findTenantUser(db as unknown as Database, 't1', 'u1')).toEqual({
      tenantId: 't1',
      userId: 'u1',
      role: 'admin',
    })
    expect(
      await tenantsRepository.addUserToTenant(db as unknown as Database, {
        tenantId: 't1',
        userId: 'u1',
        role: 'editor',
      })
    ).toEqual({ tenantId: 't1', userId: 'u1', role: 'editor' })
    expect(
      await tenantsRepository.removeUserFromTenant(db as unknown as Database, 't1', 'u1')
    ).toBe(true)
    expect(
      await tenantsRepository.updateUserRole(db as unknown as Database, 't1', 'u1', 'viewer')
    ).toEqual({
      tenantId: 't1',
      userId: 'u1',
      role: 'viewer',
    })
  })

  it('returns false/undefined for empty mutation results', async () => {
    const db = createDbMock({
      selectResults: [[], []],
      returningResults: [[], [], [], []],
    })

    expect(await tenantsRepository.findById(db as unknown as Database, 'missing')).toBeUndefined()
    expect(await tenantsRepository.findBySlug(db as unknown as Database, 'missing')).toBeUndefined()
    expect(await tenantsRepository.deleteById(db as unknown as Database, 'missing')).toBe(false)
    expect(
      await tenantsRepository.removeUserFromTenant(db as unknown as Database, 't1', 'u2')
    ).toBe(false)
    expect(
      await tenantsRepository.updateUserRole(db as unknown as Database, 't1', 'u2', 'viewer')
    ).toBeUndefined()
  })

  it('setResources updates existing row', async () => {
    const existing = {
      tenantId: 't1',
      d1DatabaseId: 'db-old',
      kvNamespaceId: null,
      r2BucketName: null,
    }
    const updated = {
      tenantId: 't1',
      d1DatabaseId: 'db-new',
      kvNamespaceId: 'kv1',
      r2BucketName: 'r2',
    }
    const db = createDbMock({
      selectResults: [[existing]],
      returningResults: [[updated]],
    })

    const result = await tenantsRepository.setResources(db as unknown as Database, 't1', {
      d1DatabaseId: 'db-new',
      kvNamespaceId: 'kv1',
      r2BucketName: 'r2',
    })
    expect(result).toEqual(updated)
    expect((db.update as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0)
  })

  it('setResources inserts when row does not exist', async () => {
    const inserted = {
      tenantId: 't1',
      d1DatabaseId: 'db1',
      kvNamespaceId: 'kv1',
      r2BucketName: 'r2',
    }
    const db = createDbMock({
      selectResults: [[]],
      returningResults: [[inserted]],
    })

    const result = await tenantsRepository.setResources(db as unknown as Database, 't1', {
      d1DatabaseId: 'db1',
      kvNamespaceId: 'kv1',
      r2BucketName: 'r2',
    })
    expect(result).toEqual(inserted)
    expect((db.insert as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0)
  })

  it('getResources and deleteResources map return values', async () => {
    const db = createDbMock({
      selectResults: [[{ tenantId: 't1', d1DatabaseId: 'db1' }]],
      returningResults: [[{ tenantId: 't1' }], []],
    })

    expect(await tenantsRepository.getResources(db as unknown as Database, 't1')).toEqual({
      tenantId: 't1',
      d1DatabaseId: 'db1',
    })
    expect(await tenantsRepository.deleteResources(db as unknown as Database, 't1')).toBe(true)
    expect(await tenantsRepository.deleteResources(db as unknown as Database, 'missing')).toBe(
      false
    )
  })

  it('findAllWithUserCount returns tenants with user counts', async () => {
    const row = {
      id: 't1',
      slug: 'acme',
      name: 'Acme',
      status: 'active',
      localeCatalog: ['en'],
      targetUrl: null,
      corsOrigin: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      userCount: 3,
    }
    const db = createDbMock({
      selectResults: [
        [row], // subquery select (tenantUsers groupBy) - consumed by .as()
        [row], // main select with leftJoin
      ],
      returningResults: [],
    })

    const result = await tenantsRepository.findAllWithUserCount(db as unknown as Database)
    expect(result).toEqual([{ ...row, userCount: 3 }])
  })

  it('findTenantUsersWithDetails returns users with profile data', async () => {
    const userDetails = [
      { id: 'u1', name: 'Alice', email: 'alice@example.com', role: 'owner' },
      { id: 'u2', name: 'Bob', email: 'bob@example.com', role: 'member' },
    ]
    const db = createDbMock({
      selectResults: [userDetails],
      returningResults: [],
    })

    const result = await tenantsRepository.findTenantUsersWithDetails(
      db as unknown as Database,
      't1'
    )
    expect(result).toEqual(userDetails)
    expect(result).toHaveLength(2)
    expect(result[0]?.name).toBe('Alice')
    expect(result[1]?.email).toBe('bob@example.com')
  })

  it('findTenantUsersWithDetails returns empty array for tenant with no users', async () => {
    const db = createDbMock({
      selectResults: [[]],
      returningResults: [],
    })

    const result = await tenantsRepository.findTenantUsersWithDetails(
      db as unknown as Database,
      't1'
    )
    expect(result).toEqual([])
  })

  it('falls back to legacy tenant schema when localeCatalog column is missing', async () => {
    const legacyRow = {
      id: 't1',
      slug: 'acme',
      name: 'Acme',
      status: 'active',
      createdAt: '2026-02-07T00:00:00.000Z',
      updatedAt: '2026-02-07T00:00:00.000Z',
    }
    const db = createDbMock({
      selectResults: [new Error('no such column: tenants.localeCatalog'), [legacyRow]],
      returningResults: [],
    })

    await expect(tenantsRepository.findAll(db as unknown as Database)).resolves.toEqual([
      {
        ...legacyRow,
        localeCatalog: ['en'],
        targetUrl: null,
        corsOrigin: null,
        mediaUploadMaxBytes: 5 * 1024 * 1024,
        mediaUploadMaxDimension: 2048,
        mediaAllowedMimeTypes: DEFAULT_ASSET_ALLOWED_MIME_TYPES,
      },
    ])
  })
})

function createDbMock(opts: { selectResults: unknown[]; returningResults: unknown[][] }) {
  let selectIndex = 0
  let returningIndex = 0

  const select = vi.fn().mockImplementation(() => {
    const result = opts.selectResults[selectIndex] ?? []
    selectIndex++

    const resolveResult = () => {
      if (result instanceof Error) return Promise.reject(result)
      return Promise.resolve(result)
    }

    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(resolveResult),
          all: vi.fn().mockImplementation(resolveResult),
        }),
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            all: vi.fn().mockImplementation(resolveResult),
          }),
        }),
        leftJoin: vi.fn().mockReturnValue({
          all: vi.fn().mockImplementation(resolveResult),
        }),
        groupBy: vi.fn().mockReturnValue({
          as: vi.fn().mockReturnValue({}),
        }),
        all: vi.fn().mockImplementation(resolveResult),
      }),
    }
  })

  const mutationChain = {
    values: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockImplementation(() => {
      const result = opts.returningResults[returningIndex] ?? []
      returningIndex++
      return Promise.resolve(result)
    }),
  }

  return {
    select,
    insert: vi.fn().mockReturnValue(mutationChain),
    update: vi.fn().mockReturnValue(mutationChain),
    delete: vi.fn().mockReturnValue(mutationChain),
  }
}
