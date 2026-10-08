import { afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  type PluginDefinition,
  type PluginHookContext,
  type PluginMetadata,
} from '../../dist/index.js'

const tempDirs: string[] = []
const sdkPackageRoot = join(import.meta.dir, '..', '..')

beforeAll(() => {
  const distDts = join(sdkPackageRoot, 'dist', 'index.d.ts')
  if (!existsSync(distDts)) {
    spawnSync('node', [join(sdkPackageRoot, 'scripts', 'build.mjs')], {
      cwd: sdkPackageRoot,
      stdio: 'inherit',
    })
  }
})

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'edgecms-plugin-consumer-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('F11 — Plugin SDK Consumer Contract', () => {
  it('instantiates valid plugin definitions from built SDK types', () => {
    const meta: PluginMetadata = {
      displayName: 'Analytics Tracker',
      description: 'Records CMS analytics',
      version: '1.0.0',
    }

    const testPlugin: PluginDefinition = {
      metadata: meta,
      hooks: {
        afterCommand: async (ctx: PluginHookContext) => {
          expect(ctx.requestId).toBeDefined()
        },
      },
      adminMenu: [
        {
          label: 'Analytics Dashboard',
          path: '/api/admin/plugins/analytics/dashboard',
        },
      ],
    }

    expect(testPlugin.metadata?.displayName).toBe('Analytics Tracker')
    expect(testPlugin.adminMenu?.[0]?.label).toBe('Analytics Dashboard')
    expect(typeof testPlugin.hooks.afterCommand).toBe('function')
  })

  it('compiles an external plugin author package against the packaged SDK declarations', () => {
    const consumerDir = makeTempDir()
    const sdkPackageRoot = join(import.meta.dir, '..', '..')

    // Write external consumer plugin package.json
    writeFileSync(
      join(consumerDir, 'package.json'),
      JSON.stringify(
        {
          name: 'edgecms-plugin-custom-audit',
          type: 'module',
          dependencies: {
            '@edgecms/plugin-sdk': `file:${sdkPackageRoot}`,
          },
        },
        null,
        2,
      ),
    )

    // Write tsconfig.json
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
            paths: {
              '@edgecms/plugin-sdk': [join(sdkPackageRoot, 'dist', 'index.d.ts')],
            },
          },
          include: ['plugin.ts'],
        },
        null,
        2,
      ),
    )

    // Write consumer plugin author file
    writeFileSync(
      join(consumerDir, 'plugin.ts'),
      `
import type {
  PluginDefinition,
  PluginHookContext,
  PluginMetadata,
} from '@edgecms/plugin-sdk'

const metadata: PluginMetadata = {
  displayName: 'Custom Audit Plugin',
  description: 'Audits operations outside monorepo',
  version: '0.1.0',
}

export const customAuditPlugin: PluginDefinition = {
  metadata,
  hooks: {
    beforeCommand: async (ctx: PluginHookContext) => {
      console.log('Incoming command:', ctx.commandType)
    },
    afterCommand: async (ctx: PluginHookContext) => {
      console.log('Completed command:', ctx.commandId)
    },
  },
  adminMenu: [
    {
      label: 'Audit Log',
      path: '/api/admin/plugins/custom-audit',
    },
  ],
}
`,
    )

    const distDts = join(sdkPackageRoot, 'dist', 'index.d.ts')
    if (!existsSync(distDts)) {
      spawnSync('node', [join(sdkPackageRoot, 'scripts', 'build.mjs')], {
        cwd: sdkPackageRoot,
        stdio: 'inherit',
      })
    }

    const result = spawnSync('bunx', ['tsc', '-p', join(consumerDir, 'tsconfig.json')], {
      cwd: consumerDir,
      encoding: 'utf8',
      env: { ...process.env },
    })

    expect(
      result.status,
      `External plugin compilation failed:\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    ).toBe(0)
  })
})
