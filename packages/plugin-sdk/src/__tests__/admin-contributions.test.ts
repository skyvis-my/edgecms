import { describe, expect, it } from 'bun:test'
import {
  composeAdminContributions,
  isSafeAdminContributionHref,
  validateAdminContributionEntry,
  type TrustedAdminContributionEntry,
} from '../index'

const Component = () => null

function validEntry(
  overrides: Partial<TrustedAdminContributionEntry> = {}
): TrustedAdminContributionEntry {
  return {
    pluginName: 'host-plan',
    contributions: {
      navItems: [{ id: 'billing', label: 'Plan & billing', access: 'tenant:manage', component: Component }],
      panels: [
        {
          id: 'usage',
          slot: 'dashboard',
          title: 'Plan usage',
          access: 'tenant:read',
          component: Component,
        },
      ],
      banners: [
        {
          id: 'trial',
          tone: 'warning',
          message: 'Your trial ends soon.',
          access: 'tenant:manage',
          link: { label: 'Upgrade', href: '/tenants/acme/plugins/host-plan/billing' },
        },
      ],
    },
    ...overrides,
  }
}

function codes(entry: unknown) {
  return validateAdminContributionEntry(entry).map((issue) => `${issue.path}:${issue.code}`)
}

describe('HS-10 admin contribution validation', () => {
  it('accepts a complete, valid entry', () => {
    expect(validateAdminContributionEntry(validEntry())).toEqual([])
  })

  it('rejects a non-slug plugin name', () => {
    expect(codes(validEntry({ pluginName: '../core' }))).toContain('pluginName:INVALID_PLUGIN_NAME')
  })

  it('rejects unknown fields so raw HTML or script URLs cannot ride along', () => {
    const entry = validEntry()
    ;(entry.contributions.banners![0] as Record<string, unknown>).html = '<script>alert(1)</script>'
    ;(entry.contributions as Record<string, unknown>).scripts = ['https://evil.example/x.js']
    expect(codes(entry)).toEqual(
      expect.arrayContaining([
        'contributions.banners[0].html:UNKNOWN_FIELD',
        'contributions.scripts:UNKNOWN_FIELD',
      ])
    )
  })

  it('rejects path-like and duplicate ids', () => {
    const entry = validEntry()
    entry.contributions.navItems = [
      { id: '../settings', label: 'Escape', access: 'tenant:read', component: Component },
      { id: 'page', label: 'A', access: 'tenant:read', component: Component },
      { id: 'page', label: 'B', access: 'tenant:read', component: Component },
    ]
    expect(codes(entry)).toEqual(
      expect.arrayContaining([
        'contributions.navItems[0].id:INVALID_ID',
        'contributions.navItems[2].id:DUPLICATE_ID',
      ])
    )
  })

  it('requires an explicit known access level', () => {
    const entry = validEntry()
    ;(entry.contributions.panels![0] as Record<string, unknown>).access = 'everyone'
    delete (entry.contributions.navItems![0] as Record<string, unknown>).access
    expect(codes(entry)).toEqual(
      expect.arrayContaining([
        'contributions.panels[0].access:INVALID_ACCESS',
        'contributions.navItems[0].access:INVALID_ACCESS',
      ])
    )
  })

  it('rejects unknown slots and tones', () => {
    const entry = validEntry()
    ;(entry.contributions.panels![0] as Record<string, unknown>).slot = 'login-page'
    ;(entry.contributions.banners![0] as Record<string, unknown>).tone = 'danger'
    expect(codes(entry)).toEqual(
      expect.arrayContaining([
        'contributions.panels[0].slot:INVALID_SLOT',
        'contributions.banners[0].tone:INVALID_TONE',
      ])
    )
  })

  it('requires a bundled component for nav items and panels', () => {
    const entry = validEntry()
    ;(entry.contributions.navItems![0] as Record<string, unknown>).component =
      'https://cdn.example/page.js'
    delete (entry.contributions.panels![0] as Record<string, unknown>).component
    expect(codes(entry)).toEqual(
      expect.arrayContaining([
        'contributions.navItems[0].component:MISSING_COMPONENT',
        'contributions.panels[0].component:MISSING_COMPONENT',
      ])
    )
  })

  it('rejects empty, oversized and control-character text', () => {
    const entry = validEntry()
    entry.contributions.navItems![0]!.label = '   '
    entry.contributions.panels![0]!.title = 'x'.repeat(65)
    entry.contributions.banners![0]!.message = 'line\u0000break'
    expect(codes(entry)).toEqual(
      expect.arrayContaining([
        'contributions.navItems[0].label:INVALID_TEXT',
        'contributions.panels[0].title:INVALID_TEXT',
        'contributions.banners[0].message:INVALID_TEXT',
      ])
    )
  })

  it('enforces per-plugin caps', () => {
    const entry = validEntry()
    entry.contributions.banners = Array.from({ length: 4 }, (_, i) => ({
      id: `b${i}`,
      tone: 'info' as const,
      message: 'Hello',
      access: 'tenant:read' as const,
    }))
    expect(codes(entry)).toContain('contributions.banners:TOO_MANY')
  })

  it.each([
    ['javascript:alert(1)', false],
    ['data:text/html,<b>x</b>', false],
    ['http://example.com', false],
    ['//evil.example/path', false],
    ['/\\evil.example', false],
    ['https://user@evil.example', false],
    ['/tenants/acme/settings', true],
    ['https://billing.example.com/upgrade?plan=pro', true],
  ])('banner link href %p is safe=%p', (href, safe) => {
    expect(isSafeAdminContributionHref(href)).toBe(safe)
    const entry = validEntry()
    entry.contributions.banners![0]!.link = { label: 'Go', href }
    expect(codes(entry).includes('contributions.banners[0].link.href:INVALID_LINK')).toBe(!safe)
  })
})

describe('HS-10 admin contribution composition', () => {
  it('flattens valid entries and tags each item with its plugin', () => {
    const composed = composeAdminContributions([
      validEntry(),
      { pluginName: 'status', requiresLoadedApiPlugin: true, contributions: { banners: [] } },
    ])
    expect(composed.rejected).toEqual([])
    expect(composed.navItems.map((item) => [item.pluginName, item.id])).toEqual([['host-plan', 'billing']])
    expect(composed.panels[0]).toMatchObject({ pluginName: 'host-plan', requiresLoadedApiPlugin: false })
    expect(composed.banners[0]?.pluginName).toBe('host-plan')
  })

  it('drops an invalid plugin entirely but keeps valid ones', () => {
    const bad = validEntry({ pluginName: 'bad-plugin' })
    bad.contributions.banners![0]!.link = { label: 'Go', href: 'javascript:alert(1)' }
    const composed = composeAdminContributions([bad, validEntry()])
    expect(composed.rejected.map((r) => r.pluginName)).toEqual(['bad-plugin'])
    expect(composed.navItems.every((item) => item.pluginName === 'host-plan')).toBe(true)
    expect(composed.banners).toHaveLength(1)
  })

  it('rejects both entries when a plugin name is listed twice', () => {
    const composed = composeAdminContributions([validEntry(), validEntry()])
    expect(composed.navItems).toEqual([])
    expect(composed.rejected).toHaveLength(2)
    expect(composed.rejected[0]?.issues.map((issue) => issue.code)).toContain('DUPLICATE_PLUGIN')
  })

  it('rejects entries that are not objects', () => {
    const composed = composeAdminContributions([null as unknown as TrustedAdminContributionEntry])
    expect(composed.rejected[0]?.issues[0]?.code).toBe('INVALID_SHAPE')
  })
})
