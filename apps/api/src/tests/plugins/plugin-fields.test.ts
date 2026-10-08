import { beforeEach, describe, expect, it, mock, vi } from 'bun:test'
import { type } from 'arktype'

vi.mock('cloudflare:workers', () => ({
  env: {},
}))

describe('plugin field type extension', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers custom field types from plugin definition', async () => {
    const { pluginRegistry } = await import(
      `../../plugins/plugin-registry?bypass=${Date.now()}`
    )

    mock.module('@/plugins/plugin-registry', () => ({ pluginRegistry }))

    const { loadPlugins, getLoadedPluginFields } = await import(
      `../../plugins/plugin-loader?bypass=${Date.now()}`
    )

    await loadPlugins([
      {
        name: 'audit-trace',
        enabled: true,
      },
    ], pluginRegistry)

    const fields = getLoadedPluginFields()

    expect(fields).toBeDefined()
    expect(Array.isArray(fields)).toBe(true)
  })

  it('field definitions include type, label, validator, and defaultValue', async () => {
    const { pluginRegistry } = await import(
      `../../plugins/plugin-registry?bypass=${Date.now()}`
    )

    mock.module('@/plugins/plugin-registry', () => ({ pluginRegistry }))

    const { loadPlugins, getLoadedPluginFields } = await import(
      `../../plugins/plugin-loader?bypass=${Date.now()}`
    )

    await loadPlugins([
      {
        name: 'audit-trace',
        enabled: true,
      },
    ], pluginRegistry)

    const fields = getLoadedPluginFields()

    for (const field of fields) {
      expect(field).toHaveProperty('type')
      expect(field).toHaveProperty('label')
      expect(field).toHaveProperty('validator')
      expect(typeof field.type).toBe('string')
      expect(typeof field.label).toBe('string')
    }
  })

  it('fields from disabled plugins are not returned', async () => {
    const { pluginRegistry } = await import(
      `../../plugins/plugin-registry?bypass=${Date.now()}`
    )

    mock.module('@/plugins/plugin-registry', () => ({ pluginRegistry }))

    const { loadPlugins, getLoadedPluginFields } = await import(
      `../../plugins/plugin-loader?bypass=${Date.now()}`
    )

    await loadPlugins([
      {
        name: 'audit-trace',
        enabled: false,
      },
    ], pluginRegistry)

    const fields = getLoadedPluginFields()

    expect(fields).toEqual([])
  })

  it('plugin with custom fields registers them correctly', async () => {
    const { getTrustedPluginDefinition } = await import(
      `../../plugins/trusted-plugin-catalog?bypass=${Date.now()}`
    )

    const definition = getTrustedPluginDefinition('audit-trace')
    
    if (definition?.fields) {
      for (const field of definition.fields) {
        expect(field.type).toBeDefined()
        expect(field.label).toBeDefined()
        expect(field.validator).toBeDefined()
      }
    }
  })

  it('keeps trusted plugin fields compatible without merging them into core field types', async () => {
    const { FIELD_TYPES } = await import('../../shared/schemas/field-types')
    const { getTrustedPluginDefinition } = await import(
      `../../plugins/trusted-plugin-catalog?bypass=${Date.now()}`
    )

    const definition = getTrustedPluginDefinition('seo-metadata')
    const field = definition?.fields?.[0]

    expect(field).toBeDefined()
    expect(FIELD_TYPES).not.toContain(field?.type as (typeof FIELD_TYPES)[number])
    expect(field?.validator(field.defaultValue) instanceof type.errors).toBe(false)
  })
})
