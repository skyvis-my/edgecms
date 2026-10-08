import { afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { treaty } from '@elysiajs/eden'
import type { App } from '../../dist/index.d.ts'

const packageRoot = join(import.meta.dir, '..', '..')
const tempDirs: string[] = []

beforeAll(() => {
  const distDts = join(packageRoot, 'dist', 'index.d.ts')
  const distJs = join(packageRoot, 'dist', 'index.js')
  if (!existsSync(distDts) || !existsSync(distJs)) {
    spawnSync('bun', [join(packageRoot, 'scripts', 'build.mjs')], {
      cwd: packageRoot,
      stdio: 'inherit',
    })
  }
})

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'edgecms-consumer-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('F08 — Packed consumer runtime qualification', () => {
  it('serves valid HTTP requests through packaged createApp entrypoint', async () => {
    // Import from built dist
    const runtime = await import('../../dist/index.js')
    expect(typeof runtime.createApp).toBe('function')
    expect(typeof runtime.bootstrapApp).toBe('function')

    const app = runtime.createApp()
    const response = await app.handle(new Request('http://localhost/api/health'))
    expect(response.status).toBe(200)

    const payload = (await response.json()) as { version?: string; status?: string }
    expect(payload.version).toBe('0.1.0')
    expect(typeof payload.status).toBe('string')
  })

  it('rejects invalid requests with canonical EdgeCMS error envelope', async () => {
    const runtime = await import('../../dist/index.js')
    const app = runtime.createApp()

    // Send unsupported content type to an API endpoint
    const response = await app.handle(
      new Request('http://localhost/api/health', {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: 'invalid-content',
      }),
    )

    expect(response.status).toBe(415)
    const errorBody = (await response.json()) as {
      success: boolean
      error: { code: string; message: string }
    }
    expect(errorBody.success).toBe(false)
    expect(errorBody.error.code).toBe('UNSUPPORTED_MEDIA_TYPE')
  })

  it('preserves Eden Treaty route type contract with compile-time checks', async () => {
    // Contract verification: treaty<App> can be initialized and has typed endpoints
    const client = treaty<App>('http://localhost:8787')
    expect(typeof client.api.health.get).toBe('function')
    expect(typeof client.api.admin.collections.get).toBe('function')
  })

  it('typechecks a consumer project importing from @edgecms/runtime outside the monorepo', () => {
    const consumerDir = makeTempDir()
    const packageRoot = join(import.meta.dir, '..', '..')

    // Write consumer package.json
    writeFileSync(
      join(consumerDir, 'package.json'),
      JSON.stringify(
        {
          name: 'external-consumer',
          type: 'module',
          dependencies: {
            '@edgecms/runtime': `file:${packageRoot}`,
            elysia: '1.4.29',
          },
        },
        null,
        2,
      ),
    )

    // Write consumer tsconfig.json
    writeFileSync(
      join(consumerDir, 'tsconfig.json'),
      JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'Bundler',
            strict: true,
            skipLibCheck: true,
            noEmit: true,
            typeRoots: [join(packageRoot, '..', '..', 'apps', 'api', 'node_modules')],
            types: ['@cloudflare/workers-types'],
            paths: {
              '@edgecms/runtime': [join(packageRoot, 'dist', 'index.d.ts')],
              'edgecms-api/app': [join(packageRoot, '..', '..', 'apps', 'api', 'src', 'app.ts')],
              'edgecms-api/env': [join(packageRoot, '..', '..', 'apps', 'api', 'src', 'env.ts')],
              'edgecms-api/runtime/bootstrap': [
                join(packageRoot, '..', '..', 'apps', 'api', 'src', 'runtime', 'bootstrap.ts'),
              ],
              'edgecms-api/plugins/plugin-loader': [
                join(packageRoot, '..', '..', 'apps', 'api', 'src', 'plugins', 'plugin-loader.ts'),
              ],
              'edgecms-api/plugins/plugin-registry': [
                join(packageRoot, '..', '..', 'apps', 'api', 'src', 'plugins', 'plugin-registry.ts'),
              ],
              'edgecms-api/observability/metrics': [
                join(packageRoot, '..', '..', 'apps', 'api', 'src', 'observability/metrics.ts'),
              ],
              'edgecms-api': [join(packageRoot, '..', '..', 'apps', 'api', 'src', 'main.ts')],
              '@edgecms/plugin-sdk': [join(packageRoot, '..', 'plugin-sdk', 'src', 'index.ts')],
              '@edgecms/schemas': [join(packageRoot, '..', 'schemas', 'src', 'index.ts')],
              '@edgecms/schemas/*': [join(packageRoot, '..', 'schemas', 'src', '*')],
              '@/*': [join(packageRoot, '..', '..', 'apps', 'api', 'src', '*')],
            },
          },
          include: ['consumer.ts'],
        },
        null,
        2,
      ),
    )

    // Write consumer worker file that imports from @edgecms/runtime
    writeFileSync(
      join(consumerDir, 'consumer.ts'),
      `
import { createApp, bootstrapApp } from '@edgecms/runtime'
import type { App, Env } from '@edgecms/runtime'

const app = createApp()

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    await bootstrapApp({ env })
    return app.handle(request)
  }
}
`,
    )

    // Typecheck consumer project using bunx tsc
    const result = spawnSync('bunx', ['tsc', '-p', join(consumerDir, 'tsconfig.json')], {
      cwd: consumerDir,
      encoding: 'utf8',
      env: { ...process.env },
    })

    expect(result.status, `tsc failed:\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`).toBe(0)
  })
})
