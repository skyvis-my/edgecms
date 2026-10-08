import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

export type SeedOptions = {
  env?: 'local' | 'staging' | 'production'
  remote: boolean
  allowProduction: boolean
  email: string
  password: string
  tenantSlug: string
  tenantName: string
  collectionSlug: string
  collectionName: string
}

const apiDir = new URL('../apps/api', import.meta.url).pathname
const betterAuthCryptoUrl = new URL(
  '../apps/api/node_modules/better-auth/dist/crypto/index.mjs',
  import.meta.url
).href

function getArg(args: string[], name: string) {
  const inline = args.find((arg) => arg.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)

  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

export function parseSeedOptions(
  args: string[],
  env: Record<string, string | undefined> = process.env
): SeedOptions {
  const targetEnv = (getArg(args, '--env') ?? env.SEED_ENV ?? 'local') as SeedOptions['env']
  if (!['local', 'staging', 'production'].includes(targetEnv)) {
    throw new Error(`Unsupported seed env: ${targetEnv}`)
  }

  return {
    env: targetEnv,
    remote: args.includes('--remote') || targetEnv !== 'local',
    allowProduction: args.includes('--allow-production'),
    email: getArg(args, '--email') ?? env.E2E_ADMIN_EMAIL ?? 'smoke.admin@example.com',
    password: getArg(args, '--password') ?? env.E2E_ADMIN_PASSWORD ?? 'SmokePassw0rd!',
    tenantSlug: getArg(args, '--tenant-slug') ?? env.E2E_TENANT_SLUG ?? 'smoke',
    tenantName: getArg(args, '--tenant-name') ?? env.E2E_TENANT_NAME ?? 'Smoke Tenant',
    collectionSlug: getArg(args, '--collection-slug') ?? env.E2E_COLLECTION_SLUG ?? 'smoke-posts',
    collectionName: getArg(args, '--collection-name') ?? env.E2E_COLLECTION_NAME ?? 'Smoke Posts',
  }
}

function sqlString(value: string) {
  return `'${value.replaceAll("'", "''")}'`
}

function sqlJson(value: unknown) {
  return sqlString(JSON.stringify(value))
}

export function buildSeedSql(options: SeedOptions, passwordHash: string, now = new Date()) {
  const nowIso = now.toISOString()
  const nowMs = now.getTime()
  const userId = 'smoke-user'
  const accountId = 'smoke-account-credential'
  const tenantId = 'smoke-tenant'
  const collectionId = 'smoke-collection-posts'
  const mediaAllowedMimeTypes = ['image/*', 'text/plain', 'application/pdf']
  const collectionFields = [
    {
      name: 'title',
      type: 'text',
      required: true,
      localizable: false,
    },
  ]

  return `
INSERT INTO "user" ("id", "name", "email", "role", "emailVerified", "image", "createdAt", "updatedAt")
VALUES (${sqlString(userId)}, 'Smoke Admin', ${sqlString(options.email)}, 'admin', 1, NULL, ${nowMs}, ${nowMs})
ON CONFLICT("id") DO UPDATE SET
  "name" = excluded."name",
  "email" = excluded."email",
  "role" = excluded."role",
  "emailVerified" = excluded."emailVerified",
  "updatedAt" = excluded."updatedAt";

INSERT INTO "account" ("id", "accountId", "providerId", "userId", "accessToken", "refreshToken", "idToken", "accessTokenExpiresAt", "refreshTokenExpiresAt", "scope", "password", "createdAt", "updatedAt")
VALUES (${sqlString(accountId)}, ${sqlString(userId)}, 'credential', ${sqlString(userId)}, NULL, NULL, NULL, NULL, NULL, NULL, ${sqlString(passwordHash)}, ${nowMs}, ${nowMs})
ON CONFLICT("id") DO UPDATE SET
  "password" = excluded."password",
  "updatedAt" = excluded."updatedAt";

INSERT INTO "tenants" ("id", "slug", "name", "status", "localeCatalog", "targetUrl", "corsOrigin", "mediaUploadMaxBytes", "mediaUploadMaxDimension", "mediaAllowedMimeTypes", "createdAt", "updatedAt")
VALUES (${sqlString(tenantId)}, ${sqlString(options.tenantSlug)}, ${sqlString(options.tenantName)}, 'active', ${sqlJson(['en'])}, NULL, NULL, 5242880, 2048, ${sqlJson(mediaAllowedMimeTypes)}, ${sqlString(nowIso)}, ${sqlString(nowIso)})
ON CONFLICT("slug") DO UPDATE SET
  "name" = excluded."name",
  "status" = excluded."status",
  "localeCatalog" = excluded."localeCatalog",
  "mediaUploadMaxBytes" = excluded."mediaUploadMaxBytes",
  "mediaUploadMaxDimension" = excluded."mediaUploadMaxDimension",
  "mediaAllowedMimeTypes" = excluded."mediaAllowedMimeTypes",
  "updatedAt" = excluded."updatedAt";

INSERT INTO "tenant_users" ("tenantId", "userId", "role", "createdAt")
VALUES (${sqlString(tenantId)}, ${sqlString(userId)}, 'owner', ${sqlString(nowIso)})
ON CONFLICT("tenantId", "userId") DO UPDATE SET
  "role" = excluded."role";

INSERT INTO "collections" ("id", "tenantId", "name", "slug", "singleton", "fields", "defaultLocale", "supportedLocales", "createdAt", "updatedAt", "displayName", "description", "icon", "color", "listFields", "searchFields", "defaultSort", "defaultSortOrder")
VALUES (${sqlString(collectionId)}, ${sqlString(tenantId)}, ${sqlString(options.collectionName)}, ${sqlString(options.collectionSlug)}, 0, ${sqlJson(collectionFields)}, 'en', ${sqlJson(['en'])}, ${sqlString(nowIso)}, ${sqlString(nowIso)}, ${sqlString(options.collectionName)}, 'Seeded collection for live smoke verification', 'file-text', '#2563eb', ${sqlJson(['title'])}, ${sqlJson(['title'])}, 'updatedAt', 'desc')
ON CONFLICT("tenantId", "slug") DO UPDATE SET
  "name" = excluded."name",
  "fields" = excluded."fields",
  "updatedAt" = excluded."updatedAt",
  "displayName" = excluded."displayName",
  "description" = excluded."description",
  "listFields" = excluded."listFields",
  "searchFields" = excluded."searchFields";
`.trim()
}

async function runWranglerSeed(options: SeedOptions, sql: string) {
  if (options.env === 'production' && !options.allowProduction) {
    throw new Error('Production smoke seed requires --allow-production')
  }

  const dir = await Bun.$`mktemp -d`.text()
  const tempDir = dir.trim()
  const file = join(tempDir, 'edgecms-smoke-seed.sql')

  try {
    await mkdir(tempDir, { recursive: true })
    await Bun.write(file, sql)

    const cmd = [
      'bunx',
      'wrangler',
      'd1',
      'execute',
      'DB',
      ...(options.env !== 'local' ? ['--env', options.env] : []),
      options.remote ? '--remote' : '--local',
      '--file',
      file,
    ]

    const proc = Bun.spawn(cmd, {
      cwd: apiDir,
      stdout: 'inherit',
      stderr: 'inherit',
    })
    const exitCode = await proc.exited
    if (exitCode !== 0) throw new Error(`wrangler d1 execute failed with exit code ${exitCode}`)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function hashSeedPassword(password: string) {
  const cryptoModule = (await import(betterAuthCryptoUrl)) as {
    hashPassword: (value: string) => Promise<string>
  }
  return cryptoModule.hashPassword(password)
}

export async function main(args = Bun.argv.slice(2)) {
  const options = parseSeedOptions(args)
  const passwordHash = await hashSeedPassword(options.password)
  const sql = buildSeedSql(options, passwordHash)

  await runWranglerSeed(options, sql)

  console.log('Smoke seed applied.')
  console.log(`E2E_ADMIN_EMAIL=${options.email}`)
  console.log('E2E_ADMIN_PASSWORD=<seed password>')
  console.log(`E2E_TENANT_SLUG=${options.tenantSlug}`)
  console.log(`E2E_COLLECTION_SLUG=${options.collectionSlug}`)
  console.log(
    `Run: E2E_ADMIN_EMAIL=${options.email} E2E_ADMIN_PASSWORD=<seed password> E2E_TENANT_SLUG=${options.tenantSlug} E2E_COLLECTION_SLUG=${options.collectionSlug} bun run smoke:e2e:${options.env === 'production' ? 'production' : 'staging'} -- --live-persisted`
  )
}

if (import.meta.main) {
  await main()
}
