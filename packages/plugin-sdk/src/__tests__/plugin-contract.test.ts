import { describe, expect, it } from 'bun:test'
import {
  checkPluginBindings,
  composePluginContracts,
  validatePluginContract,
  type PluginCompositionCandidate,
  type PluginDefinition,
} from '../index'

const d1 = { prepare: () => ({}), batch: async () => [] }
const kv = { get: async () => null, put: async () => {}, getWithMetadata: async () => ({}) }
const r2 = { get: async () => null, put: async () => ({}), head: async () => null }
const queue = { send: async () => {} }

function plugin(overrides: Partial<PluginDefinition> = {}, version = '1.0.0'): PluginDefinition {
  return {
    metadata: { displayName: 'P', description: 'p', version },
    hooks: {},
    ...overrides,
  }
}

function candidates(entries: Record<string, PluginDefinition>): PluginCompositionCandidate[] {
  return Object.entries(entries).map(([name, definition]) => ({ name, definition }))
}

describe('EX-02 validatePluginContract', () => {
  it('accepts a plugin with no contract fields', () => {
    expect(validatePluginContract('plain', plugin())).toEqual([])
  })

  it('accepts a full contract', () => {
    const issues = validatePluginContract(
      'full',
      plugin({
        edgecms: '>=0.2.0 <1.0.0',
        dependencies: { 'audit-trace': '^1.0.0' },
        bindings: [
          { name: 'DB', kind: 'd1' },
          { name: 'REVALIDATE_SECRET', kind: 'secret', description: 'Signing key' },
        ],
      })
    )
    expect(issues).toEqual([])
  })

  it('reports every malformed contract field with a path', () => {
    const issues = validatePluginContract(
      'broken',
      plugin({
        edgecms: 'latest',
        dependencies: { broken: '^1.0.0', 'Bad Name': '^1.0.0', other: 'whenever' },
        bindings: [
          { name: 'lowercase', kind: 'kv' },
          { name: 'MEDIA', kind: 'bucket' as never },
          { name: 'DB', kind: 'd1' },
          { name: 'DB', kind: 'd1' },
        ],
      })
    )
    const byPath = Object.fromEntries(issues.map((issue) => [issue.path, issue.code]))
    expect(byPath).toEqual({
      edgecms: 'INVALID_CONTRACT',
      'dependencies.broken': 'INVALID_CONTRACT',
      'dependencies.Bad Name': 'INVALID_CONTRACT',
      'dependencies.other': 'INVALID_CONTRACT',
      'bindings[0].name': 'INVALID_CONTRACT',
      'bindings[1].kind': 'INVALID_CONTRACT',
      'bindings[3].name': 'INVALID_CONTRACT',
    })
    expect(issues.every((issue) => issue.pluginName === 'broken')).toBe(true)
  })

  it('rejects non-object dependencies and non-array bindings', () => {
    const issues = validatePluginContract(
      'shape',
      plugin({ dependencies: ['audit-trace'] as never, bindings: { DB: 'd1' } as never })
    )
    expect(issues.map((issue) => issue.path).sort()).toEqual(['bindings', 'dependencies'])
  })
})

describe('EX-02 checkPluginBindings', () => {
  it('accepts bindings of the declared kind', () => {
    const issues = checkPluginBindings(
      'needs-all',
      [
        { name: 'DB', kind: 'd1' },
        { name: 'CACHE', kind: 'kv' },
        { name: 'MEDIA', kind: 'r2' },
        { name: 'WEBHOOK_QUEUE', kind: 'queue' },
        { name: 'API_KEY', kind: 'secret' },
      ],
      { DB: d1, CACHE: kv, MEDIA: r2, WEBHOOK_QUEUE: queue, API_KEY: 's3cret' }
    )
    expect(issues).toEqual([])
  })

  it('names the missing binding and its kind', () => {
    const issues = checkPluginBindings('needs-media', [{ name: 'MEDIA', kind: 'r2' }], {})
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      pluginName: 'needs-media',
      path: 'bindings[0]',
      code: 'MISSING_REQUIRED_BINDING',
    })
    expect(issues[0]!.message).toContain('MEDIA')
    expect(issues[0]!.message).toContain('R2')
  })

  it('rejects a binding of the wrong kind', () => {
    const issues = checkPluginBindings(
      'wrong-kind',
      [
        { name: 'MEDIA', kind: 'r2' },
        { name: 'DB', kind: 'd1' },
        { name: 'API_KEY', kind: 'secret' },
        { name: 'WEBHOOK_QUEUE', kind: 'queue' },
      ],
      { MEDIA: kv, DB: kv, API_KEY: '   ', WEBHOOK_QUEUE: 'not-a-queue' }
    )
    expect(issues.map((issue) => issue.code)).toEqual([
      'MISSING_REQUIRED_BINDING',
      'MISSING_REQUIRED_BINDING',
      'MISSING_REQUIRED_BINDING',
      'MISSING_REQUIRED_BINDING',
    ])
  })

  it('fails closed with no env and when reading the env throws', () => {
    expect(checkPluginBindings('no-env', [{ name: 'DB', kind: 'd1' }], undefined)).toHaveLength(1)
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error('boom')
        },
      }
    )
    expect(checkPluginBindings('hostile', [{ name: 'DB', kind: 'd1' }], hostile)).toHaveLength(1)
  })
})

describe('EX-02 composePluginContracts', () => {
  it('admits plugins without a contract in input order', () => {
    const report = composePluginContracts({
      frameworkVersion: '0.2.0',
      plugins: candidates({ zeta: plugin(), alpha: plugin(), mid: plugin() }),
    })
    expect(report.loadOrder).toEqual(['zeta', 'alpha', 'mid'])
    expect(report.rejected).toEqual([])
    expect(report.frameworkVersion).toBe('0.2.0')
  })

  it('checks the edgecms engine range against the framework version', () => {
    const report = composePluginContracts({
      frameworkVersion: '0.2.0',
      plugins: candidates({
        current: plugin({ edgecms: '>=0.2.0 <1.0.0' }),
        future: plugin({ edgecms: '^1.0.0' }),
      }),
    })
    expect(report.loadOrder).toEqual(['current'])
    expect(report.rejected).toHaveLength(1)
    expect(report.rejected[0]).toMatchObject({ pluginName: 'future', code: 'INCOMPATIBLE_CORE' })
    expect(report.rejected[0]!.issues[0]!.message).toContain('0.2.0')
    expect(report.rejected[0]!.issues[0]!.message).toContain('^1.0.0')
  })

  it('fails closed when the framework version itself is not semver', () => {
    const report = composePluginContracts({
      frameworkVersion: 'dev',
      plugins: candidates({ ranged: plugin({ edgecms: '*' }), unranged: plugin() }),
    })
    expect(report.loadOrder).toEqual(['unranged'])
    expect(report.rejected[0]).toMatchObject({ pluginName: 'ranged', code: 'INCOMPATIBLE_CORE' })
  })

  it('orders dependencies before dependents, deterministically', () => {
    const plugins = candidates({
      app: plugin({ dependencies: { ui: '^2.0.0', core: '^1.0.0' } }),
      ui: plugin({ dependencies: { core: '^1.0.0' } }, '2.1.0'),
      core: plugin({}, '1.4.0'),
      standalone: plugin(),
    })
    const first = composePluginContracts({ frameworkVersion: '0.2.0', plugins })
    expect(first.rejected).toEqual([])
    expect(first.loadOrder).toEqual(['core', 'ui', 'app', 'standalone'])
    const second = composePluginContracts({ frameworkVersion: '0.2.0', plugins })
    expect(second.loadOrder).toEqual(first.loadOrder)
  })

  it('rejects a dependency that is absent or outside the range', () => {
    const report = composePluginContracts({
      frameworkVersion: '0.2.0',
      plugins: candidates({
        needsGhost: plugin({ dependencies: { ghost: '^1.0.0' } }),
        needsNewCore: plugin({ dependencies: { core: '^2.0.0' } }),
        core: plugin({}, '1.4.0'),
      }),
    })
    expect(report.loadOrder).toEqual(['core'])
    const codes = Object.fromEntries(report.rejected.map((entry) => [entry.pluginName, entry.code]))
    expect(codes).toEqual({ needsGhost: 'MISSING_DEPENDENCY', needsNewCore: 'INCOMPATIBLE_DEPENDENCY' })
    const message = report.rejected.find((entry) => entry.pluginName === 'needsNewCore')!.issues[0]!.message
    expect(message).toContain('1.4.0')
    expect(message).toContain('^2.0.0')
  })

  it('rejects a dependency that declares no version', () => {
    const report = composePluginContracts({
      frameworkVersion: '0.2.0',
      plugins: [
        { name: 'app', definition: plugin({ dependencies: { core: '*' } }) },
        { name: 'core', definition: { hooks: {} } },
      ],
    })
    expect(report.rejected[0]).toMatchObject({ pluginName: 'app', code: 'INCOMPATIBLE_DEPENDENCY' })
  })

  it('rejects every plugin in a cycle and every plugin that depends on one', () => {
    const report = composePluginContracts({
      frameworkVersion: '0.2.0',
      plugins: candidates({
        a: plugin({ dependencies: { b: '*' } }),
        b: plugin({ dependencies: { c: '*' } }),
        c: plugin({ dependencies: { a: '*' } }),
        downstream: plugin({ dependencies: { a: '*' } }),
        fine: plugin(),
      }),
    })
    expect(report.loadOrder).toEqual(['fine'])
    const codes = Object.fromEntries(report.rejected.map((entry) => [entry.pluginName, entry.code]))
    expect(codes).toEqual({
      a: 'CYCLIC_DEPENDENCY',
      b: 'CYCLIC_DEPENDENCY',
      c: 'CYCLIC_DEPENDENCY',
      downstream: 'DEPENDENCY_BLOCKED',
    })
    const cycleMessage = report.rejected.find((entry) => entry.pluginName === 'a')!.issues[0]!.message
    expect(cycleMessage).toContain('a -> b -> c -> a')
  })

  it('rejects a self dependency as a contract error', () => {
    const report = composePluginContracts({
      frameworkVersion: '0.2.0',
      plugins: candidates({ loop: plugin({ dependencies: { loop: '*' } }) }),
    })
    expect(report.rejected[0]).toMatchObject({ pluginName: 'loop', code: 'INVALID_CONTRACT' })
  })

  it('propagates a rejection through a dependency chain', () => {
    const report = composePluginContracts({
      frameworkVersion: '0.2.0',
      plugins: candidates({
        top: plugin({ dependencies: { middle: '*' } }),
        middle: plugin({ dependencies: { base: '*' } }),
        base: plugin({ bindings: [{ name: 'MEDIA', kind: 'r2' }] }),
      }),
      env: {},
    })
    expect(report.loadOrder).toEqual([])
    const codes = Object.fromEntries(report.rejected.map((entry) => [entry.pluginName, entry.code]))
    expect(codes).toEqual({
      top: 'DEPENDENCY_BLOCKED',
      middle: 'DEPENDENCY_BLOCKED',
      base: 'MISSING_REQUIRED_BINDING',
    })
  })

  it('checks bindings against the env', () => {
    const plugins = candidates({ media: plugin({ bindings: [{ name: 'MEDIA', kind: 'r2' }] }) })
    expect(composePluginContracts({ frameworkVersion: '0.2.0', plugins, env: { MEDIA: r2 } }).loadOrder).toEqual([
      'media',
    ])
    expect(composePluginContracts({ frameworkVersion: '0.2.0', plugins }).rejected[0]).toMatchObject({
      pluginName: 'media',
      code: 'MISSING_REQUIRED_BINDING',
    })
  })

  it('rejects every copy of a duplicated plugin name', () => {
    const report = composePluginContracts({
      frameworkVersion: '0.2.0',
      plugins: [
        { name: 'twice', definition: plugin() },
        { name: 'twice', definition: plugin() },
        { name: 'once', definition: plugin() },
      ],
    })
    expect(report.loadOrder).toEqual(['once'])
    expect(report.rejected.map((entry) => [entry.pluginName, entry.code])).toEqual([
      ['twice', 'DUPLICATE_PLUGIN'],
    ])
  })

  it('collects every issue for a plugin, with the first as the primary code', () => {
    const report = composePluginContracts({
      frameworkVersion: '0.2.0',
      plugins: candidates({
        many: plugin({
          edgecms: '^9.0.0',
          bindings: [{ name: 'DB', kind: 'd1' }],
          dependencies: { ghost: '*' },
        }),
      }),
    })
    expect(report.rejected[0]!.code).toBe('INCOMPATIBLE_CORE')
    expect(report.rejected[0]!.issues.map((issue) => issue.code)).toEqual([
      'INCOMPATIBLE_CORE',
      'MISSING_REQUIRED_BINDING',
      'MISSING_DEPENDENCY',
    ])
  })
})
