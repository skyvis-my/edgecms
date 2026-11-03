/**
 * Bundle the OSS hosting server with a `cloudflare:workers` → shim resolve plugin.
 * Bun cannot alias that protocol at runtime; Docker/K8s run the built artifact.
 *
 *   bun scripts/build-hosting.ts
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '..')
const outdir = join(root, 'dist-hosting')
mkdirSync(outdir, { recursive: true })

const shimPath = join(root, 'src/hosting/shims/cloudflare-workers.ts')

const result = await Bun.build({
  entrypoints: [
    join(root, 'src/hosting/server.ts'),
    join(root, 'src/hosting/migrate.ts'),
  ],
  outdir,
  target: 'bun',
  sourcemap: 'external',
  plugins: [
    {
      name: 'cloudflare-workers-shim',
      setup(build) {
        build.onResolve({ filter: /^cloudflare:workers$/ }, () => ({
          path: shimPath,
        }))
      },
    },
  ],
})

if (!result.success) {
  console.error(result.logs)
  process.exit(1)
}

console.log(
  JSON.stringify({
    type: 'hosting_build',
    outdir,
    outputs: result.outputs.map((o) => o.path),
  })
)
