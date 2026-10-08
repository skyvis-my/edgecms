import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'bun:test'
import {
  copyTemplate,
  getTemplateDir,
  parseArgs,
  runCreateApp,
  validateStarterEnvExample,
} from './index'

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'edgecms-create-app-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('create-edgecms-app', () => {
  it('prints help output', () => {
    expect(runCreateApp(['--help'])).toContain('create-edgecms-app <target-dir>')
  })

  it('parses the starter template and force flags', () => {
    expect(parseArgs(['demo', '--template', 'starter', '--force'])).toEqual({
      force: true,
      help: false,
      targetDir: 'demo',
      template: 'starter',
    })
  })

  it('generates a starter app into a temp dir', () => {
    const cwd = makeTempDir()
    const message = runCreateApp(['demo'], cwd)
    const packageJson = JSON.parse(readFileSync(join(cwd, 'demo', 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }

    expect(message).toContain('Created EdgeCMS starter app')
    expect(packageJson.scripts.validate).toBe('bun run typecheck && bun run smoke')
    expect(packageJson.scripts['seed:smoke']).toBe('bun scripts/seed.ts')
    expect(readFileSync(join(cwd, 'demo', '.env.example'), 'utf8')).toContain('EDGE_CMS_URL')
    expect(readFileSync(join(cwd, 'demo', 'apps', 'api', 'src', 'index.ts'), 'utf8')).toContain(
      'createEdgeCmsApi',
    )
  })

  it('keeps generated starter preflight and validation commands copy-paste safe', () => {
    const cwd = makeTempDir()

    runCreateApp(['demo'], cwd)

    const targetDir = join(cwd, 'demo')
    const envExample = readFileSync(join(targetDir, '.env.example'), 'utf8')
    const packageJson = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }

    expect(envExample).toContain('EDGE_CMS_URL=http://localhost:8787')
    expect(envExample).toContain('EDGE_CMS_ADMIN_URL=http://localhost:5173')
    expect(envExample).toContain('EDGE_CMS_TENANT=smoke')
    expect(envExample).toContain('EDGE_CMS_COLLECTION=smoke-posts')
    expect(packageJson.scripts.validate).toBe('bun run typecheck && bun run smoke')
    expect(packageJson.scripts.typecheck).toContain('typecheck')
    expect(readFileSync(join(targetDir, 'scripts', 'smoke.ts'), 'utf8')).toContain(
      'Starter smoke passed.'
    )
  })

  it('resolves the source starter template before package bundling', () => {
    expect(readFileSync(join(getTemplateDir('starter'), 'package.json'), 'utf8')).toContain(
      '"name": "edgecms-starter"',
    )
  })

  it('generates copy-safe smoke fixture data for first-run seeding', () => {
    const cwd = makeTempDir()

    runCreateApp(['demo'], cwd)

    const envExample = readFileSync(join(cwd, 'demo', '.env.example'), 'utf8')
    for (const key of ['EDGE_CMS_URL', 'EDGE_CMS_ADMIN_URL', 'EDGE_CMS_TENANT', 'EDGE_CMS_COLLECTION']) {
      expect(envExample).toContain(`${key}=`)
    }

    const seedFixture = JSON.parse(
      readFileSync(join(cwd, 'demo', 'fixtures', 'smoke-seed.json'), 'utf8'),
    ) as {
      tenant?: { slug?: string }
      collection?: { slug?: string }
      entry?: { slug?: string; status?: string }
      media?: { filename?: string }
      trustedPluginStatus?: { pluginId?: string; status?: string }
      webhook?: { event?: string; destination?: string; dryRun?: boolean }
    }

    expect(seedFixture.tenant?.slug).toBe('smoke')
    expect(seedFixture.collection?.slug).toBe('smoke-posts')
    expect(seedFixture.entry?.slug).toBe('hello-edgecms')
    expect(seedFixture.entry?.status).toBe('published')
    expect(seedFixture.media?.filename).toBe('smoke-hero.txt')
    expect(seedFixture.trustedPluginStatus?.status).toBe('loaded')
    expect(seedFixture.webhook).toMatchObject({
      event: 'entry.published',
      destination: 'https://frontend.example.test/api/revalidate',
      dryRun: true,
    })
  })

  it('fails env preflight before starter smoke when required adoption config is missing', () => {
    expect(() =>
      validateStarterEnvExample(`
EDGE_CMS_URL=http://localhost:8787
EDGE_CMS_ADMIN_URL=http://localhost:5173
EDGE_CMS_COLLECTION=smoke-posts
`),
    ).toThrow('missing EDGE_CMS_TENANT')

    expect(() =>
      validateStarterEnvExample(`
EDGE_CMS_URL=http://localhost:8787
EDGE_CMS_ADMIN_URL=http://localhost:5173
EDGE_CMS_TENANT=
EDGE_CMS_COLLECTION=smoke-posts
`),
    ).toThrow('EDGE_CMS_TENANT is empty')
  })

  it('refuses an existing non-empty target dir unless forced', () => {
    const cwd = makeTempDir()
    mkdirSync(join(cwd, 'demo'))
    writeFileSync(join(cwd, 'demo', 'keep.txt'), 'user content')

    expect(() => runCreateApp(['demo'], cwd)).toThrow('Target directory exists and is not empty')
    expect(() => runCreateApp(['demo', '--force'], cwd)).not.toThrow()
    expect(readFileSync(join(cwd, 'demo', 'keep.txt'), 'utf8')).toBe('user content')
  })

  it('keeps README commands aligned with package scripts', () => {
    const cwd = makeTempDir()
    const targetDir = join(cwd, 'demo')

    copyTemplate(getTemplateDir('starter'), targetDir)

    const packageJson = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    const readme = readFileSync(join(targetDir, 'README.md'), 'utf8')

    for (const scriptName of ['dev', 'dev:api', 'dev:admin', 'seed:smoke', 'smoke', 'validate']) {
      expect(readme).toContain(`bun run ${scriptName}`)
      expect(packageJson.scripts[scriptName]).toBeString()
    }
  })

  it('documents starter smoke failure fixes and public read proof path', () => {
    const cwd = makeTempDir()
    const targetDir = join(cwd, 'demo')

    copyTemplate(getTemplateDir('starter'), targetDir)

    const readme = readFileSync(join(targetDir, 'README.md'), 'utf8')
    const smokeScript = readFileSync(join(targetDir, 'scripts', 'smoke.ts'), 'utf8')

    expect(readme).toContain('## Failure Guide')
    expect(readme).toContain(
      'http://localhost:8787/api/tenants/smoke/api/public/smoke-posts/hello-edgecms',
    )
    expect(smokeScript).toContain('Unexpected ${key} starter value')
    expect(smokeScript).toContain('Public read proof path:')
  })

  it('runs generated starter smoke script', () => {
    const cwd = makeTempDir()
    const targetDir = join(cwd, 'demo')

    runCreateApp(['demo'], cwd)

    const seedResult = spawnSync(process.execPath, ['scripts/seed.ts', '--reset'], {
      cwd: targetDir,
      encoding: 'utf8',
    })
    expect(seedResult.status).toBe(0)
    expect(seedResult.stdout).toContain('Smoke seed reset and applied.')

    const result = spawnSync(process.execPath, ['scripts/smoke.ts'], {
      cwd: targetDir,
      encoding: 'utf8',
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Starter smoke passed.')
    expect(result.stdout).toContain(
      'http://localhost:8787/api/tenants/smoke/api/public/smoke-posts/hello-edgecms',
    )
  })

  it('starts generated starter API and admin processes and verifies real CMS JSON and admin UI responses', async () => {
    const cwd = makeTempDir()
    const targetDir = join(cwd, 'demo')

    runCreateApp(['demo'], cwd)

    const seedResult = spawnSync(process.execPath, ['scripts/seed.ts', '--reset'], {
      cwd: targetDir,
      encoding: 'utf8',
    })
    expect(seedResult.status).toBe(0)

    const apiModule = await import(join(targetDir, 'apps', 'api', 'src', 'index.ts'))
    expect(typeof apiModule.createEdgeCmsApi).toBe('function')
    expect(typeof apiModule.default?.fetch).toBe('function')

    const api = apiModule.createEdgeCmsApi()
    const healthRes = await api.fetch(new Request('http://localhost:8787/health'))
    expect(healthRes.status).toBe(200)
    const healthJson = (await healthRes.json()) as { status: string; name: string }
    expect(healthJson.status).toBe('ok')
    expect(healthJson.name).toBe('edgecms-starter-api')

    const publicRes = await api.fetch(
      new Request('http://localhost:8787/api/tenants/smoke/api/public/smoke-posts/hello-edgecms'),
    )
    expect(publicRes.status).toBe(200)
    const publicJson = (await publicRes.json()) as {
      success: boolean
      data: { slug: string; title: string }
    }
    expect(publicJson.success).toBe(true)
    expect(publicJson.data.slug).toBe('hello-edgecms')
    expect(publicJson.data.title).toBe('Hello EdgeCMS')

    const adminModule = await import(join(targetDir, 'apps', 'admin', 'src', 'index.ts'))
    expect(typeof adminModule.getAdminBootMessage).toBe('function')
    expect(typeof adminModule.default?.fetch).toBe('function')

    const adminRes = await adminModule.default.fetch(new Request('http://localhost:5173/'))
    expect(adminRes.status).toBe(200)
    const adminHtml = await adminRes.text()
    expect(adminHtml).toContain('EdgeCMS Starter Admin')
    expect(adminHtml).toContain('Running')
  })

  it('resets generated starter smoke seed artifact in one command', () => {
    const cwd = makeTempDir()
    const targetDir = join(cwd, 'demo')

    runCreateApp(['demo'], cwd)
    mkdirSync(join(targetDir, '.edgecms'), { recursive: true })
    writeFileSync(join(targetDir, '.edgecms', 'stale.txt'), 'stale', { flag: 'w' })

    const result = spawnSync(process.execPath, ['scripts/seed.ts', '--reset'], {
      cwd: targetDir,
      encoding: 'utf8',
    })
    const appliedSeed = JSON.parse(
      readFileSync(join(targetDir, '.edgecms', 'smoke-seed-applied.json'), 'utf8'),
    ) as { tenantSlug?: string; collectionSlug?: string; entrySlug?: string; webhookEvent?: string }

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Smoke seed reset and applied.')
    expect(appliedSeed).toMatchObject({
      tenantSlug: 'smoke',
      collectionSlug: 'smoke-posts',
      entrySlug: 'hello-edgecms',
      webhookEvent: 'entry.published',
    })
  })

function sanitizeDiagnosticsOutput(text: string): string {
  if (!text) return ''
  let sanitized = text

  // Redact URL credentials like https://user:pass@example.com
  sanitized = sanitized.replace(/(https?:\/\/[^/:]+:)[^/@]+(@)/g, '$1[REDACTED]$2')

  // Redact Bearer tokens
  sanitized = sanitized.replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+/gi, '$1[REDACTED]')

  // Redact potential env secrets matching sensitive env vars
  for (const [key, val] of Object.entries(process.env)) {
    if (!val || typeof val !== 'string' || val.length < 6) continue
    if (/(?:KEY|TOKEN|SECRET|PASSWORD|AUTH|CREDENTIAL|PRIVATE)/i.test(key)) {
      if (!['true', 'false', 'development', 'production', 'test'].includes(val.toLowerCase())) {
        sanitized = sanitized.replaceAll(val, '[REDACTED]')
      }
    }
  }

  // Redact standard secret-like assignments (e.g. secret=..., token=...)
  sanitized = sanitized.replace(
    /(['"]?(?:api[_-]?key|secret|token|password|auth[_-]?token)['"]?\s*[:=]\s*['"]?)([^'"\s\n\r]{6,})(['"]?)/gi,
    '$1[REDACTED]$3',
  )

  return sanitized.trim()
}

function formatProcessFailureMessage(params: {
  phase: string
  command: string
  args: string[]
  cwd: string
  status: number | null
  stdout?: string
  stderr?: string
  error?: Error
}): string {
  const sanitizedStdout = sanitizeDiagnosticsOutput(params.stdout ?? '')
  const sanitizedStderr = sanitizeDiagnosticsOutput(params.stderr ?? '')
  const lines = [
    `Starter ${params.phase} failed.`,
    `Command: ${params.command} ${params.args.join(' ')}`,
    `Working Directory: ${params.cwd}`,
    `Exit Status: ${params.status ?? 'null'}`,
  ]
  if (params.error) {
    lines.push(`Spawn Error: ${params.error.message}`)
  }
  lines.push(`Stdout:\n${sanitizedStdout || '(empty)'}`)
  lines.push(`Stderr:\n${sanitizedStderr || '(empty)'}`)
  return lines.join('\n')
}

  it(
    'typechecks generated starter workspaces',
    () => {
    const cwd = makeTempDir()
    const targetDir = join(cwd, 'demo')

    runCreateApp(['demo'], cwd)

    const installArgs = ['install']
    const installResult = spawnSync(process.execPath, installArgs, {
      cwd: targetDir,
      encoding: 'utf8',
    })

    expect(
      installResult.status,
      formatProcessFailureMessage({
        phase: 'install',
        command: process.execPath,
        args: installArgs,
        cwd: targetDir,
        status: installResult.status,
        stdout: installResult.stdout,
        stderr: installResult.stderr,
        error: installResult.error,
      }),
    ).toBe(0)

    const typecheckTargets = [
      { project: 'apps/api/tsconfig.json', label: 'apps/api TypeScript' },
      { project: 'apps/admin/tsconfig.json', label: 'apps/admin TypeScript' },
    ]

    for (const { project, label } of typecheckTargets) {
      const typecheckArgs = ['x', 'tsc', '-p', project]
      const result = spawnSync(process.execPath, typecheckArgs, {
        cwd: targetDir,
        encoding: 'utf8',
      })

      expect(
        result.status,
        formatProcessFailureMessage({
          phase: label,
          command: process.execPath,
          args: typecheckArgs,
          cwd: targetDir,
          status: result.status,
          stdout: result.stdout,
          stderr: result.stderr,
          error: result.error,
        }),
      ).toBe(0)
    }
  }, 30_000)
})
