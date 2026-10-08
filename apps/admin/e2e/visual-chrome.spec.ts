import fs from 'node:fs'
import path from 'node:path'
import { expect, type Page, type Route, test } from '@playwright/test'
import { installSmokeGuards } from './smoke-guards'

installSmokeGuards()

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
  url: string
  events: string[]
  headers: Record<string, string>
  secret: string
  retryConfig: {
    maxRetries: number
    timeout: number
  }
  status: 'enabled' | 'disabled'
  createdAt: string
  updatedAt: string
  lastDeliveryStatus?: 'delivered' | 'failed'
}

type User = {
  id: string
  firstName: string
  lastName: string
  username: string
  email: string
  phoneNumber?: string
  status: 'active' | 'invited' | 'suspended'
  role: 'superadmin' | 'admin' | 'editor' | 'viewer'
  createdAt: string
  updatedAt: string
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

const SNAPSHOT_DIR = path.resolve(process.cwd(), '.playwright/visual-snapshots')

function ensureSnapshotDir() {
  if (!fs.existsSync(SNAPSHOT_DIR)) {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true })
  }
}

const buildInitialState = (): MockState => {
  const now = nowIso()

  return {
    tenants: [
      {
        id: 'tenant-acme',
        name: 'Acme Inc',
        slug: 'acme',
        status: 'active',
        localeCatalog: ['en'],
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
          {
            name: 'title',
            type: 'text',
            required: true,
            localizable: false,
          },
        ],
        defaultLocale: 'en',
        supportedLocales: ['en'],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'col-settings',
        name: 'Site Settings',
        slug: 'site-settings',
        singleton: true,
        fields: [
          {
            name: 'siteName',
            type: 'text',
            required: true,
            localizable: false,
          },
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
        data: { title: 'Hello World' },
        version: 1,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'entry-2',
        collectionId: 'col-posts',
        slug: 'launch-post',
        status: 'scheduled',
        data: {
          title: 'Launch Post',
          publishAt: '2030-01-01T10:00:00.000Z',
        },
        version: 1,
        createdAt: now,
        updatedAt: now,
      },
    ],
    assets: [
      {
        id: 'asset-1',
        filename: 'cover-image.jpg',
        mimeType: 'image/jpeg',
        size: 1024,
        variants: [],
      },
      {
        id: 'asset-2',
        filename: 'docs/brand-guidelines.pdf',
        mimeType: 'application/pdf',
        size: 2048,
        variants: [],
      },
    ],
    webhooks: [
      {
        id: 'webhook-1',
        url: 'https://example.com/edgecms-webhook',
        events: ['entry.created', 'entry.published'],
        headers: {},
        secret: 'test-secret',
        retryConfig: { maxRetries: 3, timeout: 5000 },
        status: 'enabled',
        createdAt: now,
        updatedAt: now,
        lastDeliveryStatus: 'delivered',
      },
    ],
    users: [
      {
        id: 'user-editor',
        firstName: 'Editor',
        lastName: 'User',
        username: 'editor_user',
        email: 'editor@example.com',
        phoneNumber: '+10000000000',
        status: 'active',
        role: 'editor',
        createdAt: now,
        updatedAt: now,
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
      status:
        payload.status === 'scheduled' ||
        payload.status === 'published' ||
        payload.status === 'archived'
          ? payload.status
          : 'draft',
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

  if (type === 'deleteEntry') {
    const entryId = String(payload.entryId ?? '')
    state.entries = state.entries.filter((entry) => entry.id !== entryId)
    return null
  }

  if (type === 'publishNow') {
    const entryId = String(payload.entryId ?? '')
    state.entries = state.entries.map((entry) =>
      entry.id === entryId
        ? {
            ...entry,
            status: 'published',
            updatedAt: nowIso(),
            version: entry.version + 1,
          }
        : entry
    )
    return state.entries.find((entry) => entry.id === entryId) ?? null
  }

  if (type === 'unpublishNow') {
    const entryId = String(payload.entryId ?? '')
    state.entries = state.entries.map((entry) =>
      entry.id === entryId
        ? {
            ...entry,
            status: 'draft',
            updatedAt: nowIso(),
            version: entry.version + 1,
          }
        : entry
    )
    return state.entries.find((entry) => entry.id === entryId) ?? null
  }

  if (type === 'schedulePublish') {
    const entryId = String(payload.entryId ?? '')
    const publishAt = typeof payload.publishAt === 'string' ? payload.publishAt : nowIso()
    state.entries = state.entries.map((entry) =>
      entry.id === entryId
        ? {
            ...entry,
            status: 'scheduled',
            data: {
              ...entry.data,
              publishAt,
            },
            updatedAt: nowIso(),
            version: entry.version + 1,
          }
        : entry
    )
    return state.entries.find((entry) => entry.id === entryId) ?? null
  }

  if (type === 'cancelSchedule') {
    const entryId = String(payload.entryId ?? '')
    state.entries = state.entries.map((entry) =>
      entry.id === entryId
        ? {
            ...entry,
            status: 'draft',
            updatedAt: nowIso(),
            version: entry.version + 1,
          }
        : entry
    )
    return state.entries.find((entry) => entry.id === entryId) ?? null
  }

  return null
}

function routeMatches(pathname: string, suffix: string) {
  return pathname === suffix || pathname === `/api${suffix}` || pathname.endsWith(`/tenants/acme${suffix}`)
}

async function setupMockApi(page: Page, state: MockState) {
  await page.route('**://*/api/**', async (route) => {
    const request = route.request()
    const method = request.method()
    const url = new URL(request.url())
    const { pathname, searchParams } = url

    if (method === 'GET' && pathname === '/api/bootstrap/status') {
      await fulfillJson(route, {
        needsOnboarding: false,
        userCount: 1,
      })
      return
    }

    if (
      method === 'GET' &&
      (pathname === '/api/auth/get-session' || pathname === '/api/auth/session')
    ) {
      await fulfillJson(route, SESSION_CACHE)
      return
    }

    if (pathname.startsWith('/api/auth/')) {
      await fulfillJson(route, {
        data: SESSION_CACHE,
        error: null,
      })
      return
    }

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

    if (method === 'GET' && pathname === '/api/admin/tenants') {
      await fulfillJson(route, state.tenants)
      return
    }

    if (method === 'GET' && /^\/api\/(?:tenants\/[^/]+\/)?admin\/tenants\/[^/]+$/.test(pathname)) {
      const tenantSlug = pathname.split('/').pop() ?? ''
      const tenant = state.tenants.find((candidate) => candidate.slug === tenantSlug)
      await fulfillJson(
        route,
        tenant
          ? {
              ...tenant,
              users: [
                {
                  id: 'tenant-user-editor',
                  email: 'editor@example.com',
                  name: 'Editor User',
                  role: 'admin',
                },
              ],
            }
          : null,
        tenant ? 200 : 404
      )
      return
    }

    if (method === 'GET' && routeMatches(pathname, '/admin/collections')) {
      await fulfillJson(route, state.collections)
      return
    }

    if (
      method === 'GET' &&
      /\/api\/(?:tenants\/[^/]+\/)?admin\/collections\/[^/]+$/.test(pathname)
    ) {
      const collectionIdentifier = pathname.split('/').pop() ?? ''
      const collection = state.collections.find(
        (candidate) => candidate.id === collectionIdentifier || candidate.slug === collectionIdentifier
      )
      await fulfillJson(route, collection ?? null, collection ? 200 : 404)
      return
    }

    if (method === 'GET' && routeMatches(pathname, '/admin/entries')) {
      const collectionId = searchParams.get('collectionId')
      const status = searchParams.get('status')
      const pageNumber = Number(searchParams.get('page') ?? '1')
      const perPage = Number(searchParams.get('perPage') ?? '20')

      let filtered = [...state.entries]
      if (collectionId) {
        const matchedCollection = state.collections.find(
          (collection) => collection.id === collectionId || collection.slug === collectionId
        )
        filtered = matchedCollection
          ? filtered.filter((entry) => entry.collectionId === matchedCollection.id)
          : []
      }
      if (status) filtered = filtered.filter((entry) => entry.status === status)

      const start = (pageNumber - 1) * perPage
      const data = filtered.slice(start, start + perPage)

      await fulfillJson(route, {
        data,
        meta: {
          pagination: {
            total: filtered.length,
            page: pageNumber,
            perPage,
            hasMore: start + perPage < filtered.length,
          },
        },
      })
      return
    }

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

    if (method === 'POST' && routeMatches(pathname, '/admin/sync/push')) {
      const body = request.postDataJSON() as { commands?: unknown[] }
      const commands = Array.isArray(body?.commands) ? body.commands : []
      for (const command of commands) {
        applyCommand(state, command)
      }
      await fulfillJson(route, {
        results: commands.map((_command, index) => ({
          index,
          status: 'success',
        })),
      })
      return
    }

    if (method === 'GET' && routeMatches(pathname, '/admin/sync/pull')) {
      const cursor = Number(searchParams.get('cursor') ?? '0')
      await fulfillJson(route, {
        changes: [],
        cursor,
        hasMore: false,
      })
      return
    }

    if (method === 'GET' && routeMatches(pathname, '/admin/assets')) {
      await fulfillJson(route, state.assets)
      return
    }

    if (method === 'GET' && routeMatches(pathname, '/admin/webhooks')) {
      await fulfillJson(route, state.webhooks)
      return
    }

    if (method === 'GET' && routeMatches(pathname, '/admin/users')) {
      await fulfillJson(route, state.users)
      return
    }

    if (method === 'POST' && routeMatches(pathname, '/admin/assets/delete')) {
      const body = request.postDataJSON() as { ids?: string[] }
      const ids = Array.isArray(body?.ids) ? body.ids : []
      state.assets = state.assets.filter((asset) => !ids.includes(asset.id))
      await fulfillJson(route, { deletedIds: ids })
      return
    }

    if (method === 'PUT' && /\/api\/(?:tenants\/[^/]+\/)?admin\/assets\/[^/]+$/.test(pathname)) {
      const assetId = pathname.split('/').pop() ?? ''
      const body = request.postDataJSON() as { filename?: string }
      const asset = state.assets.find((candidate) => candidate.id === assetId)
      if (!asset) {
        await fulfillJson(route, { message: 'Not found' }, 404)
        return
      }
      asset.filename = body?.filename ?? asset.filename
      await fulfillJson(route, asset)
      return
    }

    if (method === 'POST' && routeMatches(pathname, '/admin/assets/upload')) {
      const body = request.postDataJSON() as { filename?: string; mimeType?: string }
      const newAsset: Asset = {
        id: `asset-${state.assets.length + 1}`,
        filename: body?.filename ?? `asset-${state.assets.length + 1}.bin`,
        mimeType: body?.mimeType ?? 'application/octet-stream',
        size: 512,
        variants: [],
      }
      state.assets.unshift(newAsset)
      await fulfillJson(route, newAsset)
      return
    }

    await fulfillJson(route, {})
  })
}

test.beforeAll(() => {
  ensureSnapshotDir()
})

test.beforeEach(async ({ page }) => {
  const state = buildInitialState()

  await page.addInitScript((session) => {
    try {
      localStorage.setItem('edgecms:auth-session-cache', JSON.stringify(session))
      localStorage.setItem('edgecms:active-tenant', 'acme')
    } catch {
      // Ignored if storage restricted
    }
  }, SESSION_CACHE)

  await setupMockApi(page, state)
})

test('visual: authentication sign-in renders login card and credentials form', async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('edgecms:auth-session-cache')
      localStorage.removeItem('edgecms:active-tenant')
    } catch {
      // Ignored
    }
  })
  await page.route('**://*/api/auth/**', async (route) => {
    await fulfillJson(route, { data: null, session: null, user: null }, 401)
  })

  await page.goto('/sign-in')
  await page.waitForLoadState('domcontentloaded')

  await expect(page.getByRole('heading', { name: 'EdgeCMS' })).toBeVisible()
  await expect(page.getByText('Sign in').first()).toBeVisible()
  await expect(page.getByLabel('Email')).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Password' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()

  const screenshotPath = path.join(SNAPSHOT_DIR, '00-sign-in.png')
  await page.screenshot({ path: screenshotPath, fullPage: true, animations: 'disabled' })

  expect(fs.existsSync(screenshotPath)).toBe(true)
  expect(fs.statSync(screenshotPath).size).toBeGreaterThan(1000)
})

test('visual: collections management view renders sidebar, header, and collection cards', async ({ page }) => {
  await page.goto('/tenants/acme/collections')
  await page.waitForLoadState('domcontentloaded')

  await expect(page.getByRole('heading', { name: 'Content Manager' })).toBeVisible()
  await expect(page.getByText('Posts').first()).toBeVisible()
  await expect(page.getByText('Site Settings').first()).toBeVisible()

  const screenshotPath = path.join(SNAPSHOT_DIR, '01-collections-dashboard.png')
  await page.screenshot({ path: screenshotPath, fullPage: true, animations: 'disabled' })

  expect(fs.existsSync(screenshotPath)).toBe(true)
  expect(fs.statSync(screenshotPath).size).toBeGreaterThan(1000)
})

test('visual: entries list view displays posts table, status badges, and action buttons', async ({ page }) => {
  await page.goto('/tenants/acme/collections/posts/entries')
  await page.waitForLoadState('domcontentloaded')

  await expect(page.getByRole('heading', { name: 'Posts' })).toBeVisible()
  await expect(page.getByText('hello-world').first()).toBeVisible()

  const screenshotPath = path.join(SNAPSHOT_DIR, '02-entry-list.png')
  await page.screenshot({ path: screenshotPath, fullPage: true, animations: 'disabled' })

  expect(fs.existsSync(screenshotPath)).toBe(true)
  expect(fs.statSync(screenshotPath).size).toBeGreaterThan(1000)
})

test('visual: entry create form renders all input fields, slug generator, and action bar', async ({ page }) => {
  await page.goto('/tenants/acme/collections/posts/entries/create')
  await page.waitForLoadState('domcontentloaded')

  await expect(page.getByLabel(/title/i)).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Slug' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save' })).toBeVisible()

  await page.getByLabel(/title/i).fill('Modern Edge Publishing Guide')
  await page.getByRole('textbox', { name: 'Slug' }).fill('modern-edge-publishing-guide')

  const screenshotPath = path.join(SNAPSHOT_DIR, '03-entry-editor.png')
  await page.screenshot({ path: screenshotPath, fullPage: true, animations: 'disabled' })

  expect(fs.existsSync(screenshotPath)).toBe(true)
  expect(fs.statSync(screenshotPath).size).toBeGreaterThan(1000)
})

test('visual: media manager displays asset grid, breadcrumb navigation, and upload tools', async ({ page }) => {
  await page.goto('/tenants/acme/media')
  await page.waitForLoadState('domcontentloaded')

  await expect(page.getByText('cover-image.jpg').first()).toBeVisible()
  await expect(page.getByText('docs').first()).toBeVisible()

  const screenshotPath = path.join(SNAPSHOT_DIR, '04-media-manager.png')
  await page.screenshot({ path: screenshotPath, fullPage: true, animations: 'disabled' })

  expect(fs.existsSync(screenshotPath)).toBe(true)
  expect(fs.statSync(screenshotPath).size).toBeGreaterThan(1000)
})

test('visual: publishing schedule overview renders scheduled timeline and status controls', async ({ page }) => {
  await page.goto('/tenants/acme/publishing')
  await page.waitForLoadState('domcontentloaded')

  await expect(page.getByRole('heading', { name: 'Publishing Schedule' })).toBeVisible()
  await expect(page.getByText('Launch Post')).toBeVisible()

  const screenshotPath = path.join(SNAPSHOT_DIR, '05-publishing-schedule.png')
  await page.screenshot({ path: screenshotPath, fullPage: true, animations: 'disabled' })

  expect(fs.existsSync(screenshotPath)).toBe(true)
  expect(fs.statSync(screenshotPath).size).toBeGreaterThan(1000)
})

test('visual: user management admin view renders user directory and permission roles', async ({ page }) => {
  await page.goto('/tenants/acme/users')
  await page.waitForLoadState('domcontentloaded')

  await expect(page.getByRole('heading', { name: 'User List' })).toBeVisible()
  await expect(page.getByText('editor_user').first()).toBeVisible()

  const screenshotPath = path.join(SNAPSHOT_DIR, '06-users-admin.png')
  await page.screenshot({ path: screenshotPath, fullPage: true, animations: 'disabled' })

  expect(fs.existsSync(screenshotPath)).toBe(true)
  expect(fs.statSync(screenshotPath).size).toBeGreaterThan(1000)
})

test('visual: responsive mobile viewport cleanly scales navigation and workspace', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/tenants/acme/collections')
  await page.waitForLoadState('domcontentloaded')

  await expect(page.getByRole('heading', { name: 'Content Manager' })).toBeVisible()

  const screenshotPath = path.join(SNAPSHOT_DIR, '07-mobile-workspace.png')
  await page.screenshot({ path: screenshotPath, fullPage: true, animations: 'disabled' })

  expect(fs.existsSync(screenshotPath)).toBe(true)
  expect(fs.statSync(screenshotPath).size).toBeGreaterThan(1000)
})

test('visual: webhooks management view renders endpoint list and subscription details', async ({ page }) => {
  await page.goto('/tenants/acme/webhooks')
  await page.waitForLoadState('domcontentloaded')

  await expect(page.getByRole('heading', { name: 'Webhooks' })).toBeVisible()
  await expect(page.getByText('https://example.com/edgecms-webhook')).toBeVisible()

  const screenshotPath = path.join(SNAPSHOT_DIR, '08-webhooks-management.png')
  await page.screenshot({ path: screenshotPath, fullPage: true, animations: 'disabled' })

  expect(fs.existsSync(screenshotPath)).toBe(true)
  expect(fs.statSync(screenshotPath).size).toBeGreaterThan(1000)
})

test('visual: schema builder view renders collection configuration and field setup', async ({ page }) => {
  await page.goto('/tenants/acme/collections/create')
  await page.waitForLoadState('domcontentloaded')

  await expect(page.getByRole('heading', { name: 'Create Collection' })).toBeVisible()
  await expect(page.getByLabel(/name/i).first()).toBeVisible()

  const screenshotPath = path.join(SNAPSHOT_DIR, '09-collection-builder.png')
  await page.screenshot({ path: screenshotPath, fullPage: true, animations: 'disabled' })

  expect(fs.existsSync(screenshotPath)).toBe(true)
  expect(fs.statSync(screenshotPath).size).toBeGreaterThan(1000)
})

test('visual: superadmin tenants view renders tenant directory and workspace controls', async ({ page }) => {
  await page.goto('/admin/tenants')
  await page.waitForLoadState('domcontentloaded')

  await expect(page.getByRole('heading', { name: 'Tenants' })).toBeVisible()
  await expect(page.getByText('Acme Inc').first()).toBeVisible()

  const screenshotPath = path.join(SNAPSHOT_DIR, '10-tenants-admin.png')
  await page.screenshot({ path: screenshotPath, fullPage: true, animations: 'disabled' })

  expect(fs.existsSync(screenshotPath)).toBe(true)
  expect(fs.statSync(screenshotPath).size).toBeGreaterThan(1000)
})

test('visual: dark theme mode properly styles workspace and high-contrast components', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.addInitScript(() => {
    try {
      document.cookie = 'vite-ui-theme=dark; path=/; max-age=31536000'
    } catch {
      // Ignored
    }
  })
  await page.goto('/tenants/acme/collections')
  await page.waitForLoadState('domcontentloaded')

  await expect(page.getByRole('heading', { name: 'Content Manager' })).toBeVisible()
  await expect(page.getByText('Posts').first()).toBeVisible()

  const screenshotPath = path.join(SNAPSHOT_DIR, '11-dark-mode-workspace.png')
  await page.screenshot({ path: screenshotPath, fullPage: true, animations: 'disabled' })

  expect(fs.existsSync(screenshotPath)).toBe(true)
  expect(fs.statSync(screenshotPath).size).toBeGreaterThan(1000)
})
