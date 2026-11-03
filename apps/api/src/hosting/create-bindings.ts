import type { Env } from '@/env'
import type { HostingConfig } from './config'
import { createMemoryKv } from './bindings/memory-kv'
import { connectRedisUrl, createRedisKv } from './bindings/redis-kv'
import { createFilesystemR2 } from './bindings/filesystem-r2'
import { createS3R2 } from './bindings/s3-r2'
import { createSqliteFileD1 } from './bindings/sqlite-d1'
import { createPostgresD1, type PostgresD1Handle } from './bindings/postgres-d1'
import { createMemoryWebhookQueue } from './bindings/memory-queue'
import { createInProcessPublishScheduler } from './bindings/in-process-scheduler'
import { createStaticAssetsFetcher } from './bindings/static-assets'
import { setHostingEnv } from './env-store'

export type HostingBindings = {
  env: Env
  close: () => Promise<void>
  appliedMigrations: string[]
}

/**
 * Build a Worker-shaped Env from OSS hosting config and install it into the shim store.
 */
export async function createHostingBindings(config: HostingConfig): Promise<HostingBindings> {
  let postgres: PostgresD1Handle | undefined
  let appliedMigrations: string[] = []
  let db: D1Database

  if (config.database.driver === 'postgres') {
    postgres = await createPostgresD1({
      databaseUrl: config.database.databaseUrl!,
      migrationsDir: config.database.migrationsDir,
    })
    db = postgres.d1
    appliedMigrations = postgres.appliedMigrations
  } else {
    const sqlite = createSqliteFileD1({
      path: config.database.sqlitePath,
      migrationsDir: config.database.migrationsDir,
    })
    db = sqlite.d1
    appliedMigrations = sqlite.appliedMigrations
  }

  let cache: KVNamespace
  let redisClose: (() => void) | undefined
  if (config.cache.driver === 'redis') {
    if (!config.cache.redisUrl) {
      throw new Error('REDIS_URL is required when CACHE_DRIVER=redis')
    }
    const client = await connectRedisUrl(config.cache.redisUrl)
    redisClose = () => client.close()
    cache = createRedisKv(client)
  } else {
    cache = createMemoryKv()
  }

  let media: R2Bucket
  if (config.media.driver === 's3') {
    if (!config.media.accessKeyId || !config.media.secretAccessKey) {
      throw new Error('S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required when MEDIA_DRIVER=s3')
    }
    media = createS3R2({
      endpoint: config.media.endpoint,
      region: config.media.region,
      bucket: config.media.bucket!,
      accessKeyId: config.media.accessKeyId,
      secretAccessKey: config.media.secretAccessKey,
      forcePathStyle: config.media.forcePathStyle,
    })
  } else {
    media = createFilesystemR2(config.media.dataDir)
  }

  const envHolder: { current: Env } = { current: {} as Env }
  const getEnv = () => envHolder.current

  const queue = createMemoryWebhookQueue(getEnv)
  const scheduler = createInProcessPublishScheduler(getEnv)
  const assets = createStaticAssetsFetcher(config.adminDistDir)

  const env = {
    DB: db,
    CACHE: cache,
    MEDIA: media,
    ASSETS: assets,
    PUBLISH_SCHEDULER: scheduler,
    WEBHOOK_QUEUE: queue,
    BETTER_AUTH_SECRET: config.secrets.betterAuthSecret,
    JWT_HS256_SECRET: config.secrets.jwtHs256Secret,
    BASE_URL: config.baseUrl,
    SIGNUP_POLICY: config.featureFlags.signupPolicy,
    SUPER_ADMIN_EMAILS: config.featureFlags.superAdminEmails,
    SUPER_ADMIN_REQUIRE_MFA: config.featureFlags.superAdminRequireMfa ? 'true' : 'false',
    ENABLE_PROMOTE_CACHE_WARMING: config.featureFlags.enablePromoteCacheWarming ? 'true' : 'false',
    ENABLE_PUBLIC_CACHE_WARMING: config.featureFlags.enablePublicCacheWarming ? 'true' : 'false',
    ENABLE_RELEASE_SEMANTIC: config.featureFlags.enableReleaseSemantic ? 'true' : 'false',
    MEDIA_PUBLIC_BASE_URL: config.media.publicBaseUrl,
    CDN_BASE_URL: config.media.cdnBaseUrl ?? config.media.publicBaseUrl,
    CDN_PUBLIC_BASE_URL: config.media.cdnBaseUrl,
    EDGECMS_DEPLOY_ID: process.env.EDGECMS_DEPLOY_ID ?? 'oss-hosting',
    ...config.passthrough,
  } as Env

  envHolder.current = env
  setHostingEnv(env)

  return {
    env,
    appliedMigrations,
    close: async () => {
      redisClose?.()
      if (postgres) await postgres.close()
    },
  }
}
