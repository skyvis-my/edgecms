import { describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import { createPluginRuntime, validatePluginAdmission } from '../../plugins/plugin-loader'
import {
  getTrustedPluginDefinition,
  type AnyElysia,
  type TrustedPluginDefinition,
} from '../../plugins/trusted-plugin-catalog'
import { API_VERSION } from '@/version'

const r2 = { get: async () => null, put: async () => ({}), head: async () => null }
const kvLike = { get: async () => null, put: async () => {}, getWithMetadata: async () => ({}) }

function definition(
  name: string,
  calls: string[],
  overrides: Partial<TrustedPluginDefinition> = {},
  version = '1.0.0'
): TrustedPluginDefinition {
  return {
    metadata: { displayName: name, description: name, version },
    hooks: {
      beforeCommand: async () => {
        calls.push(name)
      },
    },
    aiTools: [
      {
        name: `${name}Tool`,
        description: 'tool',
        parameters: {} as never,
        toCommands: () => [],
      },
    ],
    fields: [{ type: `${name}-field`, label: 'Field', validator: {} as never }],
    routes: {
      [`${name}-health`]: () =>
        new Elysia().get(`/api/admin/plugins/${name}/health`, () => ({ ok: true })) as AnyElysia,
    },
    ...overrides,
  }
}

const hookCtx = { requestId: 'r', pathname: '/', method: 'POST' }

describe('EX-02 composition in the API plugin loader', () => {
  it('blocks a plugin whose edgecms range excludes the running version, and it registers nothing', async () => {
    const calls: string[] = []
    const runtime = createPluginRuntime()
    const catalog: Record<string, TrustedPluginDefinition> = {
      future: definition('future', calls, { edgecms: '^99.0.0' }),
    }
    await runtime.loadPlugins([{ name: 'future' }], (name) => catalog[name])

    const [loaded] = runtime.getLoadedPlugins()
    expect(loaded).toMatchObject({ name: 'future', status: 'blocked', rejectionCode: 'INCOMPATIBLE_CORE' })
    expect(loaded!.reason).toContain(API_VERSION)
    expect(loaded!.issues?.[0]?.path).toBe('edgecms')
    expect(loaded!.hooks).toEqual([])
    expect(runtime.getLoadedPluginAiTools()).toEqual([])
    expect(runtime.getLoadedPluginFields()).toEqual([])
    expect(runtime.createLoadedPluginRoutesController().routes).toHaveLength(0)
    await runtime.registry.execute('beforeCommand', hookCtx)
    expect(calls).toEqual([])
  })

  it('loads dependencies first, so their hooks run first', async () => {
    const calls: string[] = []
    const runtime = createPluginRuntime()
    const catalog: Record<string, TrustedPluginDefinition> = {
      dependent: definition('dependent', calls, { dependencies: { base: '^1.2.0' } }),
      base: definition('base', calls, {}, '1.3.0'),
    }
    await runtime.loadPlugins([{ name: 'dependent' }, { name: 'base' }], (name) => catalog[name])

    expect(runtime.getLoadedPlugins().map((p) => [p.name, p.status])).toEqual([
      ['base', 'loaded'],
      ['dependent', 'loaded'],
    ])
    expect(runtime.getCompositionReport().loadOrder).toEqual(['base', 'dependent'])
    await runtime.registry.execute('beforeCommand', hookCtx)
    expect(calls).toEqual(['base', 'dependent'])
  })

  it('blocks a plugin whose dependency is disabled, outside its range or not in the catalog', async () => {
    const calls: string[] = []
    const runtime = createPluginRuntime()
    const catalog: Record<string, TrustedPluginDefinition> = {
      'needs-off': definition('needs-off', calls, { dependencies: { off: '*' } }),
      'needs-new': definition('needs-new', calls, { dependencies: { base: '^2.0.0' } }),
      'needs-ghost': definition('needs-ghost', calls, { dependencies: { ghost: '*' } }),
      off: definition('off', calls),
      base: definition('base', calls, {}, '1.3.0'),
    }
    await runtime.loadPlugins(
      [
        { name: 'needs-off' },
        { name: 'needs-new' },
        { name: 'needs-ghost' },
        { name: 'off', enabled: false },
        { name: 'base' },
      ],
      (name) => catalog[name]
    )

    const byName = Object.fromEntries(runtime.getLoadedPlugins().map((p) => [p.name, p]))
    expect(byName['needs-off']).toMatchObject({ status: 'blocked', rejectionCode: 'MISSING_DEPENDENCY' })
    expect(byName['needs-new']).toMatchObject({ status: 'blocked', rejectionCode: 'INCOMPATIBLE_DEPENDENCY' })
    expect(byName['needs-ghost']).toMatchObject({ status: 'blocked', rejectionCode: 'MISSING_DEPENDENCY' })
    expect(byName.off!.status).toBe('disabled')
    expect(byName.base!.status).toBe('loaded')
    await runtime.registry.execute('beforeCommand', hookCtx)
    expect(calls).toEqual(['base'])
  })

  it('blocks a dependency cycle and everything downstream of it', async () => {
    const calls: string[] = []
    const runtime = createPluginRuntime()
    const catalog: Record<string, TrustedPluginDefinition> = {
      a: definition('a', calls, { dependencies: { b: '*' } }),
      b: definition('b', calls, { dependencies: { a: '*' } }),
      c: definition('c', calls, { dependencies: { a: '*' } }),
    }
    await runtime.loadPlugins([{ name: 'a' }, { name: 'b' }, { name: 'c' }], (name) => catalog[name])

    expect(runtime.getLoadedPlugins().map((p) => [p.name, p.rejectionCode])).toEqual([
      ['a', 'CYCLIC_DEPENDENCY'],
      ['b', 'CYCLIC_DEPENDENCY'],
      ['c', 'DEPENDENCY_BLOCKED'],
    ])
    await runtime.registry.execute('beforeCommand', hookCtx)
    expect(calls).toEqual([])
  })

  it('checks declared bindings against the Worker env passed at composition', async () => {
    const calls: string[] = []
    const catalog: Record<string, TrustedPluginDefinition> = {
      media: definition('media', calls, {
        bindings: [
          { name: 'MEDIA', kind: 'r2', description: 'stores renditions' },
          { name: 'MEDIA_SIGNING_SECRET', kind: 'secret' },
        ],
      }),
    }

    const missing = createPluginRuntime()
    await missing.loadPlugins([{ name: 'media' }], (name) => catalog[name], { env: { MEDIA: kvLike } })
    const [blocked] = missing.getLoadedPlugins()
    expect(blocked).toMatchObject({ status: 'blocked', rejectionCode: 'MISSING_REQUIRED_BINDING' })
    expect(blocked!.issues?.map((issue) => issue.path)).toEqual(['bindings[0]', 'bindings[1]'])
    expect(blocked!.reason).toContain('MEDIA')
    expect(blocked!.reason).toContain('R2 bucket')
    expect(blocked!.reason).toContain('MEDIA_SIGNING_SECRET')

    const noEnv = createPluginRuntime()
    await noEnv.loadPlugins([{ name: 'media' }], (name) => catalog[name])
    expect(noEnv.getLoadedPlugins()[0]!.status).toBe('blocked')

    const present = createPluginRuntime()
    await present.loadPlugins([{ name: 'media' }], (name) => catalog[name], {
      env: { MEDIA: r2, MEDIA_SIGNING_SECRET: 'x'.repeat(32) },
    })
    expect(present.getLoadedPlugins()[0]!.status).toBe('loaded')
  })

  it('applies the same composition on the sync load path', () => {
    const calls: string[] = []
    const runtime = createPluginRuntime()
    const catalog: Record<string, TrustedPluginDefinition> = {
      dependent: definition('dependent', calls, { dependencies: { base: '^1.0.0' } }),
      base: definition('base', calls),
      future: definition('future', calls, { edgecms: '>=99.0.0' }),
    }
    runtime.loadPluginsSync([{ name: 'dependent' }, { name: 'future' }, { name: 'base' }], (name) => catalog[name])
    expect(runtime.getLoadedPlugins().map((p) => [p.name, p.status])).toEqual([
      ['base', 'loaded'],
      ['future', 'blocked'],
      ['dependent', 'loaded'],
    ])
  })

  it('blocks both copies of a plugin configured twice', async () => {
    const calls: string[] = []
    const runtime = createPluginRuntime()
    const catalog: Record<string, TrustedPluginDefinition> = { twice: definition('twice', calls) }
    await runtime.loadPlugins([{ name: 'twice' }, { name: 'twice' }], (name) => catalog[name])
    expect(runtime.getLoadedPlugins().map((p) => p.rejectionCode)).toEqual(['DUPLICATE_PLUGIN', 'DUPLICATE_PLUGIN'])
    await runtime.registry.execute('beforeCommand', hookCtx)
    expect(calls).toEqual([])
  })

  it('exposes a structured composition report', async () => {
    const calls: string[] = []
    const runtime = createPluginRuntime()
    const catalog: Record<string, TrustedPluginDefinition> = {
      ok: definition('ok', calls),
      future: definition('future', calls, { edgecms: '^99.0.0' }),
    }
    await runtime.loadPlugins([{ name: 'ok' }, { name: 'future' }, { name: 'stranger' }], (name) => catalog[name])
    const report = runtime.getCompositionReport()
    expect(report.frameworkVersion).toBe(API_VERSION)
    expect(report.loadOrder).toEqual(['ok'])
    expect(report.rejected.map((entry) => [entry.pluginName, entry.code])).toEqual([['future', 'INCOMPATIBLE_CORE']])
    // The report is a copy: mutating it does not change the runtime's state.
    report.loadOrder.push('tampered')
    expect(runtime.getCompositionReport().loadOrder).toEqual(['ok'])
  })

  it('admits every shipped catalog plugin at the running framework version', async () => {
    const names = ['audit-trace', 'seo-metadata', 'preview-revalidation']
    for (const name of names) {
      expect(getTrustedPluginDefinition(name)?.edgecms).toBeString()
    }
    const runtime = createPluginRuntime()
    await runtime.loadPlugins(names.map((name) => ({ name })))
    expect(runtime.getLoadedPlugins().map((p) => p.status)).toEqual(['loaded', 'loaded', 'loaded'])
  })
})

describe('EX-02 manifest version ranges fail closed', () => {
  const trusted: TrustedPluginDefinition = { hooks: {} }

  it('rejects an unparsable coreVersionRange instead of ignoring it', () => {
    const result = validatePluginAdmission({ name: 'x', coreVersionRange: 'banana' }, [{ name: 'x' }], trusted)
    expect(result?.rejectionCode).toBe('INCOMPATIBLE_CORE')
  })

  it('accepts a coreVersionRange that includes the running version', () => {
    expect(
      validatePluginAdmission({ name: 'x', coreVersionRange: `>=${API_VERSION}` }, [{ name: 'x' }], trusted)
    ).toBeNull()
  })

  it('applies real range semantics, not major-only matching', () => {
    const result = validatePluginAdmission(
      { name: 'x', coreVersionRange: `>${API_VERSION}` },
      [{ name: 'x' }],
      trusted
    )
    expect(result?.rejectionCode).toBe('INCOMPATIBLE_CORE')
  })
})
