import { existsSync, readFileSync } from 'node:fs'
import { spawn, type ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'

const requiredFiles = [
  '.env.example',
  'apps/api/src/index.ts',
  'apps/admin/src/index.ts',
  'fixtures/smoke-seed.json',
  'fixtures/media/smoke-hero.txt',
  'scripts/seed.ts',
  '.edgecms/smoke-seed-applied.json',
]

for (const file of requiredFiles) {
  if (!existsSync(file)) {
    throw new Error(`Missing starter file: ${file}`)
  }
}

const envExample = readFileSync('.env.example', 'utf8')

const requiredEnv = {
  EDGE_CMS_URL: 'http://localhost:8787',
  EDGE_CMS_ADMIN_URL: 'http://localhost:5173',
  EDGE_CMS_TENANT: 'smoke',
  EDGE_CMS_COLLECTION: 'smoke-posts',
}

for (const [key, expectedValue] of Object.entries(requiredEnv)) {
  const match = envExample.match(new RegExp(`^${key}=(.*)$`, 'm'))
  if (!match) {
    throw new Error(`Missing env example key: ${key}`)
  }

  const value = match[1]?.trim()
  if (!value) {
    throw new Error(`Missing env example value for ${key}. Expected starter value: ${expectedValue}`)
  }

  if (value !== expectedValue) {
    throw new Error(`Unexpected ${key} starter value. Expected ${expectedValue}, received ${value}`)
  }
}

const seedFixture = JSON.parse(readFileSync('fixtures/smoke-seed.json', 'utf8')) as {
  tenant?: { slug?: string }
  collection?: { slug?: string }
  entry?: { title?: string; slug?: string; status?: string }
  media?: { filename?: string }
  trustedPluginStatus?: { pluginId?: string; status?: string }
  webhook?: { event?: string; destination?: string; dryRun?: boolean }
}
const appliedSeed = JSON.parse(readFileSync('.edgecms/smoke-seed-applied.json', 'utf8')) as {
  tenantSlug?: string
  collectionSlug?: string
  entrySlug?: string
  webhookEvent?: string
}

if (seedFixture.tenant?.slug !== 'smoke') {
  throw new Error('Smoke seed fixture must include tenant slug "smoke".')
}

if (seedFixture.collection?.slug !== 'smoke-posts') {
  throw new Error('Smoke seed fixture must include collection slug "smoke-posts".')
}

if (seedFixture.collection?.tenantSlug !== seedFixture.tenant?.slug) {
  throw new Error('Smoke seed collection must reference the smoke tenant.')
}

if (seedFixture.entry?.status !== 'published') {
  throw new Error('Smoke seed fixture must include a published entry.')
}

if (seedFixture.entry?.slug !== 'hello-edgecms') {
  throw new Error('Smoke seed fixture must include entry slug "hello-edgecms".')
}

if (seedFixture.entry?.collectionSlug !== seedFixture.collection?.slug) {
  throw new Error('Smoke seed entry must reference the smoke collection.')
}

if (seedFixture.media?.filename !== 'smoke-hero.txt') {
  throw new Error('Smoke seed fixture must reference smoke-hero.txt.')
}

if (seedFixture.trustedPluginStatus?.status !== 'loaded') {
  throw new Error('Smoke seed fixture must include a loaded trusted plugin status.')
}

if (
  seedFixture.webhook?.event !== 'entry.published' ||
  seedFixture.webhook.destination !== 'https://frontend.example.test/api/revalidate' ||
  seedFixture.webhook.dryRun !== true
) {
  throw new Error('Smoke seed fixture must include a dry-run revalidation webhook.')
}

if (
  appliedSeed.tenantSlug !== seedFixture.tenant.slug ||
  appliedSeed.collectionSlug !== seedFixture.collection.slug ||
  appliedSeed.entrySlug !== seedFixture.entry.slug ||
  appliedSeed.webhookEvent !== seedFixture.webhook.event
) {
  throw new Error('Applied smoke seed must match the smoke tenant, collection, entry, and webhook fixture.')
}

const publicReadPath = `/api/tenants/${requiredEnv.EDGE_CMS_TENANT}/api/public/${requiredEnv.EDGE_CMS_COLLECTION}/${seedFixture.entry.slug}`

// --- Generated-process smoke verification ---
async function waitForEndpoint(url: string, timeoutMs = 8000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok) return true
    } catch {
      // Retry until ready
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  return false
}

const childrenToCleanup: ChildProcess[] = []

async function cleanupChildren() {
  for (const child of childrenToCleanup) {
    if (child && !child.killed) {
      try {
        child.kill('SIGTERM')
      } catch {
        // Ignored
      }
    }
  }
}

try {
  const apiUrl = process.env.EDGE_CMS_URL || requiredEnv.EDGE_CMS_URL
  const adminUrl = process.env.EDGE_CMS_ADMIN_URL || requiredEnv.EDGE_CMS_ADMIN_URL
  const apiPort = new URL(apiUrl).port || '8787'
  const adminPort = new URL(adminUrl).port || '5173'

  // Probe if API is already running; if not, spawn it
  let apiRunning = false
  try {
    const probe = await fetch(`${apiUrl}/health`)
    if (probe.ok) apiRunning = true
  } catch {
    apiRunning = false
  }

  if (!apiRunning) {
    const apiProc = spawn(process.execPath, [resolve('apps/api/src/index.ts')], {
      env: { ...process.env, PORT: apiPort, EDGE_CMS_PORT: apiPort },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    childrenToCleanup.push(apiProc)
  }

  // Probe if Admin is already running; if not, spawn it
  let adminRunning = false
  try {
    const probe = await fetch(`${adminUrl}/health`)
    if (probe.ok) adminRunning = true
  } catch {
    adminRunning = false
  }

  if (!adminRunning) {
    const adminProc = spawn(process.execPath, [resolve('apps/admin/src/index.ts')], {
      env: { ...process.env, PORT: adminPort, ADMIN_PORT: adminPort, EDGE_CMS_URL: apiUrl },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    childrenToCleanup.push(adminProc)
  }

  const apiReady = await waitForEndpoint(`${apiUrl}/health`, 8000)
  if (!apiReady) {
    throw new Error(`Starter API failed to become ready at ${apiUrl}/health within 8 seconds.`)
  }

  const adminReady = await waitForEndpoint(`${adminUrl}/health`, 8000)
  if (!adminReady) {
    throw new Error(`Starter Admin failed to become ready at ${adminUrl}/health within 8 seconds.`)
  }

  // 1. Verify API Health response
  const apiHealthRes = await fetch(`${apiUrl}/health`)
  if (!apiHealthRes.ok) {
    throw new Error(`Starter API health responded with HTTP ${apiHealthRes.status}`)
  }
  const apiHealthJson = (await apiHealthRes.json()) as { status?: string; name?: string }
  if (apiHealthJson.status !== 'ok') {
    throw new Error(`Unexpected API health status: ${JSON.stringify(apiHealthJson)}`)
  }

  // 2. Verify API Public Read CMS JSON
  const publicRes = await fetch(`${apiUrl}${publicReadPath}`)
  if (!publicRes.ok) {
    throw new Error(`Starter API public read returned HTTP ${publicRes.status} for ${publicReadPath}`)
  }
  const publicJson = (await publicRes.json()) as {
    success?: boolean
    data?: { slug?: string; title?: string }
  }
  if (!publicJson.success || publicJson.data?.slug !== seedFixture.entry.slug) {
    throw new Error(
      `Unexpected public read CMS response: received ${JSON.stringify(publicJson)}, expected entry ${seedFixture.entry.slug}`,
    )
  }

  // 3. Verify Admin UI HTML
  const adminRes = await fetch(adminUrl)
  if (!adminRes.ok) {
    throw new Error(`Starter Admin root returned HTTP ${adminRes.status}`)
  }
  const adminHtml = await adminRes.text()
  if (!adminHtml.includes('EdgeCMS Starter Admin')) {
    throw new Error('Starter Admin UI did not render EdgeCMS Starter Admin title.')
  }

  console.log('Starter smoke passed.')
  console.log(`Public read proof path: ${apiUrl}${publicReadPath}`)
} finally {
  await cleanupChildren()
}
