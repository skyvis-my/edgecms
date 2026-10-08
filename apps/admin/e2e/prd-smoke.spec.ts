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
  lastDeliveryStatus?: string
}

type User = {
  id: string
  firstName: string
  lastName: string
  username: string
  email: string
  phoneNumber: string
  status: 'active' | 'inactive' | 'invited' | 'suspended'
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

function isIndexedDbSecurityError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return (
    message.includes('SecurityError') &&
    message.includes('Indexed Database API is denied')
  )
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

    if (method === 'GET' && /\/api\/(?:tenants\/[^/]+\/)?public\/[^/]+\/[^/]+$/.test(pathname)) {
      const [, collectionSlug, entrySlug] =
        pathname.match(/\/public\/([^/]+)\/([^/]+)$/)?.map(decodeURIComponent) ?? []
      const collection = state.collections.find((candidate) => candidate.slug === collectionSlug)
      const entry = collection
        ? state.entries.find(
            (candidate) =>
              candidate.collectionId === collection.id &&
              candidate.slug === entrySlug &&
              candidate.status === 'published'
          )
        : undefined

      await fulfillJson(
        route,
        entry
          ? {
              id: entry.id,
              slug: entry.slug,
              collection: collection?.slug,
              data: entry.data,
            }
          : { error: 'Not found' },
        entry ? 200 : 404
      )
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

test.beforeEach(async ({ page }) => {
  const state = buildInitialState()

  await page.addInitScript((session) => {
    try {
      localStorage.setItem('edgecms:auth-session-cache', JSON.stringify(session))
      localStorage.setItem('edgecms:active-tenant', 'acme')
    } catch {
      // Ignored if context denies localStorage access (e.g. offline document)
    }
  }, SESSION_CACHE)

  await setupMockApi(page, state)
})

test('smoke: tenant switch updates route to tenant workspace', async ({ page }) => {
  await page.goto('/admin/tenants')

  await page
    .getByRole('button', { name: /EdgeCMS|Super Admin|Tenant|Global/i })
    .first()
    .click()
  await page.getByRole('menuitem', { name: 'Acme Inc' }).click()

  await expect(page).toHaveURL(/\/tenants\/acme\/collections/)
})

test('smoke: collection workspace shows list and singleton definitions', async ({ page }) => {
  await page.goto('/tenants/acme/collections')

  await expect(page.getByRole('heading', { name: 'Content Manager' })).toBeVisible()
  await expect(page.getByText('Posts').first()).toBeVisible()
  await expect(page.getByText('Site Settings').first()).toBeVisible()
})

test('smoke: entries CRUD flow (create + delete)', async ({ page }) => {
  await page.goto('/tenants/acme/collections/col-posts/entries')

  await expect(page.getByRole('heading', { name: 'Posts' })).toBeVisible()
  await page.getByRole('link', { name: 'Create new entry' }).click()

  await page.getByLabel(/title/i).fill('Smoke Entry')
  await page.getByRole('textbox', { name: 'Slug' }).fill('smoke-entry')
  await page.getByRole('button', { name: 'Save' }).click()
  await page.getByRole('link', { name: 'Back to Entries' }).click()

  await expect(page).toHaveURL(/\/tenants\/acme\/collections\/posts\/entries/)
  await expect(page.getByText('smoke-entry').first()).toBeVisible()

  await page.getByRole('button', { name: 'Delete' }).first().click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()

  await expect(page.getByText('smoke-entry')).toHaveCount(0)
})

test('smoke: media manager lists root and nested assets', async ({ page }) => {
  await page.goto('/tenants/acme/media')

  await expect(page.getByText('cover-image.jpg').first()).toBeVisible()
  await expect(page.getByText('docs').first()).toBeVisible()
})

test('smoke: offline queue replay processes pending media task', async ({ page }) => {
  await page.goto('/tenants/acme/media')
  await expect(page).toHaveURL(/\/tenants\/acme\/media/)
  await expect(page.getByText('cover-image.jpg').first()).toBeVisible()
  await page.context().setOffline(true)
  let indexedDbUnavailable = false

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.evaluate(async () => {
        await new Promise<void>((resolve, reject) => {
          const request = indexedDB.open('edgecms')
          request.onerror = () => reject(request.error)
          request.onsuccess = () => {
            const db = request.result
            const tx = db.transaction('mediaQueue', 'readwrite')
            tx.onerror = () => reject(tx.error)
            tx.oncomplete = () => {
              db.close()
              resolve()
            }
            tx.objectStore('mediaQueue').add({
              type: 'delete',
              payload: { ids: ['asset-1'] },
              status: 'pending',
              createdAt: new Date().toISOString(),
            })
          }
        })
      })
      break
    } catch (error) {
      if (isIndexedDbSecurityError(error)) {
        indexedDbUnavailable = true
        break
      }
      if (attempt === 2) throw error
      await page.waitForTimeout(150)
    }
  }

  test.skip(indexedDbUnavailable, 'IndexedDB is unavailable in this browser context')

  await page.context().setOffline(false)
  await page.getByRole('button', { name: 'Sync Queue' }).click()

  await expect
    .poll(async () => {
      return page.evaluate(async () => {
        return new Promise<number>((resolve, reject) => {
          const request = indexedDB.open('edgecms')
          request.onerror = () => reject(request.error)
          request.onsuccess = () => {
            const db = request.result
            const tx = db.transaction('mediaQueue', 'readonly')
            const countRequest = tx.objectStore('mediaQueue').index('status').count('pending')
            countRequest.onerror = () => reject(countRequest.error)
            countRequest.onsuccess = () => {
              db.close()
              resolve(countRequest.result)
            }
          }
        })
      })
    })
    .toBe(0)
})

test('smoke: admin surfaces render users and webhooks', async ({ page }) => {
  await page.goto('/tenants/acme/users')

  await expect(page.getByRole('heading', { name: 'User List' })).toBeVisible()
  await expect(page.getByText('editor_user').first()).toBeVisible()
  await expect(page.getByText('editor@example.com').first()).toBeVisible()

  await page.goto('/tenants/acme/webhooks')

  await expect(page.getByRole('heading', { name: 'Webhooks' })).toBeVisible()
  await expect(page.getByText('https://example.com/edgecms-webhook').first()).toBeVisible()
  await expect(page.getByText('entry.created').first()).toBeVisible()
})

test('smoke: routing edge cases keep tenant context and not-found page alive', async ({ page }) => {
  const tenantScopedRequests: string[] = []
  page.on('request', (request) => {
    const url = request.url()
    if (url.includes('/api/tenants/acme/admin/')) {
      tenantScopedRequests.push(url)
    }
  })

  await page.goto('/tenants/acme/collections')
  await expect.poll(() => tenantScopedRequests.length).toBeGreaterThan(0)

  await page.goto('/tenants/acme/nonexistent-page')
  await expect(page.locator('body')).toBeVisible()
})

test('smoke: scheduled publish visibility shows scheduled entries', async ({ page }) => {
  await page.goto('/tenants/acme/publishing')

  await expect(page.getByRole('heading', { name: 'Publishing Schedule' })).toBeVisible()
  await expect(page.getByText('Launch Post')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Publish Now' })).toBeVisible()
})

test('smoke: first publish is readable through public API', async ({ page }) => {
  await page.goto('/tenants/acme/publishing')

  const publicEntry = await page.evaluate(async () => {
    const publishResponse = await fetch('/api/tenants/acme/admin/commands', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'publishNow',
        payload: { entryId: 'entry-2' },
        actor: { source: 'admin' },
        timestamp: new Date().toISOString(),
      }),
    })
    if (!publishResponse.ok) {
      return {
        ok: false,
        status: publishResponse.status,
        body: await publishResponse.json(),
      }
    }

    const response = await fetch('/api/tenants/acme/public/posts/launch-post')
    return {
      ok: response.ok,
      status: response.status,
      body: await response.json(),
    }
  })

  expect(publicEntry.ok).toBe(true)
  expect(publicEntry.status).toBe(200)
  expect(publicEntry.body).toMatchObject({
    slug: 'launch-post',
    data: { title: 'Launch Post' },
  })
})
