import { describe, expect, it, vi } from 'bun:test'
import type { Database } from '@/database/db'

const { rbacRepository } = await import(`../../auth/rbac.repository?bypass=${Date.now()}`)

describe('rbacRepository', () => {
  it('covers role and permission CRUD operations', async () => {
    const role = {
      id: 'r1',
      tenantId: 't1',
      name: 'content-editor',
      description: 'Can edit content',
      isDefault: false,
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z',
    }
    const permission = {
      id: 'p1',
      roleId: 'r1',
      subject: 'collection:blog',
      action: 'update',
      conditions: null,
      createdAt: '2026-03-01T00:00:00.000Z',
    }
    const db = createDbMock({
      selectResults: [
        [role], // findRolesByTenant
        [role], // findRoleById
        [role], // findRoleByTenantAndId
        [role], // findRoleByTenantAndName
        [permission], // findPermissionsByRole
      ],
      returningResults: [
        [role], // createRole
        [permission], // createPermission
        [{ ...role, name: 'updated-name' }], // updateRole
        [{ id: 'r1' }], // deleteRole
        [{ id: 'p1' }], // deletePermission
      ],
    })

    expect(await rbacRepository.findRolesByTenant(db as unknown as Database, 't1')).toEqual([
      role,
    ])
    expect(await rbacRepository.findRoleById(db as unknown as Database, 'r1')).toEqual(role)
    expect(await rbacRepository.findRoleByTenantAndId(db as unknown as Database, 't1', 'r1')).toEqual(role)
    expect(await rbacRepository.findRoleByTenantAndName(db as unknown as Database, 't1', 'admin')).toEqual(role)
    expect(await rbacRepository.findPermissionsByRole(db as unknown as Database, 'r1')).toEqual([
      permission,
    ])
    expect(await rbacRepository.createRole(db as unknown as Database, role)).toEqual(role)
    expect(await rbacRepository.createPermission(db as unknown as Database, permission)).toEqual(permission)
    expect(
      await rbacRepository.updateRole(db as unknown as Database, 't1', 'r1', { name: 'updated-name' })
    ).toEqual({
      ...role,
      name: 'updated-name',
    })
    expect(await rbacRepository.deleteRole(db as unknown as Database, 't1', 'r1')).toBe(true)
    expect(await rbacRepository.deletePermission(db as unknown as Database, 'p1')).toBe(true)
  })

  it('returns false/undefined for empty mutation results', async () => {
    const db = createDbMock({
      selectResults: [[], [], [], []],
      returningResults: [[], [], [], [], []],
    })

    expect(await rbacRepository.findRoleById(db as unknown as Database, 'missing')).toBeUndefined()
    expect(
      await rbacRepository.findRoleByTenantAndId(db as unknown as Database, 't1', 'missing')
    ).toBeUndefined()
    expect(
      await rbacRepository.findRoleByTenantAndName(db as unknown as Database, 't1', 'missing')
    ).toBeUndefined()
    expect(await rbacRepository.deleteRole(db as unknown as Database, 't1', 'missing')).toBe(false)
    expect(await rbacRepository.deletePermission(db as unknown as Database, 'missing')).toBe(false)
    expect(await rbacRepository.updateRole(db as unknown as Database, 't1', 'missing', {})).toBeUndefined()
  })

  it('findPermissionsByRole returns empty array when no permissions exist', async () => {
    const db = createDbMock({
      selectResults: [[]],
      returningResults: [],
    })

    expect(await rbacRepository.findPermissionsByRole(db as unknown as Database, 'r1')).toEqual([])
  })

  it('findRolesByTenant returns empty array when no roles exist', async () => {
    const db = createDbMock({
      selectResults: [[]],
      returningResults: [],
    })

    expect(await rbacRepository.findRolesByTenant(db as unknown as Database, 't1')).toEqual([])
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
