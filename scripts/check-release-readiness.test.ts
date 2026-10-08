import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

async function writeFixtureFile(root: string, relativePath: string, contents: string) {
  const target = path.join(root, relativePath)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, contents)
}

async function createFixture(options?: {
  wranglerToml?: string
  stagingWorkflow?: string
  productionWorkflow?: string
  apiVersion?: string
  changelog?: string
  adminVersion?: string
  apiPackageVersion?: string
  schemasVersion?: string
  rootScripts?: Record<string, string>
}) {
  const root = await mkdtemp(path.join(tmpdir(), 'edgecms-release-check-'))
  const version = '0.1.0'

  await writeFixtureFile(
    root,
    'package.json',
    JSON.stringify(
      {
        name: 'edgecms',
        version,
        scripts: options?.rootScripts ?? {
          'perf:public-read:local': 'bun scripts/public-read-performance.ts --mode local',
          'perf:public-read:remote': 'bun scripts/public-read-performance.ts --mode remote',
        },
      },
      null,
      2
    )
  )
  await writeFixtureFile(
    root,
    'apps/admin/package.json',
    JSON.stringify({ name: 'edgecms-admin', version: options?.adminVersion ?? version }, null, 2)
  )
  await writeFixtureFile(
    root,
    'apps/api/package.json',
      JSON.stringify(
      {
        name: 'edgecms-api',
        version: options?.apiPackageVersion ?? version,
        scripts: { 'deploy:production': 'wrangler deploy --env production' },
      },
      null,
      2
    )
  )
  await writeFixtureFile(
    root,
    'packages/schemas/package.json',
    JSON.stringify(
      { name: '@edgecms/schemas', version: options?.schemasVersion ?? version },
      null,
      2
    )
  )
  await writeFixtureFile(
    root,
    'apps/api/src/version.ts',
    `export const API_VERSION = '${options?.apiVersion ?? version}' as const\n`
  )
  await writeFixtureFile(
    root,
    'CHANGELOG.md',
    options?.changelog ??
      ['# Changelog', '', '## [Unreleased]', '', `## [${version}] - 2026-03-12`, ''].join('\n')
  )
  await writeFixtureFile(
    root,
    'apps/api/wrangler.toml',
    options?.wranglerToml ??
      [
        'name = "edgecms-api"',
        '',
        '[env.staging]',
        'name = "edgecms-api-staging"',
        '[[env.staging.d1_databases]]',
        'database_id = "real-staging-db-id"',
        'migrations_dir = "drizzle/migrations"',
        '[[env.staging.kv_namespaces]]',
        'id = "real-staging-kv-id"',
        '',
        '[env.production]',
        'name = "edgecms-api-production"',
        '[[env.production.d1_databases]]',
        'database_id = "real-production-db-id"',
        'migrations_dir = "drizzle/migrations"',
        '[[env.production.kv_namespaces]]',
        'id = "real-production-kv-id"',
        '',
      ].join('\n')
  )
  await writeFixtureFile(
    root,
    '.github/workflows/deploy-staging.yml',
    options?.stagingWorkflow ??
      ['steps:', '  - run: bun install --frozen-lockfile', '  - run: bun run check:release', '  - run: cd apps/api && bun run deploy:staging', ''].join(
        '\n'
      )
  )
  await writeFixtureFile(
    root,
    '.github/workflows/deploy-production.yml',
    options?.productionWorkflow ??
      [
        'steps:',
        '  - run: bun install --frozen-lockfile',
        '  - run: bun run check:release',
        '  - run: cd apps/api && bun run deploy:production',
        '',
      ].join('\n')
  )

  return root
}

const createdRoots: string[] = []

afterEach(async () => {
  await Promise.all(createdRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe('check-release-readiness.sh', () => {
  it('passes when versions align and wrangler placeholders are gone', async () => {
    const fixtureRoot = await createFixture()
    createdRoots.push(fixtureRoot)

    const proc = Bun.spawn(['bash', 'scripts/check-release-readiness.sh', fixtureRoot], {
      cwd: process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const exitCode = await proc.exited

    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: '' })
    expect(stdout).toContain('[PASS] package.json version: 0.1.0')
    expect(stdout).toContain('[PASS] wrangler.toml Cloudflare binding placeholders removed')
    expect(stdout).toContain('[PASS] wrangler.toml defines production environment: production')
    expect(stdout).toContain('[PASS] wrangler.toml env.staging D1 migrations_dir: drizzle/migrations')
    expect(stdout).toContain('[PASS] wrangler.toml env.production D1 migrations_dir: drizzle/migrations')
    expect(stdout).toContain('[PASS] apps/api deploy:production targets env: production')
    expect(stdout).toContain('[PASS] package.json wires local public read perf proof')
    expect(stdout).toContain('[PASS] package.json wires deployed public read perf proof')
    expect(stdout).toContain('[PASS] .github/workflows/deploy-staging.yml gates deploy:staging with check:release')
    expect(stdout).toContain('[PASS] .github/workflows/deploy-production.yml gates deploy:production with check:release')
  })

  it('fails when wrangler.toml still contains placeholder resource IDs', async () => {
    const fixtureRoot = await createFixture({
      wranglerToml: [
        'name = "edgecms-api"',
        '',
        '[env.staging]',
        '[[env.staging.d1_databases]]',
        'database_id = "STAGING_DATABASE_ID"',
        '',
      ].join('\n'),
    })
    createdRoots.push(fixtureRoot)

    const proc = Bun.spawn(['bash', 'scripts/check-release-readiness.sh', fixtureRoot], {
      cwd: process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const stdout = await new Response(proc.stdout).text()
    const exitCode = await proc.exited

    expect(exitCode).toBe(1)
    expect(stdout).toContain('[FAIL] wrangler.toml Cloudflare binding placeholders removed')
    expect(stdout).toContain('STAGING_DATABASE_ID')
  })

  it('fails when production deploy script targets a different wrangler environment', async () => {
    const fixtureRoot = await createFixture()
    await writeFixtureFile(
      fixtureRoot,
      'apps/api/package.json',
      JSON.stringify(
        {
          name: 'edgecms-api',
          version: '0.1.0',
          scripts: { 'deploy:production': 'wrangler deploy --env prod' },
        },
        null,
        2
      )
    )
    createdRoots.push(fixtureRoot)

    const proc = Bun.spawn(['bash', 'scripts/check-release-readiness.sh', fixtureRoot], {
      cwd: process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const stdout = await new Response(proc.stdout).text()
    const exitCode = await proc.exited

    expect(exitCode).toBe(1)
    expect(stdout).toContain('[FAIL] apps/api deploy:production targets env: production')
    expect(stdout).toContain('wrangler deploy --env prod')
  })

  it('fails when env D1 migrations_dir is missing', async () => {
    const fixtureRoot = await createFixture({
      wranglerToml: [
        'name = "edgecms-api"',
        '',
        '[env.staging]',
        '[[env.staging.d1_databases]]',
        'database_id = "real-staging-db-id"',
        '[[env.staging.kv_namespaces]]',
        'id = "real-staging-kv-id"',
        '',
        '[env.production]',
        '[[env.production.d1_databases]]',
        'database_id = "real-production-db-id"',
        'migrations_dir = "drizzle/migrations"',
        '[[env.production.kv_namespaces]]',
        'id = "real-production-kv-id"',
        '',
      ].join('\n'),
    })
    createdRoots.push(fixtureRoot)

    const proc = Bun.spawn(['bash', 'scripts/check-release-readiness.sh', fixtureRoot], {
      cwd: process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const stdout = await new Response(proc.stdout).text()
    const exitCode = await proc.exited

    expect(exitCode).toBe(1)
    expect(stdout).toContain('[FAIL] wrangler.toml env.staging D1 migrations_dir')
    expect(stdout).toContain('expected drizzle/migrations, got <missing>')
  })

  it('fails when deployment workflow skips the release gate before deploy', async () => {
    const fixtureRoot = await createFixture({
      productionWorkflow: [
        'steps:',
        '  - run: bun install --frozen-lockfile',
        '  - run: cd apps/api && bun run deploy:production',
        '',
      ].join('\n'),
    })
    createdRoots.push(fixtureRoot)

    const proc = Bun.spawn(['bash', 'scripts/check-release-readiness.sh', fixtureRoot], {
      cwd: process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const stdout = await new Response(proc.stdout).text()
    const exitCode = await proc.exited

    expect(exitCode).toBe(1)
    expect(stdout).toContain('[FAIL] .github/workflows/deploy-production.yml gates deploy:production with check:release')
    expect(stdout).toContain('check:release must run before bun run deploy:production')
  })

  it('fails when public read perf proof commands are not wired', async () => {
    const fixtureRoot = await createFixture({
      rootScripts: {
        'perf:public-read:remote': 'bun scripts/public-read-performance.ts --mode remote',
      },
    })
    createdRoots.push(fixtureRoot)

    const proc = Bun.spawn(['bash', 'scripts/check-release-readiness.sh', fixtureRoot], {
      cwd: process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const stdout = await new Response(proc.stdout).text()
    const exitCode = await proc.exited

    expect(exitCode).toBe(1)
    expect(stdout).toContain('[FAIL] package.json wires local public read perf proof')
    expect(stdout).toContain('missing script perf:public-read:local')
  })
})
