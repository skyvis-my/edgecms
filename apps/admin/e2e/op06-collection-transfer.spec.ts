import fs from 'node:fs'
import path from 'node:path'
import { expect, type Page, type Route, test } from '@playwright/test'
import { installSmokeGuards } from './smoke-guards'

// OP-06 admin screen: export download and the preview → confirm → results import flow,
// against the Vite dev server with every API call mocked.
installSmokeGuards()
// The dev server compiles on first load; give a loaded runner room.
test.setTimeout(120_000)

const SNAPSHOT_DIR = path.resolve(process.cwd(), '.playwright/visual-snapshots')
const now = '2026-11-05T09:00:00.000Z'

const SESSION = {
  user: { id: 'user-editor', name: 'Editor User', email: 'editor@example.com', role: 'viewer' },
  session: { expiresAt: '2099-01-01T00:00:00.000Z' },
}

function fakeAccessToken(tenantRole: string) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'none' })}.${encode({ sub: 'user-editor', tsl: 'acme', trl: tenantRole })}.sig`
}

const COLLECTION = {
  id: 'col-posts',
  name: 'Posts',
  slug: 'posts',
  singleton: false,
  fields: [{ name: 'title', type: 'text', required: true, localizable: false }],
  defaultLocale: 'en',
  supportedLocales: ['en'],
  createdAt: now,
  updatedAt: now,
}

const ENTRIES = [
  { id: 'e1', collectionId: 'col-posts', slug: 'hello-world', status: 'published', data: { title: 'Hello World' }, version: 2, createdAt: now, updatedAt: now },
  { id: 'e2', collectionId: 'col-posts', slug: 'edge-caching-notes', status: 'draft', data: { title: 'Edge caching notes' }, version: 1, createdAt: now, updatedAt: now },
]

const EXPORT_DOC = {
  format: 'edgecms.collection-export',
  formatVersion: 1,
  exportedAt: now,
  collection: { slug: 'posts', name: 'Posts', singleton: false, defaultLocale: 'en', supportedLocales: ['en'], fields: COLLECTION.fields, schemaHash: 'abc123' },
  entries: [
    { slug: 'hello-world', status: 'published', data: { title: 'Hello World' } },
    { slug: 'edge-caching-notes', status: 'draft', data: { title: 'Edge caching, revised' } },
    { slug: 'release-checklist', status: 'published', data: { title: 'Release checklist' } },
    { slug: 'offline-sync-guide', status: 'draft', data: { title: 'Offline sync guide' } },
    { slug: 'broken-import', status: 'draft', data: { title: 'Broken', subtitle: 'not a field' } },
  ],
  relations: [],
}

const PREVIEW = {
  collection: { id: 'col-posts', slug: 'posts' },
  strategy: 'skip',
  summary: { create: 2, update: 0, skip: 1, conflict: 1, invalid: 1 },
  entries: [
    { index: 0, slug: 'hello-world', action: 'skip', reason: 'Existing entry has the same values', entryId: 'e1' },
    { index: 1, slug: 'edge-caching-notes', action: 'conflict', reason: "Existing entry has different values; strategy 'skip' keeps it", entryId: 'e2', changedFields: ['title'] },
    { index: 2, slug: 'release-checklist', action: 'create', reason: 'New entry (created as draft, then published)', status: 'published', publish: true },
    { index: 3, slug: 'offline-sync-guide', action: 'create', reason: 'New entry', status: 'draft' },
    { index: 4, slug: 'broken-import', action: 'invalid', reason: 'Entry does not match the collection schema', validationErrors: ["Unknown field 'subtitle'"] },
  ],
  relations: [],
  warnings: ['SCHEMA_HASH_MISMATCH: the target collection schema differs from the exported schema'],
  commandCount: 3,
  diff: [],
  previewReceipt: 'receipt-demo',
  expiresAt: '2026-11-05T09:15:00.000Z',
}

const PARTIAL = {
  status: 'partial_failure',
  collection: { id: 'col-posts', slug: 'posts' },
  entries: [
    { ...PREVIEW.entries[0] },
    { ...PREVIEW.entries[1] },
    { ...PREVIEW.entries[2], outcome: 'success', publishOutcome: 'failed', error: 'Publish rejected: required field missing in locale fr' },
    { ...PREVIEW.entries[3], outcome: 'not_run' },
    { ...PREVIEW.entries[4] },
  ],
  relations: [],
  warnings: [],
  commandIds: ['cmd-1'],
}

async function fulfillJson(route: Route, data: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ success: true, data }) })
}

type Calls = { preview: unknown[]; execute: unknown[] }

async function mockApi(page: Page, tenantRole: string): Promise<Calls> {
  const calls: Calls = { preview: [], execute: [] }
  await page.addInitScript((session) => {
    try {
      localStorage.setItem('edgecms:auth-session-cache', JSON.stringify(session))
      localStorage.setItem('edgecms:active-tenant', 'acme')
    } catch {
      // storage may be blocked
    }
  }, SESSION)

  await page.route('**://*/api/**', async (route) => {
    const request = route.request()
    const method = request.method()
    const { pathname } = new URL(request.url())
    const raw = (data: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })

    if (pathname === '/api/bootstrap/status') return raw({ needsOnboarding: false, userCount: 1 })
    if (pathname === '/api/auth/get-session' || pathname === '/api/auth/session') return raw(SESSION)
    if (pathname === '/api/auth/access-token') {
      return raw({ success: true, data: { token: fakeAccessToken(tenantRole), expiresAt: '2099-01-01T00:00:00.000Z' } })
    }
    if (pathname.startsWith('/api/auth/')) return raw({ data: SESSION, error: null })
    if (pathname === '/api/csrf') return fulfillJson(route, { csrfToken: 'csrf' })
    if (pathname.endsWith('/admin/sync/pull')) return raw({ changes: [], cursor: 0, hasMore: false })
    if (pathname.endsWith('/admin/sync/push')) return raw({ results: [] })
    if (pathname.endsWith('/admin/sync/stream')) {
      return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: 'event: connected\ndata: ok\n\n' })
    }
    if (pathname === '/api/admin/tenants') {
      return raw([{ id: 't1', name: 'Acme Inc', slug: 'acme', status: 'active', localeCatalog: ['en'], createdAt: now, updatedAt: now }])
    }
    if (pathname.endsWith('/admin/collections/posts/export')) return fulfillJson(route, EXPORT_DOC)
    if (method === 'POST' && pathname.endsWith('/admin/collections/posts/import/preview')) {
      calls.preview.push(request.postDataJSON())
      return fulfillJson(route, PREVIEW)
    }
    if (method === 'POST' && pathname.endsWith('/admin/collections/posts/import/execute')) {
      calls.execute.push(request.postDataJSON())
      return fulfillJson(route, PARTIAL, 207)
    }
    if (pathname.endsWith('/admin/collections')) return raw([COLLECTION])
    if (/\/admin\/collections\/[^/]+$/.test(pathname)) return raw(COLLECTION)
    if (pathname.endsWith('/admin/entries')) {
      return raw({ data: ENTRIES, meta: { pagination: { total: ENTRIES.length, page: 1, perPage: 20, hasMore: false } } })
    }
    return raw({})
  })
  return calls
}

async function snap(page: Page, name: string) {
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true })
  const file = path.join(SNAPSHOT_DIR, `${name}.png`)
  await page.screenshot({ path: file, fullPage: true, animations: 'disabled' })
  expect(fs.statSync(file).size).toBeGreaterThan(1000)
}

async function expectNoHorizontalPageScroll(page: Page, width: number) {
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(scrollWidth).toBeLessThanOrEqual(width)
}

test('OP-06: members see only Export', async ({ page }) => {
  await mockApi(page, 'member')
  await page.goto('/tenants/acme/collections/posts/entries')
  await expect(page.getByRole('button', { name: 'Export' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Import' })).toHaveCount(0)
})

test('OP-06: viewers do not see the transfer buttons', async ({ page }) => {
  await mockApi(page, 'viewer')
  await page.goto('/tenants/acme/collections/posts/entries')
  await expect(page.getByText('hello-world').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Export' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Import' })).toHaveCount(0)
})

for (const viewport of [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'mobile-375', width: 375, height: 812 },
]) {
  test(`OP-06: export downloads JSON and import runs preview, confirm and 207 results (${viewport.name})`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    const calls = await mockApi(page, 'editor')
    await page.goto('/tenants/acme/collections/posts/entries')
    await expect(page.getByText('hello-world').first()).toBeVisible()

    const exportButton = page.getByRole('button', { name: 'Export' })
    await expect(exportButton).toBeVisible()
    await expectNoHorizontalPageScroll(page, viewport.width)
    await snap(page, `op06-entries-actions-${viewport.name}`)

    const [download] = await Promise.all([page.waitForEvent('download'), exportButton.click()])
    expect(download.suggestedFilename()).toMatch(/^posts-export-\d{4}-\d{2}-\d{2}\.json$/)

    // Keyboard: open the dialog from the Import button.
    await page.getByRole('button', { name: 'Import' }).focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Import entries into Posts' })).toBeVisible()
    await dialog.getByLabel('Export file (.json)').setInputFiles({
      name: 'posts-export.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(EXPORT_DOC)),
    })
    await dialog.getByRole('button', { name: 'Preview import' }).click()

    const plan = dialog.getByRole('list', { name: 'Entry plan' })
    await expect(plan.getByText("Unknown field 'subtitle'")).toBeVisible()
    await expect(dialog.getByText(/SCHEMA_HASH_MISMATCH/)).toBeVisible()
    expect(calls.execute).toHaveLength(0)
    await expectNoHorizontalPageScroll(page, viewport.width)
    await snap(page, `op06-import-preview-${viewport.name}`)

    await dialog.getByRole('button', { name: 'Confirm import' }).click()
    await expect(dialog.getByText('Import stopped partway')).toBeVisible()
    expect(calls.execute).toEqual([{ document: EXPORT_DOC, strategy: 'skip', previewReceipt: 'receipt-demo' }])
    await expect(dialog.getByText('Publish rejected: required field missing in locale fr')).toBeVisible()
    await expectNoHorizontalPageScroll(page, viewport.width)
    await snap(page, `op06-import-result-${viewport.name}`)

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })
}
