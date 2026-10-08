import { beforeEach, describe, expect, it, mock, vi } from 'bun:test'
import type { Database } from '@/database/db'

const mockFindForAdminListing = vi.fn()

mock.module('../../users/users.repository', () => ({
  usersRepository: {
    findForAdminListing: mockFindForAdminListing,
  },
}))

async function loadUsersService() {
  const module = await import(`../../users/users.service?bypass=${Date.now()}`)
  return module.usersService
}

describe('usersService', () => {
  const db = {} as Database

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps rows into admin users and de-duplicates by user id', async () => {
    mockFindForAdminListing.mockResolvedValue([
      {
        id: 'u1',
        name: 'Jane Doe',
        email: 'jane@example.com',
        createdAt: 1736208000000,
        updatedAt: 1736208000000,
        globalRole: 'admin',
        tenantRole: 'member',
      },
      {
        id: 'u1',
        name: 'Jane Doe',
        email: 'jane@example.com',
        createdAt: 1736208000000,
        updatedAt: 1736208000000,
        globalRole: 'admin',
        tenantRole: 'member',
      },
    ])

    const usersService = await loadUsersService()
    const result = await usersService.findAdminUsers(db, {
      tenantId: 'tenant-1',
      superAdminEmails: [],
    })

    expect(mockFindForAdminListing).toHaveBeenCalledWith(db, 'tenant-1')
    expect(result).toEqual([
      expect.objectContaining({
        id: 'u1',
        firstName: 'Jane',
        lastName: 'Doe',
        username: 'jane',
        role: 'admin',
      }),
    ])
  })

  it('marks configured super-admin emails as superadmin role', async () => {
    mockFindForAdminListing.mockResolvedValue([
      {
        id: 'u2',
        name: 'Root User',
        email: 'root@example.com',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        globalRole: 'viewer',
        tenantRole: 'member',
      },
    ])

    const usersService = await loadUsersService()
    const result = await usersService.findAdminUsers(db, {
      superAdminEmails: ['root@example.com'],
    })

    expect(result[0]?.role).toBe('superadmin')
  })
})
