import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

type SmokeSeed = {
  tenant: { name: string; slug: string }
  collection: { name: string; slug: string; tenantSlug: string }
  entry: { title: string; slug: string; status: 'published'; collectionSlug: string }
  media: { filename: string; contentType: string; alt: string }
  trustedPluginStatus: { pluginId: string; status: 'loaded'; source: 'trusted-sample' }
  webhook: { event: 'entry.published'; destination: string; dryRun: true }
}

const seedPath = 'fixtures/smoke-seed.json'
const seed = JSON.parse(readFileSync(seedPath, 'utf8')) as SmokeSeed
const outputDir = '.edgecms'
const outputPath = `${outputDir}/smoke-seed-applied.json`
const appliedSeed = {
  applied: true,
  tenantSlug: seed.tenant.slug,
  collectionSlug: seed.collection.slug,
  entrySlug: seed.entry.slug,
  mediaFilename: seed.media.filename,
  trustedPluginId: seed.trustedPluginStatus.pluginId,
  webhookEvent: seed.webhook.event,
}

if (process.argv.includes('--reset')) {
  rmSync(outputDir, { recursive: true, force: true })
}

if (seed.tenant.slug !== 'smoke') {
  throw new Error('Smoke seed tenant slug must be "smoke".')
}

if (seed.collection.tenantSlug !== seed.tenant.slug) {
  throw new Error('Smoke seed collection must reference the smoke tenant.')
}

if (seed.entry.collectionSlug !== seed.collection.slug) {
  throw new Error('Smoke seed entry must reference the smoke collection.')
}

if (!existsSync(`fixtures/media/${seed.media.filename}`)) {
  throw new Error(`Smoke seed media fixture is missing: ${seed.media.filename}`)
}

if (seed.trustedPluginStatus.status !== 'loaded') {
  throw new Error('Smoke seed trusted plugin must be loaded.')
}

if (seed.webhook.event !== 'entry.published' || !seed.webhook.dryRun) {
  throw new Error('Smoke seed webhook must be an entry.published dry-run fixture.')
}

mkdirSync(outputDir, { recursive: true })
writeFileSync(
  outputPath,
  `${JSON.stringify(appliedSeed, null, 2)}\n`,
)

console.log(process.argv.includes('--reset') ? 'Smoke seed reset and applied.' : 'Smoke seed applied.')
