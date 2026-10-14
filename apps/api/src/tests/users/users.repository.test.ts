import { describe, expect, it, vi } from 'bun:test'
import type { Database } from '@/database/db'

describe('usersRepository', () => {
  it('uses leftJoin for global listing', async () => {
    const { usersRepository } = await import(`../../users/users.repository?bypass=${Date.now()}`)
    const all = vi.fn(async () => [])
    const offset = vi.fn(() => ({ all }))
    const limit = vi.fn(() => ({ offset }))
    const leftJoin = vi.fn(() => ({ limit }))
    const innerJoin = vi.fn(() => ({ limit }))
    const from = vi.fn(() => ({ leftJoin, innerJoin }))
    const select = vi.fn(() => ({ from }))
    const db = { select } as unknown as Database

    await usersRepository.findForAdminListing(db)

    expect(leftJoin).toHaveBeenCalledTimes(1)
    expect(innerJoin).not.toHaveBeenCalled()
    expect(limit).toHaveBeenCalledTimes(1)
  })

  it('uses innerJoin for tenant-scoped listing', async () => {
    const { usersRepository } = await import(`../../users/users.repository?bypass=${Date.now()}`)
    const all = vi.fn(async () => [])
    const offset = vi.fn(() => ({ all }))
    const limit = vi.fn(() => ({ offset }))
    const leftJoin = vi.fn(() => ({ limit }))
    const innerJoin = vi.fn(() => ({ limit }))
    const from = vi.fn(() => ({ leftJoin, innerJoin }))
    const select = vi.fn(() => ({ from }))
    const db = { select } as unknown as Database

    await usersRepository.findForAdminListing(db, 'tenant-1')

    expect(innerJoin).toHaveBeenCalledTimes(1)
    expect(leftJoin).not.toHaveBeenCalled()
    expect(limit).toHaveBeenCalledTimes(1)
  })
})
