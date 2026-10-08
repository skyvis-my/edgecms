import { describe, expect, it } from 'bun:test'
import {
  adminPluginPanelState,
  blocksColdStartClaimWithoutRemoteProof,
  blocksPluginPublishWithoutApproval,
  examplePluginContract,
  hasTrustedManifestSafetyProof,
  isAdminPluginRoute,
  isHookTimeoutWithinBudget,
  isRemotePerfReceiptComplete,
  isTrustedManifest,
  keepsPluginAdminOnly,
  pluginHealthRoute,
  pluginHookTimeoutPolicy,
  pluginSdkReleaseGate,
  remotePerfReceipt,
  trustedPluginManifest,
  trustedPluginManifestSafety,
} from '../plugin-release'

describe('@edgecms/schemas plugin release', () => {
  it('validates deployed remote performance receipt shape', () => {
    const receipt = remotePerfReceipt({
      url: 'https://edgecms.example.test',
      path: '/api/tenants/acme/api/public/posts/hello-world',
      measuredAt: '2026-06-08T00:00:00.000Z',
      p95Ms: 92,
      proof: 'deployed',
    })

    expect(isRemotePerfReceiptComplete(receipt)).toBe(true)
  })

  it('blocks cold-start claims without remote proof', () => {
    expect(blocksColdStartClaimWithoutRemoteProof()).toBe(true)
  })

  it('validates trusted plugin manifests', () => {
    const manifest = trustedPluginManifest({
      name: 'audit-trace',
      enabled: true,
      source: 'trusted_catalog',
    })

    expect(isTrustedManifest(manifest)).toBe(true)
  })

  it('validates trusted manifest permissions and hook timeout safety', () => {
    const manifest = trustedPluginManifestSafety({
      name: 'audit-trace',
      enabled: true,
      source: 'trusted_catalog',
      permissions: ['audit:read'],
      hookTimeoutMs: 100,
    })

    expect(hasTrustedManifestSafetyProof(manifest)).toBe(true)
    expect(hasTrustedManifestSafetyProof({ ...manifest, hookTimeoutMs: 500 })).toBe(false)
  })

  it('validates hook timeout policy', () => {
    const policy = pluginHookTimeoutPolicy({
      hook: 'beforeCommand',
      timeoutMs: 50,
    })

    expect(policy.timeoutMs).toBe(50)
    expect(isHookTimeoutWithinBudget(policy)).toBe(true)
    expect(isHookTimeoutWithinBudget(pluginHookTimeoutPolicy({ hook: 'afterCommand', timeoutMs: 500 }))).toBe(false)
  })

  it('validates admin-only plugin health route', () => {
    const route = pluginHealthRoute({
      pluginName: 'audit-trace',
      kind: 'admin',
      path: '/api/admin/plugins/audit-trace/health',
    })

    expect(isAdminPluginRoute(route)).toBe(true)
  })

  it('validates audit-trace plugin contract', () => {
    const plugin = examplePluginContract({
      name: 'audit-trace',
      category: 'operations',
      adminOnly: true,
      publicRoutes: 0,
    })

    expect(keepsPluginAdminOnly(plugin)).toBe(true)
  })

  it('validates SEO metadata plugin contract', () => {
    const plugin = examplePluginContract({
      name: 'seo-metadata',
      category: 'content',
      adminOnly: true,
      publicRoutes: 0,
    })

    expect(keepsPluginAdminOnly(plugin)).toBe(true)
  })

  it('validates plugin SDK release gate', () => {
    const gate = pluginSdkReleaseGate({
      packageName: '@edgecms/plugin-sdk',
      private: true,
      checkScript: 'bun run --filter @edgecms/plugin-sdk check',
    })

    expect(gate.private).toBe(true)
    expect(blocksPluginPublishWithoutApproval(gate)).toBe(true)
  })

  it('validates admin plugin panel states', () => {
    expect(adminPluginPanelState('loaded')).toBe('loaded')
    expect(adminPluginPanelState('disabled')).toBe('disabled')
    expect(adminPluginPanelState('blocked')).toBe('blocked')
  })
})
