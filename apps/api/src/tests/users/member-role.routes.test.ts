/**
 * PL-03: tenant-scoped member role assignment
 * (`PUT /api/tenants/:slug/api/admin/users/:userId/role`).
 *
 * Real SQL (bun:sqlite with every migration). Covers custom-role assignment,
 * P2 (role and member must belong to the request tenant), escalation rules,
 * the last-owner invariant (also under concurrency), token invalidation and
 * the HS-12 audit event.
 */
import { beforeEach, describe, expect, it, mock, vi } from 'bun:test'
import { Elysia } from 'elysia'
import { createSqliteD1 } from '../helpers/sqlite-d1'

const { d1, sqlite } = createSqliteD1()

const kvStore = new Map<string, string>()
const mockKv = {
  get: vi.fn(async (key: string) => kvStore.get(key) ?? null),
  put: vi.fn(async (key: string, value: string) => {
    kvStore.set(key, value)
  }),
} as unknown as KVNamespace

const mockEnv: Record<string, unknown> = {
  DB: d1,
  CACHE: mockKv,
  BETTER_AUTH_SECRET: 'test-better-auth-secret-at-least-32',
  SUPER_ADMIN_EMAILS: 'root@example.com',
}
mock.module('cloudflare:workers', () => ({ env: mockEnv }))

let currentUser: { id: string; email: string; emailVerified: boolean; role: string } | null = null
const fakeAuth = {
  handler: () => new Response(null, { status: 404 }),
  api: {
    getSession: vi.fn(async () =>
      currentUser ? { user: { ...currentUser, name: currentUser.id }, session: { id: `s-${currentUser.id}` } } : null
    ),
  },
}
mock.module('@/auth/auth', () => ({
  createAuth: () => fakeAuth,
  createAuthForEnv: () => fakeAuth,
}))

const { usersController } = await import('@/users/users.controller')
const { getAuthRevision } = await import('@/auth/auth-revision')

const NOW = '2026-01-01T00:00:00.000Z'
const TENANT_A = 'tenant-a'
const TENANT_B = 'tenant-b'

function insertRole(tenantId: string, name: string, grants: Array<[string, string]>) {
  const roleId = `role-${tenantId}-${name}`
  sqlite
    .query(
      `insert into roles (id, tenant_id, name, description, is_default, created_at, updated_at)
       values (?, ?, ?, null, 0, ?, ?)`
    )
    .run(roleId, tenantId, name, NOW, NOW)
  grants.forEach(([subject, action], index) => {
    sqlite
      .query(
        `insert into permissions (id, role_id, subject, action, conditions, created_at)
         values (?, ?, ?, ?, null, ?)`
      )
      .run(`${roleId}-p${index}`, roleId, subject, action, NOW)
  })
}

function insertUser(id: string) {
  sqlite
    .query(
      `insert into user (id, name, email, role, emailVerified, createdAt, updatedAt)
       values (?, ?, ?, 'viewer', 1, 0, 0)`
    )
    .run(id, id, `${id}@example.com`)
}

function addMember(tenantId: string, userId: string, role: string) {
  sqlite
    .query('insert into tenant_users (tenantId, userId, role, createdAt) values (?, ?, ?, ?)')
    .run(tenantId, userId, role, NOW)
}

function seed() {
  sqlite.exec(
    'delete from audit_events; delete from permissions; delete from roles; delete from tenant_users; delete from user; delete from tenants;'
  )
  for (const [id, slug] of [
    [TENANT_A, 'acme'],
    [TENANT_B, 'beta'],
  ] as const) {
    sqlite
      .query(
        `insert into tenants (id, slug, name, status, localeCatalog, mediaAllowedMimeTypes, createdAt, updatedAt)
         values (?, ?, ?, 'active', '["en"]', '["image/png"]', ?, ?)`
      )
      .run(id, slug, slug, NOW, NOW)
  }
  for (const builtIn of ['viewer', 'editor', 'admin', 'owner']) {
    insertRole(TENANT_A, builtIn, [])
    insertRole(TENANT_B, builtIn, [])
  }
  insertRole(TENANT_A, 'blog-writer', [
    ['entry:blog', 'read'],
    ['entry:blog', 'create'],
  ])
  insertRole(TENANT_A, 'role-manager', [
    ['TenantAdminRoles', 'manage'],
    ['entry:blog', 'read'],
    ['entry:blog', 'create'],
  ])
  insertRole(TENANT_A, 'super-role', [['*:*', 'manage']])
  insertRole(TENANT_B, 'beta-only', [['entry:*', 'manage']])

  for (const id of ['owner1', 'owner2', 'admin1', 'editor1', 'member1', 'viewer1', 'manager1', 'outsider', 'root']) {
    insertUser(id)
  }
  addMember(TENANT_A, 'owner1', 'owner')
  addMember(TENANT_A, 'admin1', 'admin')
  addMember(TENANT_A, 'editor1', 'editor')
  addMember(TENANT_A, 'member1', 'member')
  addMember(TENANT_A, 'viewer1', 'viewer')
  addMember(TENANT_A, 'manager1', 'role-manager')
  addMember(TENANT_B, 'outsider', 'member')
  addMember(TENANT_B, 'owner2', 'owner')
}

function signInAs(id: string) {
  currentUser = {
    id,
    email: id === 'root' ? 'root@example.com' : `${id}@example.com`,
    emailVerified: true,
    role: 'viewer',
  }
}

function buildApp(withTenant = true) {
  const app = new Elysia()
  if (withTenant) {
    app.derive({ as: 'global' }, () => ({
      tenant: {
        tenant: {
          id: TENANT_A,
          slug: 'acme',
          name: 'acme',
          status: 'active',
          mediaUploadMaxBytes: 1,
          mediaUploadMaxDimension: 1,
          mediaAllowedMimeTypes: [],
        },
        resources: { mode: 'shared' as const },
      },
    }))
  }
  return app.use(usersController)
}

async function assign(userId: string, role: unknown, options: { withTenant?: boolean } = {}) {
  const response = await buildApp(options.withTenant ?? true).handle(
    new Request(`http://localhost/api/admin/users/${userId}/role`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role }),
    })
  )
  return { status: response.status, json: (await response.json().catch(() => null)) as any }
}

function roleOf(tenantId: string, userId: string): string | undefined {
  const row = sqlite
    .query('select role from tenant_users where tenantId = ? and userId = ?')
    .get(tenantId, userId) as { role: string } | null
  return row?.role
}

function roleAuditEvents() {
  return sqlite
    .query(
      `select scope, category, action, outcome, actorId, targetType, targetId, metadata
       from audit_events where action = 'rbac.member_role.changed' order by seq`
    )
    .all() as Array<Record<string, string>>
}

beforeEach(() => {
  seed()
  kvStore.clear()
  currentUser = null
})

describe('assigning a custom role', () => {
  it('lets an owner give a member a custom role of the same tenant', async () => {
    signInAs('owner1')
    const res = await assign('member1', 'blog-writer')
    expect(res.status).toBe(200)
    expect(res.json.data).toMatchObject({
      tenantId: TENANT_A,
      userId: 'member1',
      role: 'blog-writer',
      previousRole: 'member',
      roleKind: 'custom',
      changed: true,
    })
    expect(roleOf(TENANT_A, 'member1')).toBe('blog-writer')
  })

  it('bumps the member auth revision so older access tokens go stale', async () => {
    signInAs('owner1')
    expect(await getAuthRevision(mockKv, 'member1', TENANT_A)).toBeUndefined()
    await assign('member1', 'blog-writer')
    expect(await getAuthRevision(mockKv, 'member1', TENANT_A)).toBe(1)
  })

  it('writes an HS-12 permission-change event in the tenant chain', async () => {
    signInAs('admin1')
    await assign('member1', 'blog-writer')
    const events = roleAuditEvents()
    expect(events).toHaveLength(1)
    const event = events[0]!
    expect(event.scope).toBe(TENANT_A)
    expect(event.category).toBe('rbac')
    expect(event.outcome).toBe('success')
    expect(event.actorId).toBe('admin1')
    expect(event.targetType).toBe('user')
    expect(event.targetId).toBe('member1')
    expect(JSON.parse(event.metadata!)).toMatchObject({
      previousRole: 'member',
      role: 'blog-writer',
      roleKind: 'custom',
    })
  })

  it('accepts built-in roles', async () => {
    signInAs('admin1')
    for (const role of ['editor', 'viewer', 'member', 'admin']) {
      const res = await assign('member1', role)
      expect(res.status).toBe(200)
      expect(res.json.data.roleKind).toBe('builtin')
      expect(roleOf(TENANT_A, 'member1')).toBe(role)
    }
  })

  it('treats an unchanged role as a no-op (no revision bump, no event)', async () => {
    signInAs('owner1')
    const res = await assign('member1', 'member')
    expect(res.status).toBe(200)
    expect(res.json.data.changed).toBe(false)
    expect(await getAuthRevision(mockKv, 'member1', TENANT_A)).toBeUndefined()
    expect(roleAuditEvents()).toHaveLength(0)
  })
})

describe('P2: tenant isolation', () => {
  it('refuses a custom role that belongs to another tenant', async () => {
    signInAs('owner1')
    const res = await assign('member1', 'beta-only')
    expect(res.status).toBe(400)
    expect(res.json.error.code).toBe('VALIDATION_ERROR')
    expect(roleOf(TENANT_A, 'member1')).toBe('member')
  })

  it('refuses a role that does not exist', async () => {
    signInAs('owner1')
    const res = await assign('member1', 'ghost')
    expect(res.status).toBe(400)
    expect(roleOf(TENANT_A, 'member1')).toBe('member')
  })

  it('refuses superadmin as a tenant role', async () => {
    signInAs('owner1')
    for (const role of ['superadmin', 'super_admin', ' Superadmin ']) {
      const res = await assign('member1', role)
      expect(res.status).toBe(400)
    }
    expect(roleOf(TENANT_A, 'member1')).toBe('member')
  })

  it('returns 404 for a user who is only a member of another tenant', async () => {
    signInAs('owner1')
    const res = await assign('outsider', 'blog-writer')
    expect(res.status).toBe(404)
    expect(roleOf(TENANT_B, 'outsider')).toBe('member')
    expect(roleOf(TENANT_A, 'outsider')).toBeUndefined()
  })

  it('needs a tenant context (global path)', async () => {
    signInAs('root')
    const res = await assign('member1', 'editor', { withTenant: false })
    expect(res.status).toBe(400)
    expect(roleOf(TENANT_A, 'member1')).toBe('member')
  })

  it('rejects an empty or oversized role name', async () => {
    signInAs('owner1')
    expect((await assign('member1', '')).status).toBe(422)
    expect((await assign('member1', 'x'.repeat(51))).status).toBe(422)
  })
})

describe('privilege escalation', () => {
  it('requires a signed-in user', async () => {
    const res = await assign('member1', 'editor')
    expect(res.status).toBe(401)
  })

  it('refuses editors and members (handler check, not only the guard)', async () => {
    for (const caller of ['editor1', 'member1']) {
      signInAs(caller)
      const res = await assign('member1', 'editor')
      expect(res.status).toBe(403)
    }
    expect(roleOf(TENANT_A, 'member1')).toBe('member')
  })

  it('refuses a caller who is not a member of the tenant', async () => {
    signInAs('outsider')
    const res = await assign('member1', 'editor')
    expect(res.status).toBe(403)
    expect(roleOf(TENANT_A, 'member1')).toBe('member')
  })

  it('stops an admin from granting owner', async () => {
    signInAs('admin1')
    const res = await assign('member1', 'owner')
    expect(res.status).toBe(403)
    expect(roleOf(TENANT_A, 'member1')).toBe('member')
  })

  it('stops an admin from making themselves owner', async () => {
    signInAs('admin1')
    const res = await assign('admin1', 'owner')
    expect(res.status).toBe(403)
    expect(roleOf(TENANT_A, 'admin1')).toBe('admin')
  })

  it("stops an admin from changing an owner's role", async () => {
    addMember(TENANT_A, 'owner2', 'owner')
    signInAs('admin1')
    const res = await assign('owner2', 'member')
    expect(res.status).toBe(403)
    expect(roleOf(TENANT_A, 'owner2')).toBe('owner')
  })

  it('lets an owner grant owner, and a super-admin too', async () => {
    signInAs('owner1')
    expect((await assign('admin1', 'owner')).status).toBe(200)
    signInAs('root')
    expect((await assign('member1', 'owner')).status).toBe(200)
    expect(roleOf(TENANT_A, 'member1')).toBe('owner')
  })

  describe('explicit TenantAdminRoles grant (custom role)', () => {
    it('can assign a role whose grants it holds itself', async () => {
      signInAs('manager1')
      const res = await assign('viewer1', 'blog-writer')
      expect(res.status).toBe(200)
      expect(roleOf(TENANT_A, 'viewer1')).toBe('blog-writer')
      expect((await assign('viewer1', 'viewer')).status).toBe(200)
      expect(roleOf(TENANT_A, 'viewer1')).toBe('viewer')
    })

    it('cannot assign roles with grants it lacks', async () => {
      signInAs('manager1')
      for (const role of ['owner', 'admin', 'editor', 'member', 'super-role']) {
        const res = await assign('viewer1', role)
        expect(res.status).toBe(403)
      }
      expect(roleOf(TENANT_A, 'viewer1')).toBe('viewer')
    })

    it('cannot change a member whose current role exceeds its grants', async () => {
      signInAs('manager1')
      // member reads every collection; the delegate only reads blog.
      expect((await assign('member1', 'viewer')).status).toBe(403)
      expect((await assign('editor1', 'viewer')).status).toBe(403)
      expect(roleOf(TENANT_A, 'member1')).toBe('member')
      expect(roleOf(TENANT_A, 'editor1')).toBe('editor')
    })

    it('cannot change an admin or owner, or its own role', async () => {
      signInAs('manager1')
      expect((await assign('admin1', 'viewer')).status).toBe(403)
      expect((await assign('owner1', 'viewer')).status).toBe(403)
      expect((await assign('manager1', 'blog-writer')).status).toBe(403)
      expect(roleOf(TENANT_A, 'admin1')).toBe('admin')
      expect(roleOf(TENANT_A, 'owner1')).toBe('owner')
      expect(roleOf(TENANT_A, 'manager1')).toBe('role-manager')
    })
  })
})

describe('last owner', () => {
  it('nobody can demote the last owner, not even a super-admin', async () => {
    signInAs('owner1')
    const self = await assign('owner1', 'admin')
    expect(self.status).toBe(409)
    expect(self.json.error.code).toBe('LAST_OWNER')
    signInAs('root')
    const root = await assign('owner1', 'blog-writer')
    expect(root.status).toBe(409)
    expect(roleOf(TENANT_A, 'owner1')).toBe('owner')
    expect(await getAuthRevision(mockKv, 'owner1', TENANT_A)).toBeUndefined()
  })

  it('an owner can step down when another owner remains', async () => {
    addMember(TENANT_A, 'owner2', 'owner')
    signInAs('owner1')
    const res = await assign('owner1', 'admin')
    expect(res.status).toBe(200)
    expect(roleOf(TENANT_A, 'owner1')).toBe('admin')
    expect(roleOf(TENANT_A, 'owner2')).toBe('owner')
  })

  it('two concurrent demotions of the only two owners leave one owner', async () => {
    addMember(TENANT_A, 'owner2', 'owner')
    signInAs('root')
    const results = await Promise.all([assign('owner1', 'admin'), assign('owner2', 'admin')])
    const statuses = results.map((r) => r.status).sort()
    expect(statuses).toEqual([200, 409])
    const owners = sqlite
      .query("select count(*) as n from tenant_users where tenantId = ? and role = 'owner'")
      .get(TENANT_A) as { n: number }
    expect(owners.n).toBe(1)
  })

  it("owners in another tenant do not count toward this tenant's last owner", async () => {
    // owner2 owns tenant B only; owner1 is still the last owner of tenant A.
    signInAs('root')
    const res = await assign('owner1', 'admin')
    expect(res.status).toBe(409)
  })
})

describe('member listing', () => {
  it('returns the stored tenant role, including custom role names', async () => {
    sqlite.query("update tenant_users set role = 'blog-writer' where userId = 'member1'").run()
    signInAs('owner1')
    const response = await buildApp().handle(new Request('http://localhost/api/admin/users'))
    expect(response.status).toBe(200)
    const body = (await response.json()) as { data: Array<{ id: string; tenantRole?: string | null }> }
    const member = body.data.find((u) => u.id === 'member1')
    expect(member?.tenantRole).toBe('blog-writer')
    expect(body.data.find((u) => u.id === 'owner1')?.tenantRole).toBe('owner')
  })
})
