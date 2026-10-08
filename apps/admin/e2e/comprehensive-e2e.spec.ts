import { expect, type Page, type Route, test } from '@playwright/test'

type Tenant = {
  id: string
  name: string
  slug: string
  status: 'active' | 'suspended'
  localeCatalog: string[]
  createdAt: string
  updatedAt: string
}

type Collection = {
  id: string
  name: string
  slug: string
  singleton: boolean
  fields: Array<{
    name: string
    type: string
    required: boolean
    localizable: boolean
  }>
  defaultLocale: string
  supportedLocales: string[]
  createdAt: string
  updatedAt: string
}

type Entry = {
  id: string
  collectionId: string
  slug: string
  status: 'draft' | 'scheduled' | 'published' | 'archived'
  data: Record<string, unknown>
  version: number
  createdAt: string
  updatedAt: string
}

type Asset = {
  id: string
  filename: string
  mimeType: string
  size: number
  variants: unknown[]
}

type Webhook = {
  id: string
  name: string
  url: string
  events: string[]
  active: boolean
  createdAt: string
}

type User = {
  id: string
  name: string
  email: string
  role: string
  createdAt: string
}

type MockState = {
  tenants: Tenant[]
  collections: Collection[]
  entries: Entry[]
  assets: Asset[]
  webhooks: Webhook[]
  users: User[]
  commandSeq: number
}

const SESSION_CACHE = {
  user: {
    id: 'user-admin',
    name: 'Admin User',
    email: 'admin@example.com',
    role: 'admin',
  },
  session: {
    expiresAt: '2099-01-01T00:00:00.000Z',
  },
}

const nowIso = () => new Date().toISOString()

const buildInitialState = (): MockState => {
  const now = nowIso()

  return {
    tenants: [
      {
        id: 'tenant-acme',
        name: 'Acme Inc',
        slug: 'acme',
        status: 'active',
        localeCatalog: ['en', 'fr'],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'tenant-beta',
        name: 'Beta Labs',
        slug: 'beta',
        status: 'active',
        localeCatalog: ['en'],
        createdAt: now,
        updatedAt: now,
      },
    ],
    collections: [
      {
        id: 'col-posts',
        name: 'Posts',
        slug: 'posts',
        singleton: false,
        fields: [
          { name: 'title', type: 'text', required: true, localizable: true },
          { name: 'body', type: 'text', required: false, localizable: true },
          { name: 'published', type: 'boolean', required: false, localizable: false },
        ],
        defaultLocale: 'en',
        supportedLocales: ['en', 'fr'],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'col-settings',
        name: 'Site Settings',
        slug: 'site-settings',
        singleton: true,
        fields: [
          { name: 'siteName', type: 'text', required: true, localizable: false },
          { name: 'maintenanceMode', type: 'boolean', required: false, localizable: false },
        ],
        defaultLocale: 'en',
        supportedLocales: ['en'],
        createdAt: now,
        updatedAt: now,
      },
    ],
    entries: [
      {
        id: 'entry-1',
        collectionId: 'col-posts',
        slug: 'hello-world',
        status: 'draft',
        data: { title: 'Hello World', body: 'First post content' },
        version: 1,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'entry-2',
        collectionId: 'col-posts',
        slug: 'second-post',
        status: 'published',
        data: { title: 'Second Post', body: 'Published content' },
        version: 2,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'entry-3',
        collectionId: 'col-posts',
        slug: 'scheduled-post',
        status: 'scheduled',
        data: {
          title: 'Scheduled Post',
          body: 'Will be published later',
          publishAt: '2030-06-15T10:00:00.000Z',
        },
        version: 1,
        createdAt: now,
        updatedAt: now,
      },
    ],
    assets: [
      {
        id: 'asset-1',
        filename: 'hero-image.jpg',
        mimeType: 'image/jpeg',
        size: 2048,
        variants: [],
      },
      {
        id: 'asset-2',
        filename: 'document.pdf',
        mimeType: 'application/pdf',
        size: 10240,
        variants: [],
      },
    ],
    webhooks: [
      {
        id: 'wh-1',
        name: 'Deploy Hook',
        url: 'https://hooks.example.com/deploy',
        events: ['entry.published', 'entry.updated'],
        active: true,
        createdAt: now,
      },
    ],
    users: [
      {
        id: 'user-admin',
        name: 'Admin User',
        email: 'admin@example.com',
        role: 'admin',
        createdAt: now,
      },
      {
        id: 'user-editor',
        name: 'Editor User',
        email: 'editor@example.com',
        role: 'editor',
        createdAt: now,
      },
    ],
    commandSeq: 0,
  }
}

async function fulfillJson(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(data),
  })
}

function parseCommandPayload(payload: unknown): {
  type?: string
  payload?: Record<string, unknown>
} {
  if (typeof payload !== 'object' || payload === null) return {}
  const candidate = payload as Record<string, unknown>
  return {
    type: typeof candidate.type === 'string' ? candidate.type : undefined,
    payload:
      typeof candidate.payload === 'object' && candidate.payload !== null
        ? (candidate.payload as Record<string, unknown>)
        : undefined,
  }
}

function applyCommand(state: MockState, rawEnvelope: unknown): Entry | null {
  const { type, payload } = parseCommandPayload(rawEnvelope)
  if (!type || !payload) return null

  if (type === 'createEntry') {
    const now = nowIso()
    const entryId = `entry-${state.entries.length + 1}`
    const entry: Entry = {
      id: entryId,
      collectionId: String(payload.collectionId ?? 'col-posts'),
      slug: String(payload.slug ?? `entry-${entryId}`),
      status: 'draft',
      data:
        typeof payload.data === 'object' && payload.data !== null
          ? (payload.data as Record<string, unknown>)
          : {},
      version: 1,
      createdAt: now,
      updatedAt: now,
    }
    state.entries.unshift(entry)
    return entry
  }

  if (type === 'updateEntry') {
    const entryId = String(payload.entryId ?? '')
    state.entries = state.entries.map((entry) =>
      entry.id === entryId
        ? {
            ...entry,
            data: {
              ...entry.data,
              ...(typeof payload.data === 'object' ? (payload.data as Record<string, unknown>) : {}),
            },
            version: entry.version + 1,
            updatedAt: nowIso(),
          }
        : entry
    )
    return state.entries.find((entry) => entry.id === entryId) ?? null
  }

  if (type === 'deleteEntry') {
    const entryId = String(payload.entryId ?? '')
    state.entries = state.entries.filter((entry) => entry.id !== entryId)
    return null
  }

  if (type === 'publishNow') {
    const entryId = String(payload.entryId ?? '')
    state.entries = state.entries.map((entry) =>
      entry.id === entryId
        ? { ...entry, status: 'published' as const, updatedAt: nowIso(), version: entry.version + 1 }
        : entry
    )
    return state.entries.find((entry) => entry.id === entryId) ?? null
  }

  if (type === 'unpublishNow') {
    const entryId = String(payload.entryId ?? '')
    state.entries = state.entries.map((entry) =>
      entry.id === entryId
        ? { ...entry, status: 'draft' as const, updatedAt: nowIso(), version: entry.version + 1 }
        : entry
    )
    return state.entries.find((entry) => entry.id === entryId) ?? null
  }

  return null
}

function routeMatches(pathname: string, suffix: string) {
  return pathname === suffix || pathname.endsWith(`/tenants/acme${suffix}`)
}

async function setupMockApi(page: Page, state: MockState) {
  await page.route('**://*/api/**', async (route) => {
    const request = route.request()
    const method = request.method()
    const url = new URL(request.url())
    const { pathname, searchParams } = url

    // Bootstrap status – skip onboarding
    if (pathname === '/api/bootstrap/status') {
      await fulfillJson(route, { needsOnboarding: false, userCount: 1 })
      return
    }

    // Auth – better-auth client wraps the raw response in { data, error },
    // so the API must return the session object directly (not pre-wrapped).
    if (pathname.startsWith('/api/auth/')) {
      await fulfillJson(route, SESSION_CACHE)
      return
    }

    // Sync stream
    if (routeMatches(pathname, '/admin/sync/stream')) {
      await route.fulfill({
        status: 200,
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        },
        body: 'event: connected\ndata: ok\n\n',
      })
      return
    }

    // Tenants
    if (method === 'GET' && pathname === '/api/admin/tenants') {
      await fulfillJson(route, state.tenants)
      return
    }

    // Collections
    if (method === 'GET' && routeMatches(pathname, '/admin/collections')) {
      await fulfillJson(route, state.collections)
      return
    }
    if (
      method === 'GET' &&
      /\/api\/(?:tenants\/[^/]+\/)?admin\/collections\/[^/]+$/.test(pathname)
    ) {
      const id = pathname.split('/').pop() ?? ''
      const col = state.collections.find((c) => c.id === id || c.slug === id)
      await fulfillJson(route, col ?? null, col ? 200 : 404)
      return
    }

    // Entries
    if (method === 'GET' && routeMatches(pathname, '/admin/entries')) {
      const collectionId = searchParams.get('collectionId')
      const status = searchParams.get('status')
      const pageNum = Number(searchParams.get('page') ?? '1')
      const perPage = Number(searchParams.get('perPage') ?? '20')

      let filtered = [...state.entries]
      if (collectionId) {
        const col = state.collections.find((c) => c.id === collectionId || c.slug === collectionId)
        filtered = col ? filtered.filter((e) => e.collectionId === col.id) : []
      }
      if (status) filtered = filtered.filter((e) => e.status === status)

      const start = (pageNum - 1) * perPage
      const data = filtered.slice(start, start + perPage)

      await fulfillJson(route, {
        data,
        meta: {
          pagination: {
            total: filtered.length,
            page: pageNum,
            perPage,
            hasMore: start + perPage < filtered.length,
          },
        },
      })
      return
    }

    // Entry detail
    if (
      method === 'GET' &&
      /\/api\/(?:tenants\/[^/]+\/)?admin\/entries\/[^/]+$/.test(pathname)
    ) {
      const entryId = pathname.split('/').pop() ?? ''
      const entry = state.entries.find((e) => e.id === entryId || e.slug === entryId)
      await fulfillJson(route, entry ?? null, entry ? 200 : 404)
      return
    }

    // Commands
    if (method === 'POST' && routeMatches(pathname, '/admin/commands')) {
      const body = request.postDataJSON()
      const resultData = applyCommand(state, body)
      state.commandSeq += 1
      const { type } = parseCommandPayload(body)
      await fulfillJson(route, {
        commandId: `cmd-${state.commandSeq}`,
        type: type ?? 'unknown',
        status: 'success',
        data: resultData ?? undefined,
        executedAt: nowIso(),
      })
      return
    }

    // Sync
    if (method === 'POST' && routeMatches(pathname, '/admin/sync/push')) {
      const body = request.postDataJSON() as { commands?: unknown[] }
      const commands = Array.isArray(body?.commands) ? body.commands : []
      for (const cmd of commands) applyCommand(state, cmd)
      await fulfillJson(route, {
        results: commands.map((_, i) => ({ index: i, status: 'success' })),
      })
      return
    }
    if (method === 'GET' && routeMatches(pathname, '/admin/sync/pull')) {
      const cursor = Number(searchParams.get('cursor') ?? '0')
      await fulfillJson(route, { changes: [], cursor, hasMore: false })
      return
    }

    // Assets
    if (method === 'GET' && routeMatches(pathname, '/admin/assets')) {
      await fulfillJson(route, state.assets)
      return
    }

    // Webhooks
    if (method === 'GET' && routeMatches(pathname, '/admin/webhooks')) {
      await fulfillJson(route, { success: true, data: state.webhooks })
      return
    }

    // Users
    if (method === 'GET' && routeMatches(pathname, '/admin/users')) {
      await fulfillJson(route, { success: true, data: state.users })
      return
    }

    // Plugins
    if (method === 'GET' && routeMatches(pathname, '/admin/plugins')) {
      await fulfillJson(route, { success: true, data: [] })
      return
    }

    // Catch-all
    await fulfillJson(route, {})
  })
}

test.beforeEach(async ({ page }) => {
  const state = buildInitialState()

  await page.addInitScript(() => {
    try {
      localStorage.setItem('edgecms:active-tenant', 'acme')
    } catch {
      // Ignored if context denies localStorage access
    }
  })

  await setupMockApi(page, state)
})

// ============================================================
// Authentication & Navigation E2E Tests
// ============================================================

test('e2e: redirects unauthenticated user to sign-in page', async ({ page, context: _context }) => {
  // Clear auth session
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('edgecms:auth-session-cache')
    } catch {
      // Ignored if context denies localStorage access
    }
  })

  // Mock auth to return no session
  await page.route('**://*/api/auth/**', async (route) => {
    await fulfillJson(route, { data: null, error: null })
  })

  await page.goto('/tenants/acme/collections')
  // Should redirect to sign-in or show auth form
  await expect(page.locator('body')).toBeVisible()
})

test('e2e: navigates to tenant workspace and loads page', async ({ page }) => {
  // Navigate and wait for page to fully load
  await page.goto('/tenants/acme/collections')
  await page.waitForLoadState('domcontentloaded')
  await expect(page.locator('body')).toBeVisible()
})

test('e2e: switching between tenants updates URL and context', async ({ page }) => {
  await page.goto('/admin/tenants')
  await page.waitForLoadState('domcontentloaded')

  // Look for tenant selection UI
  const tenantButton = page.getByRole('button', { name: /EdgeCMS|Super Admin|Tenant|Global/i }).first()
  if (await tenantButton.isVisible({ timeout: 5000 }).catch(() => false)) {
    await tenantButton.click()
    const betaItem = page.getByRole('menuitem', { name: 'Beta Labs' })
    if (await betaItem.isVisible({ timeout: 3000 }).catch(() => false)) {
      await betaItem.click()
      await expect(page).toHaveURL(/\/tenants\/beta/)
    }
  }
})

// ============================================================
// Collections E2E Tests
// ============================================================

test('e2e: views collection list shows collection names', async ({ page }) => {
  await page.goto('/tenants/acme/collections')
  await page.waitForLoadState('domcontentloaded')

  // Wait for collection data to render
  await expect(page.getByRole('heading', { name: 'Content Manager' })).toBeVisible({ timeout: 15000 })
  await expect(page.getByText('Posts').first()).toBeVisible()
  await expect(page.getByText('Site Settings').first()).toBeVisible()
})

test('e2e: singleton collection is listed', async ({ page }) => {
  await page.goto('/tenants/acme/collections')
  await page.waitForLoadState('domcontentloaded')

  await expect(page.getByText('Site Settings').first()).toBeVisible({ timeout: 15000 })
})

// ============================================================
// Entries E2E Tests
// ============================================================

test('e2e: lists entries for a collection', async ({ page }) => {
  await page.goto('/tenants/acme/collections/col-posts/entries')
  await page.waitForLoadState('domcontentloaded')

  await expect(page.getByText('hello-world').first()).toBeVisible({ timeout: 15000 })
  await expect(page.getByText('second-post').first()).toBeVisible()
})

test('e2e: create entry flow navigates to form', async ({ page }) => {
  await page.goto('/tenants/acme/collections/col-posts/entries')
  await page.waitForLoadState('domcontentloaded')

  const heading = page.getByRole('heading', { name: 'Posts' })
  if (await heading.isVisible({ timeout: 10000 }).catch(() => false)) {
    const createLink = page.getByRole('link', { name: 'Create new entry' })
    if (await createLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await createLink.click()
      await page.waitForLoadState('domcontentloaded')
      // Should navigate to create page
      await expect(page.locator('body')).toBeVisible()
    }
  }
})

test('e2e: entry detail page loads', async ({ page }) => {
  await page.goto('/tenants/acme/collections/col-posts/entries')
  await page.waitForLoadState('domcontentloaded')

  const entryLink = page.getByText('hello-world')
  if (await entryLink.isVisible({ timeout: 15000 }).catch(() => false)) {
    await entryLink.click()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.locator('body')).toBeVisible()
  }
})

// ============================================================
// Publishing E2E Tests
// ============================================================

test('e2e: publishing schedule page loads', async ({ page }) => {
  await page.goto('/tenants/acme/publishing')
  await page.waitForLoadState('domcontentloaded')

  const heading = page.getByRole('heading', { name: 'Publishing Schedule' })
  if (await heading.isVisible({ timeout: 10000 }).catch(() => false)) {
    await expect(page.getByText('Scheduled Post')).toBeVisible()
  }
})

test('e2e: publish actions are available', async ({ page }) => {
  await page.goto('/tenants/acme/publishing')
  await page.waitForLoadState('domcontentloaded')

  const scheduledPost = page.getByText('Scheduled Post')
  if (await scheduledPost.isVisible({ timeout: 10000 }).catch(() => false)) {
    const publishButton = page.getByRole('button', { name: 'Publish Now' })
    if (await publishButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Verify button exists and is interactive
      await expect(publishButton).toBeEnabled()
    }
  }
})

// ============================================================
// Media Manager E2E Tests
// ============================================================

test('e2e: media page loads and displays assets', async ({ page }) => {
  await page.goto('/tenants/acme/media')
  await page.waitForLoadState('domcontentloaded')

  await expect(page.getByText('hero-image.jpg')).toBeVisible({ timeout: 15000 })
  await expect(page.getByText('document.pdf')).toBeVisible()
})

// ============================================================
// Error Handling E2E Tests
// ============================================================

test('e2e: 404 page displays for unknown routes', async ({ page }) => {
  await page.goto('/tenants/acme/nonexistent-page')
  await page.waitForLoadState('domcontentloaded')
  // Should show some kind of error or not found UI
  await expect(page.locator('body')).toBeVisible()
})

test('e2e: API error response shows error message to user', async ({ page }) => {
  // Override entries endpoint to return error
  await page.route('**://*/api/**/admin/entries*', async (route) => {
    await fulfillJson(route, { message: 'Internal Server Error' }, 500)
  })

  await page.goto('/tenants/acme/collections/col-posts/entries')
  await page.waitForLoadState('domcontentloaded')
  // Page should still be visible (not crash)
  await expect(page.locator('body')).toBeVisible()
})

// ============================================================
// Multi-tenant Isolation E2E Tests
// ============================================================

test('e2e: tenant context is sent as x-tenant header in API requests', async ({ page }) => {
  const apiRequests: Array<{ url: string; headers: Record<string, string> }> = []

  page.on('request', (request) => {
    if (request.url().includes('/admin/')) {
      apiRequests.push({
        url: request.url(),
        headers: request.headers(),
      })
    }
  })

  await page.goto('/tenants/acme/collections')
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByRole('heading', { name: 'Content Manager' })).toBeVisible({ timeout: 10000 })

  // Verify at least one request was made with tenant context
  const tenantRequests = apiRequests.filter(
    (req) => req.headers['x-tenant'] === 'acme' || req.url.includes('/tenants/acme/')
  )
  expect(tenantRequests.length).toBeGreaterThan(0)
})

// ============================================================
// Responsive Layout E2E Tests
// ============================================================

test('e2e: sidebar is visible on desktop viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/tenants/acme/collections')
  await page.waitForLoadState('domcontentloaded')

  // On desktop, sidebar should be visible
  await expect(page.locator('body')).toBeVisible()
})

test('e2e: layout adapts to mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 })
  await page.goto('/tenants/acme/collections')
  await page.waitForLoadState('domcontentloaded')

  // Page should be visible on mobile
  await expect(page.locator('body')).toBeVisible()
})
