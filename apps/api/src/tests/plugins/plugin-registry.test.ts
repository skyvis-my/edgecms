import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { getMetric, resetMetrics } from '../../observability/metrics'

// Use cache-busted dynamic import to avoid mock pollution from other test files
const { pluginRegistry } = await import(`../../plugins/plugin-registry?bypass=${Date.now()}`)

describe('pluginRegistry', () => {
  beforeEach(() => resetMetrics())
  afterEach(() => {
    pluginRegistry.clear()
    resetMetrics()
  })

  it('executes hooks in deterministic registration order', async () => {
    const calls: string[] = []

    pluginRegistry.register('beforeCommand', async () => {
      calls.push('first')
    })
    pluginRegistry.register('beforeCommand', async () => {
      calls.push('second')
    })

    await pluginRegistry.execute('beforeCommand', {
      requestId: 'r1',
      pathname: '/api/admin/commands',
      method: 'POST',
    })

    expect(calls).toEqual(['first', 'second'])
  })

  it('times out slow hooks when timeout is configured', async () => {
    pluginRegistry.setHookTimeoutMs(10)
    pluginRegistry.register('beforeCommand', async () => {
      await new Promise((resolve) => setTimeout(resolve, 40))
    })

    await expect(
      pluginRegistry.execute('beforeCommand', {
        requestId: 'r-timeout',
        pathname: '/api/admin/commands',
        method: 'POST',
      })
    ).rejects.toThrow('Plugin hook timed out after 10ms')
  })

  it('disables timeout enforcement when configured to zero', async () => {
    pluginRegistry.setHookTimeoutMs(0)
    let executed = false
    pluginRegistry.register('beforeCommand', async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      executed = true
    })

    await pluginRegistry.execute('beforeCommand', {
      requestId: 'r-no-timeout',
      pathname: '/api/admin/commands',
      method: 'POST',
    })

    expect(executed).toBe(true)
  })

  it('resets hook timeout to default when cleared', () => {
    pluginRegistry.setHookTimeoutMs(0)
    pluginRegistry.clear()
    expect(pluginRegistry.getHookTimeoutMs()).toBe(250)
  })

  it('emits success metric when a hook executes', async () => {
    pluginRegistry.register('beforeCommand', async () => {})

    await pluginRegistry.execute('beforeCommand', {
      requestId: 'r-success',
      pathname: '/api/admin/commands',
      method: 'POST',
    })

    expect(getMetric('plugin_hook_runs_total', { hook: 'beforeCommand', status: 'success' })).toBe(1)
  })

  it('emits timeout metric when a hook times out', async () => {
    pluginRegistry.setHookTimeoutMs(10)
    pluginRegistry.register('beforeCommand', async () => {
      await new Promise((resolve) => setTimeout(resolve, 40))
    })

    await expect(
      pluginRegistry.execute('beforeCommand', {
        requestId: 'r-timeout-metric',
        pathname: '/api/admin/commands',
        method: 'POST',
      })
    ).rejects.toThrow('Plugin hook timed out after 10ms')

    expect(getMetric('plugin_hook_runs_total', { hook: 'beforeCommand', status: 'timeout' })).toBe(1)
  })
})
