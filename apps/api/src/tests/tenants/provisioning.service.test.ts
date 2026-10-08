import { beforeEach, describe, expect, it, vi } from 'bun:test'
import {
  deprovisionD1,
  deprovisionKV,
  deprovisionR2,
  deprovisionTenant,
  provisionD1,
  provisionKV,
  provisionR2,
  provisionTenant,
  runTenantMigrations,
} from '../../tenants/provisioning.service'

// Mock the repository module
vi.mock('../../tenants/tenants.repository', () => ({
  tenantsRepository: {
    setResources: vi.fn(),
    getResources: vi.fn(),
    deleteResources: vi.fn(),
  },
}))

import type { Database } from '@/database/db'
import { tenantsRepository } from '../../tenants/tenants.repository'

const mockRepo = tenantsRepository as unknown as {
  setResources: ReturnType<typeof vi.fn>
  getResources: ReturnType<typeof vi.fn>
  deleteResources: ReturnType<typeof vi.fn>
}

// Mock global fetch
const mockFetch = vi.fn()
global.fetch = mockFetch as unknown as typeof fetch

describe('provisionD1', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('provisions D1 database successfully', async () => {
    mockFetch.mockResolvedValue({
      json: async () => ({
        success: true,
        result: { uuid: 'd1-database-id-123' },
        errors: [],
        messages: [],
      }),
    })

    const result = await provisionD1('account-123', 'test-tenant', 'test-token')

    expect(result).toBe('d1-database-id-123')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/accounts/account-123/d1/database',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'edgecms-test-tenant' }),
      }
    )
  })

  it('throws error when API returns failure', async () => {
    mockFetch.mockResolvedValue({
      json: async () => ({
        success: false,
        errors: [{ code: 1000, message: 'Database creation failed' }],
        messages: [],
        result: null,
      }),
    })

    await expect(provisionD1('account-123', 'test-tenant', 'test-token')).rejects.toThrow(
      'Failed to provision D1 database: Database creation failed'
    )
  })

  it('throws error when result is missing uuid', async () => {
    mockFetch.mockResolvedValue({
      json: async () => ({
        success: true,
        result: {},
        errors: [],
        messages: [],
      }),
    })

    await expect(provisionD1('account-123', 'test-tenant', 'test-token')).rejects.toThrow(
      'Failed to provision D1 database'
    )
  })
})

describe('provisionKV', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('provisions KV namespace successfully', async () => {
    mockFetch.mockResolvedValue({
      json: async () => ({
        success: true,
        result: { id: 'kv-namespace-id-456' },
        errors: [],
        messages: [],
      }),
    })

    const result = await provisionKV('account-123', 'test-tenant', 'test-token')

    expect(result).toBe('kv-namespace-id-456')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/accounts/account-123/storage/kv/namespaces',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: 'edgecms-test-tenant' }),
      }
    )
  })

  it('throws error when API returns failure', async () => {
    mockFetch.mockResolvedValue({
      json: async () => ({
        success: false,
        errors: [{ code: 2000, message: 'KV namespace creation failed' }],
        messages: [],
        result: null,
      }),
    })

    await expect(provisionKV('account-123', 'test-tenant', 'test-token')).rejects.toThrow(
      'Failed to provision KV namespace: KV namespace creation failed'
    )
  })
})

describe('provisionR2', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('provisions R2 bucket successfully', async () => {
    mockFetch.mockResolvedValue({
      json: async () => ({
        success: true,
        result: { name: 'edgecms-test-tenant' },
        errors: [],
        messages: [],
      }),
    })

    const result = await provisionR2('account-123', 'test-tenant', 'test-token')

    expect(result).toBe('edgecms-test-tenant')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/accounts/account-123/r2/buckets',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'edgecms-test-tenant' }),
      }
    )
  })

  it('throws error when API returns failure', async () => {
    mockFetch.mockResolvedValue({
      json: async () => ({
        success: false,
        errors: [{ code: 3000, message: 'R2 bucket creation failed' }],
        messages: [],
        result: null,
      }),
    })

    await expect(provisionR2('account-123', 'test-tenant', 'test-token')).rejects.toThrow(
      'Failed to provision R2 bucket: R2 bucket creation failed'
    )
  })
})

describe('runTenantMigrations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('runs all migration entries successfully', async () => {
    const migrations = [
      { name: '0001_init', sql: 'CREATE TABLE foo (id TEXT);' },
      { name: '0002_add_users', sql: 'CREATE TABLE bar (id TEXT);' },
    ]

    // Mock: create tracking table
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ success: true, errors: [], messages: [], result: [] }),
    })
    // Mock: check if migration 0001 is applied (not found)
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ success: true, errors: [], result: [{ results: [] }] }),
    })
    // Mock: execute migration 0001
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ success: true, errors: [], messages: [], result: [] }),
    })
    // Mock: record migration 0001
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ success: true, errors: [], messages: [], result: [] }),
    })
    // Mock: check if migration 0002 is applied (not found)
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ success: true, errors: [], result: [{ results: [] }] }),
    })
    // Mock: execute migration 0002
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ success: true, errors: [], messages: [], result: [] }),
    })
    // Mock: record migration 0002
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ success: true, errors: [], messages: [], result: [] }),
    })

    await runTenantMigrations('account-123', 'd1-id-123', 'test-token', migrations)

    // 1 tracking table + 2 * (check + execute + record) = 7
    expect(mockFetch).toHaveBeenCalledTimes(7)
  })

  it('skips already-applied migrations', async () => {
    const migrations = [{ name: '0001_init', sql: 'CREATE TABLE foo (id TEXT);' }]

    // Mock: create tracking table
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ success: true, errors: [], result: [] }),
    })
    // Mock: check if migration is applied (found)
    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        success: true,
        errors: [],
        result: [{ results: [{ name: '0001_init' }] }],
      }),
    })

    await runTenantMigrations('account-123', 'd1-id-123', 'test-token', migrations)

    // Only 2 calls: create tracking + check (no execute or record)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('throws error when migration execution fails', async () => {
    const migrations = [{ name: '0001_init', sql: 'CREATE TABLE foo (id TEXT);' }]

    // Mock: create tracking table
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ success: true, errors: [], result: [] }),
    })
    // Mock: check if migration is applied (not found)
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ success: true, errors: [], result: [{ results: [] }] }),
    })
    // Mock: execute migration (failure)
    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        success: false,
        errors: [{ code: 4000, message: 'SQL execution failed' }],
        result: null,
      }),
    })

    await expect(
      runTenantMigrations('account-123', 'd1-id-123', 'test-token', migrations)
    ).rejects.toThrow('Failed to execute migration 0001_init: SQL execution failed')
  })

  it('does nothing when no migrations are provided', async () => {
    // Mock: create tracking table
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ success: true, errors: [], result: [] }),
    })

    await runTenantMigrations('account-123', 'd1-id-123', 'test-token', [])

    // Only 1 call for tracking table creation
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})

describe('provisionTenant', () => {
  const db = {} as Database

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('provisions all resources and stores IDs successfully', async () => {
    // Mock D1 provisioning
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ success: true, result: { uuid: 'd1-id-123' }, errors: [] }),
    })
    // Mock KV provisioning
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ success: true, result: { id: 'kv-id-456' }, errors: [] }),
    })
    // Mock R2 provisioning
    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        success: true,
        result: { name: 'edgecms-test-tenant' },
        errors: [],
      }),
    })
    // Mock: create migrations tracking table
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ success: true, errors: [], result: [] }),
    })

    mockRepo.setResources.mockResolvedValue({
      tenantId: 'tenant-id-123',
      d1DatabaseId: 'd1-id-123',
      kvNamespaceId: 'kv-id-456',
      r2BucketName: 'edgecms-test-tenant',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    })

    const result = await provisionTenant(
      db,
      'account-123',
      'test-tenant',
      'tenant-id-123',
      'test-token'
    )

    expect(result).toEqual({
      d1DatabaseId: 'd1-id-123',
      kvNamespaceId: 'kv-id-456',
      r2BucketName: 'edgecms-test-tenant',
    })

    expect(mockRepo.setResources).toHaveBeenCalledWith(db, 'tenant-id-123', {
      d1DatabaseId: 'd1-id-123',
      kvNamespaceId: 'kv-id-456',
      r2BucketName: 'edgecms-test-tenant',
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    })
  })

  it('attempts cleanup when KV provisioning fails', async () => {
    // Mock D1 provisioning success
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ success: true, result: { uuid: 'd1-id-123' }, errors: [] }),
    })

    // Mock KV provisioning failure
    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        success: false,
        errors: [{ code: 2000, message: 'KV creation failed' }],
      }),
    })

    // Mock D1 cleanup (deprovision)
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ success: true, errors: [] }),
    })

    await expect(
      provisionTenant(db, 'account-123', 'test-tenant', 'tenant-id-123', 'test-token')
    ).rejects.toThrow('Failed to provision KV namespace: KV creation failed')

    // Verify cleanup was attempted (3rd call is D1 deletion)
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  it('attempts cleanup of all resources when migration fails', async () => {
    const migrations = [{ name: '0001_init', sql: 'CREATE TABLE foo;' }]

    // Mock D1, KV, R2 provisioning success
    mockFetch
      .mockResolvedValueOnce({
        json: async () => ({ success: true, result: { uuid: 'd1-id-123' }, errors: [] }),
      })
      .mockResolvedValueOnce({
        json: async () => ({ success: true, result: { id: 'kv-id-456' }, errors: [] }),
      })
      .mockResolvedValueOnce({
        json: async () => ({
          success: true,
          result: { name: 'edgecms-test-tenant' },
          errors: [],
        }),
      })

    // Mock: create tracking table
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ success: true, errors: [], result: [] }),
    })
    // Mock: check if migration is applied (not found)
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ success: true, errors: [], result: [{ results: [] }] }),
    })
    // Mock migration failure
    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        success: false,
        errors: [{ code: 4000, message: 'SQL execution failed' }],
      }),
    })

    // Mock cleanup (D1, KV, R2 deletions)
    mockFetch
      .mockResolvedValueOnce({ json: async () => ({ success: true, errors: [] }) })
      .mockResolvedValueOnce({ json: async () => ({ success: true, errors: [] }) })
      .mockResolvedValueOnce({ json: async () => ({ success: true, errors: [] }) })

    await expect(
      provisionTenant(db, 'account-123', 'test-tenant', 'tenant-id-123', 'test-token', migrations)
    ).rejects.toThrow('Failed to execute migration')

    // 3 provisions + 1 tracking + 1 check + 1 migrate + 3 cleanups = 9
    expect(mockFetch).toHaveBeenCalledTimes(9)
  })
})

describe('deprovisionD1', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deletes D1 database successfully', async () => {
    mockFetch.mockResolvedValue({
      json: async () => ({ success: true, errors: [], messages: [], result: null }),
    })

    await deprovisionD1('account-123', 'd1-id-123', 'test-token')

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/accounts/account-123/d1/database/d1-id-123',
      {
        method: 'DELETE',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
      }
    )
  })

  it('throws error when deletion fails', async () => {
    mockFetch.mockResolvedValue({
      json: async () => ({
        success: false,
        errors: [{ code: 5000, message: 'Deletion failed' }],
      }),
    })

    await expect(deprovisionD1('account-123', 'd1-id-123', 'test-token')).rejects.toThrow(
      'Failed to deprovision D1 database: Deletion failed'
    )
  })
})

describe('deprovisionKV', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deletes KV namespace successfully', async () => {
    mockFetch.mockResolvedValue({
      json: async () => ({ success: true, errors: [], messages: [], result: null }),
    })

    await deprovisionKV('account-123', 'kv-id-456', 'test-token')

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/accounts/account-123/storage/kv/namespaces/kv-id-456',
      {
        method: 'DELETE',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
      }
    )
  })
})

describe('deprovisionR2', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deletes R2 bucket successfully', async () => {
    mockFetch.mockResolvedValue({
      json: async () => ({ success: true, errors: [], messages: [], result: null }),
    })

    await deprovisionR2('account-123', 'edgecms-test-tenant', 'test-token')

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/accounts/account-123/r2/buckets/edgecms-test-tenant',
      {
        method: 'DELETE',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
      }
    )
  })
})

describe('deprovisionTenant', () => {
  const db = {} as Database

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deprovisions all resources and cleans up DB record', async () => {
    mockRepo.getResources.mockResolvedValue({
      tenantId: 'tenant-id-123',
      d1DatabaseId: 'd1-id-123',
      kvNamespaceId: 'kv-id-456',
      r2BucketName: 'edgecms-test-tenant',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    })
    mockRepo.deleteResources.mockResolvedValue(true)

    // Mock D1, KV, R2 deletions
    mockFetch
      .mockResolvedValueOnce({ json: async () => ({ success: true, errors: [] }) })
      .mockResolvedValueOnce({ json: async () => ({ success: true, errors: [] }) })
      .mockResolvedValueOnce({ json: async () => ({ success: true, errors: [] }) })

    await deprovisionTenant(db, 'account-123', 'test-tenant', 'tenant-id-123', 'test-token')

    expect(mockRepo.getResources).toHaveBeenCalledWith(db, 'tenant-id-123')
    expect(mockFetch).toHaveBeenCalledTimes(3)
    expect(mockRepo.deleteResources).toHaveBeenCalledWith(db, 'tenant-id-123')
  })

  it('throws error when resources not found', async () => {
    mockRepo.getResources.mockResolvedValue(undefined)

    await expect(
      deprovisionTenant(db, 'account-123', 'test-tenant', 'tenant-id-123', 'test-token')
    ).rejects.toThrow('No resources found for tenant test-tenant')
  })

  it('throws combined error when some deletions fail', async () => {
    mockRepo.getResources.mockResolvedValue({
      tenantId: 'tenant-id-123',
      d1DatabaseId: 'd1-id-123',
      kvNamespaceId: 'kv-id-456',
      r2BucketName: 'edgecms-test-tenant',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    })

    // Mock D1 deletion success, KV failure, R2 success
    mockFetch
      .mockResolvedValueOnce({ json: async () => ({ success: true, errors: [] }) })
      .mockResolvedValueOnce({
        json: async () => ({
          success: false,
          errors: [{ code: 6000, message: 'KV deletion failed' }],
        }),
      })
      .mockResolvedValueOnce({ json: async () => ({ success: true, errors: [] }) })

    await expect(
      deprovisionTenant(db, 'account-123', 'test-tenant', 'tenant-id-123', 'test-token')
    ).rejects.toThrow('Failed to deprovision some resources')
  })
})
