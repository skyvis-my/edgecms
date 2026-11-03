/**
 * Bun.serve entry for Docker / Kubernetes / bare-metal OSS hosting.
 *
 * Usage (from apps/api):
 *   bun --config bunfig.hosting.toml run src/hosting/server.ts
 *
 * Workers path (`src/main.ts` + wrangler) is unchanged.
 */
import { loadHostingConfig } from './config'
import { createHostingBindings } from './create-bindings'
import { setHostingEnv } from './env-store'

async function main() {
  const config = loadHostingConfig(process.cwd())
  const bindings = await createHostingBindings(config)

  // Import app only after the cloudflare:workers shim env is populated.
  const { createApp, createD1UsageRollupSink, warmPublicCacheInBackground } = await import('@/app')
  const { ensureWorkerBootstrapped } = await import('@/runtime/bootstrap')

  const app = createApp({
    host: {
      usageSink: createD1UsageRollupSink({
        db: () => bindings.env.DB,
      }),
    },
  })

  await ensureWorkerBootstrapped(bindings.env)

  const server = Bun.serve({
    port: config.port,
    hostname: config.hostname,
    async fetch(request) {
      setHostingEnv(bindings.env)
      await ensureWorkerBootstrapped(bindings.env)
      warmPublicCacheInBackground(bindings.env)

      const url = new URL(request.url)
      // Non-API routes → admin SPA (ASSETS), mirroring wrangler run_worker_first.
      if (!url.pathname.startsWith('/api')) {
        return bindings.env.ASSETS.fetch(request)
      }
      // Env is provided via the cloudflare:workers shim (setHostingEnv).
      return app.fetch(request)
    },
  })

  console.log(
    JSON.stringify({
      type: 'hosting_listen',
      runtime: 'bun',
      url: `http://${config.hostname}:${server.port}`,
      databaseDriver: config.database.driver,
      mediaDriver: config.media.driver,
      cacheDriver: config.cache.driver,
      cacheL1Enabled: config.cache.l1Enabled,
      cacheWriteMode: config.cache.writeMode,
      appliedMigrations: bindings.appliedMigrations.length,
    })
  )

  const shutdown = async () => {
    server.stop(true)
    await bindings.close()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
