import { type } from 'arktype'

export const remotePerfReceipt = type({
  url: 'string > 0',
  path: 'string > 0',
  measuredAt: 'string > 0',
  p95Ms: 'number >= 0',
  proof: "'deployed'",
})

export const trustedPluginManifest = type({
  name: 'string > 0',
  enabled: 'boolean',
  source: "'trusted_catalog'",
})

export const trustedPluginManifestSafety = type({
  name: 'string > 0',
  enabled: 'boolean',
  source: "'trusted_catalog'",
  permissions: type('string > 0').array(),
  hookTimeoutMs: 'number >= 1',
})

export const pluginHookTimeoutPolicy = type({
  hook: "'beforeCommand' | 'afterCommand' | 'beforeAiCommand'",
  timeoutMs: 'number >= 1',
})

export const pluginHealthRoute = type({
  pluginName: 'string > 0',
  kind: "'admin'",
  path: 'string > 0',
})

export const examplePluginContract = type({
  name: 'string > 0',
  category: 'string > 0',
  adminOnly: 'boolean',
  publicRoutes: 'number >= 0',
})

export const pluginSdkReleaseGate = type({
  packageName: "'@edgecms/plugin-sdk'",
  private: 'boolean',
  checkScript: 'string > 0',
})

export const adminPluginPanelState = type("'loaded' | 'disabled' | 'blocked'")

export function isRemotePerfReceiptComplete(receipt: typeof remotePerfReceipt.infer): boolean {
  return receipt.proof === 'deployed' && receipt.url.startsWith('https://') && receipt.path.startsWith('/')
}

export function isTrustedManifest(manifest: typeof trustedPluginManifest.infer): boolean {
  return manifest.source === 'trusted_catalog'
}

export function hasTrustedManifestSafetyProof(
  manifest: typeof trustedPluginManifestSafety.infer,
  budgetMs = 250
): boolean {
  return manifest.enabled && manifest.source === 'trusted_catalog' && manifest.permissions.length > 0 && manifest.hookTimeoutMs <= budgetMs
}

export function isHookTimeoutWithinBudget(
  policy: typeof pluginHookTimeoutPolicy.infer,
  budgetMs = 250
): boolean {
  return policy.timeoutMs <= budgetMs
}

export function isAdminPluginRoute(route: typeof pluginHealthRoute.infer): boolean {
  return route.kind === 'admin' && route.path.startsWith(`/api/admin/plugins/${route.pluginName}/`)
}

export function keepsPluginAdminOnly(plugin: typeof examplePluginContract.infer): boolean {
  return plugin.adminOnly && plugin.publicRoutes === 0
}

export function blocksPluginPublishWithoutApproval(gate: typeof pluginSdkReleaseGate.infer): boolean {
  return gate.private && gate.checkScript.length > 0
}

export function blocksColdStartClaimWithoutRemoteProof(receipt?: typeof remotePerfReceipt.infer): boolean {
  return !receipt
}
