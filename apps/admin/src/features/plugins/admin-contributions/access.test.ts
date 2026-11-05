import { describe, expect, it } from 'bun:test'
import { composeAdminContributions } from '@edgecms/plugin-sdk'
import { isContributingPluginActive, resolveViewerAccess } from './access'
import { trustedAdminContributionCatalog } from './catalog'
import { hostPlanSampleContributions } from './samples/host-plan-sample'
import { readTenantRoleClaim } from './viewer'

function levels(viewer: Parameters<typeof resolveViewerAccess>[0]) {
  return [...resolveViewerAccess(viewer)].sort()
}

function fakeToken(claims: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${encode({ alg: 'HS256' })}.${encode(claims)}.signature`
}

describe('HS-10 build-time catalog', () => {
  it('ships a catalog that composes with no rejected plugins', () => {
    expect(composeAdminContributions(trustedAdminContributionCatalog).rejected).toEqual([])
  })

  it('keeps the sample host plugin valid', () => {
    const composed = composeAdminContributions([hostPlanSampleContributions])
    expect(composed.rejected).toEqual([])
    expect(composed.navItems).toHaveLength(1)
    expect(composed.panels.map((panel) => panel.slot).sort()).toEqual(['dashboard', 'settings'])
    expect(composed.banners).toHaveLength(1)
  })
})

describe('HS-10 viewer access', () => {
  it('fails closed when the viewer is unknown', () => {
    expect(levels(null)).toEqual([])
  })

  it('gives nothing inside a tenant without a tenant role', () => {
    expect(levels({ globalRole: 'admin', tenantSlug: 'acme', tenantRole: null })).toEqual([])
  })

  it('maps tenant roles like the API tenant admin ability', () => {
    const base = { globalRole: 'viewer', tenantSlug: 'acme' }
    expect(levels({ ...base, tenantRole: 'owner' })).toEqual(['tenant:manage', 'tenant:read', 'tenant:write'])
    expect(levels({ ...base, tenantRole: 'admin' })).toEqual(['tenant:manage', 'tenant:read', 'tenant:write'])
    expect(levels({ ...base, tenantRole: 'editor' })).toEqual(['tenant:read', 'tenant:write'])
    expect(levels({ ...base, tenantRole: 'member' })).toEqual(['tenant:read'])
    expect(levels({ ...base, tenantRole: 'custom-reviewer' })).toEqual(['tenant:read'])
  })

  it('never grants superadmin from a tenant role', () => {
    expect(resolveViewerAccess({ globalRole: 'admin', tenantSlug: 'acme', tenantRole: 'owner' }).has('superadmin')).toBe(false)
  })

  it('grants every level to super-admins', () => {
    expect(levels({ globalRole: 'superadmin', tenantSlug: 'acme', tenantRole: null })).toEqual([
      'superadmin',
      'tenant:manage',
      'tenant:read',
      'tenant:write',
    ])
  })

  it('uses the global role outside a tenant', () => {
    expect(levels({ globalRole: 'viewer', tenantSlug: null, tenantRole: null })).toEqual(['tenant:read'])
    expect(levels({ globalRole: 'admin', tenantSlug: null, tenantRole: null })).toEqual([
      'tenant:manage',
      'tenant:read',
      'tenant:write',
    ])
  })
})

describe('HS-10 plugin enabled state', () => {
  const apiPlugins = [
    { name: 'on', status: 'loaded' as const },
    { name: 'off', status: 'disabled' as const },
    { name: 'bad', status: 'blocked' as const },
  ]

  it('hides plugins the API reports as disabled or blocked', () => {
    expect(isContributingPluginActive('on', false, apiPlugins)).toBe(true)
    expect(isContributingPluginActive('off', false, apiPlugins)).toBe(false)
    expect(isContributingPluginActive('bad', false, apiPlugins)).toBe(false)
  })

  it('shows admin-only plugins unless they require a loaded API plugin', () => {
    expect(isContributingPluginActive('admin-only', false, apiPlugins)).toBe(true)
    expect(isContributingPluginActive('admin-only', true, apiPlugins)).toBe(false)
    expect(isContributingPluginActive('admin-only', true, undefined)).toBe(false)
  })
})

describe('HS-10 tenant role claim', () => {
  it('reads trl only for the matching tenant', () => {
    expect(readTenantRoleClaim(fakeToken({ trl: 'editor', tsl: 'acme' }), 'acme')).toBe('editor')
    expect(readTenantRoleClaim(fakeToken({ trl: 'owner', tsl: 'other' }), 'acme')).toBeNull()
  })

  it('returns null for missing or malformed tokens', () => {
    expect(readTenantRoleClaim(null, 'acme')).toBeNull()
    expect(readTenantRoleClaim('not-a-jwt', 'acme')).toBeNull()
    expect(readTenantRoleClaim('a.@@@.c', 'acme')).toBeNull()
  })
})
