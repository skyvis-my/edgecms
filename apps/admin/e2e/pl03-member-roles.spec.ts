/**
 * PL-03: tenant Users page assigns a custom role through
 * `PUT .../admin/users/:userId/role`. Mocked API (no Worker needed); takes
 * desktop and 375 px screenshots of the role picker.
 */
import fs from 'node:fs'
import path from 'node:path'
import { expect, type Page, type Route, test } from '@playwright/test'
import { installSmokeGuards } from './smoke-guards'

installSmokeGuards()

const SNAPSHOT_DIR = path.resolve(process.cwd(), '.playwright/visual-snapshots')

const SESSION_CACHE = {
  user: { id: 'user-owner', name: 'Olivia Owner', email: 'olivia@acme.example', role: 'viewer' },
  session: { expiresAt: '2099-01-01T00:00:00.000Z' },
}

const NOW = '2026-11-01T09:00:00.000Z'

type MockUser = {
  id: string
  firstName: string
  lastName: string
  username: string
  email: string
  phoneNumber: string
  status: 'active'
  role: 'admin' | 'editor' | 'viewer'
  tenantRole: string
  createdAt: string
  updatedAt: string
}

function member(id: string, name: string, role: MockUser['role'], tenantRole: string): MockUser {
  const [firstName = '', lastName = ''] = name.split(' ')
  return {
    id,
    firstName,
    lastName,
    username: firstName.toLowerCase(),
    email: `${firstName.toLowerCase()}@acme.example`,
    phoneNumber: '',
    status: 'active',
    role,
    tenantRole,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

const ROLES = [
  { id: 'r-admin', name: 'admin', description: 'Can manage all content and users', permissionCount: 8 },
  { id: 'r-blog', name: 'blog-writer', description: 'Writes the blog only', permissionCount: 3 },
  { id: 'r-editor', name: 'editor', description: 'Can create, edit, and publish content', permissionCount: 10 },
  { id: 'r-owner', name: 'owner', description: 'Full access to all resources', permissionCount: 1 },
  { id: 'r-press', name: 'press-reviewer', description: 'Reads press releases', permissionCount: 1 },
  { id: 'r-viewer', name: 'viewer', description: 'Can read content only', permissionCount: 3 },
]

async function fulfillJson(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(status < 400 ? { success: true, data } : data),
  })
}

async function setupMockApi(page: Page, users: MockUser[], roleWrites: Array<{ path: string; body: unknown }>) {
  await page.route('**://*/api/**', async (route) => {
    const request = route.request()
    const method = request.method()
    // The admin calls `/api/tenants/acme/admin/...`; the Worker normalizes it
    // to `/api/tenants/acme/api/admin/...`. Accept both.
    const pathname = new URL(request.url()).pathname.replace('/api/tenants/acme/api/admin/', '/api/tenants/acme/admin/')

    if (pathname === '/api/bootstrap/status') {
      await route.fulfill({ json: { needsOnboarding: false, userCount: 4 } })
      return
    }
    if (pathname === '/api/auth/get-session' || pathname === '/api/auth/session') {
      await route.fulfill({ json: SESSION_CACHE })
      return
    }
    if (pathname.startsWith('/api/auth/')) {
      await route.fulfill({ json: { data: SESSION_CACHE, error: null } })
      return
    }
    if (pathname.endsWith('/admin/sync/stream')) {
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
        body: 'event: connected\ndata: ok\n\n',
      })
      return
    }
    if (method === 'GET' && pathname === '/api/admin/tenants') {
      await fulfillJson(route, [
        { id: 'tenant-acme', name: 'Acme Inc', slug: 'acme', status: 'active', localeCatalog: ['en'], createdAt: NOW, updatedAt: NOW },
      ])
      return
    }
    if (method === 'GET' && pathname === '/api/tenants/acme/admin/roles') {
      await fulfillJson(route, ROLES)
      return
    }
    if (method === 'GET' && pathname === '/api/tenants/acme/admin/users') {
      await fulfillJson(route, users)
      return
    }
    const roleMatch = /^\/api\/tenants\/acme\/admin\/users\/([^/]+)\/role$/.exec(pathname)
    if (method === 'PUT' && roleMatch) {
      const body = request.postDataJSON() as { role: string }
      roleWrites.push({ path: pathname, body })
      const target = users.find((u) => u.id === roleMatch[1])
      const previousRole = target?.tenantRole ?? 'member'
      if (target) target.tenantRole = body.role
      await fulfillJson(route, {
        tenantId: 'tenant-acme',
        userId: roleMatch[1],
        role: body.role,
        previousRole,
        roleKind: ROLES.some((r) => r.name === body.role && !['owner', 'admin', 'editor', 'viewer'].includes(r.name))
          ? 'custom'
          : 'builtin',
        changed: true,
      })
      return
    }
    if (pathname.endsWith('/admin/sync/pull')) {
      await fulfillJson(route, { changes: [], cursor: 0, hasMore: false })
      return
    }
    if (pathname.endsWith('/admin/sync/push')) {
      await fulfillJson(route, { results: [] })
      return
    }
    await fulfillJson(route, {})
  })
}

for (const viewport of [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'mobile-375', width: 375, height: 812 },
]) {
  test(`PL-03 tenant users page assigns a custom role (${viewport.name})`, async ({ page }) => {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true })
    const users = [
      member('user-owner', 'Olivia Owner', 'admin', 'owner'),
      member('user-admin', 'Arjun Admin', 'admin', 'admin'),
      member('user-mia', 'Mia Member', 'editor', 'member'),
      member('user-press', 'Pat Press', 'viewer', 'press-reviewer'),
    ]
    const roleWrites: Array<{ path: string; body: unknown }> = []
    await page.addInitScript((session) => {
      try {
        localStorage.setItem('edgecms:auth-session-cache', JSON.stringify(session))
        localStorage.setItem('edgecms:active-tenant', 'acme')
      } catch {
        // storage blocked
      }
    }, SESSION_CACHE)
    await setupMockApi(page, users, roleWrites)
    await page.setViewportSize({ width: viewport.width, height: viewport.height })

    await page.goto('/tenants/acme/users')
    await expect(page.getByRole('heading', { name: 'User List' })).toBeVisible()
    // A custom role is shown as stored, with a "custom" marker.
    await expect(page.getByText('press-reviewer').first()).toBeVisible()

    const miaRow = page.getByRole('row').filter({ hasText: 'mia@acme.example' })
    await miaRow.getByRole('button', { name: 'Open menu' }).click()
    await page.getByRole('menuitem', { name: 'Edit' }).click()

    const dialog = page.getByRole('dialog', { name: 'Edit User' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('combobox').click()
    const option = page.getByRole('option', { name: 'blog-writer (custom)' })
    await expect(option).toBeVisible()
    await expect(page.getByRole('option', { name: 'Owner' })).toBeVisible()

    const pickerShot = path.join(SNAPSHOT_DIR, `pl03-role-picker-${viewport.name}.png`)
    await page.screenshot({ path: pickerShot, fullPage: false, animations: 'disabled' })
    expect(fs.statSync(pickerShot).size).toBeGreaterThan(1000)

    await option.click()
    await dialog.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText('Role updated')).toBeVisible()
    expect(roleWrites).toEqual([
      { path: '/api/tenants/acme/admin/users/user-mia/role', body: { role: 'blog-writer' } },
    ])
    await expect(miaRow.getByText('blog-writer')).toBeVisible()

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    expect(scrollWidth).toBeLessThanOrEqual(viewport.width)

    const listShot = path.join(SNAPSHOT_DIR, `pl03-users-after-${viewport.name}.png`)
    await page.screenshot({ path: listShot, fullPage: true, animations: 'disabled' })
    expect(fs.statSync(listShot).size).toBeGreaterThan(1000)
  })
}
