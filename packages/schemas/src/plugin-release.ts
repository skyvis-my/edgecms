import { Type, createSchema } from './typebox'

export const remotePerfReceipt = createSchema(
  Type.Object({
    url: Type.String({ minLength: 1 }),
    path: Type.String({ minLength: 1 }),
    measuredAt: Type.String({ minLength: 1 }),
    p95Ms: Type.Number({ minimum: 0 }),
    proof: Type.Literal('deployed'),
  })
)

export const trustedPluginManifest = createSchema(
  Type.Object({
    name: Type.String({ minLength: 1 }),
    enabled: Type.Boolean(),
    source: Type.Literal('trusted_catalog'),
  })
)

export const trustedPluginManifestSafety = createSchema(
  Type.Object({
    name: Type.String({ minLength: 1 }),
    enabled: Type.Boolean(),
    source: Type.Literal('trusted_catalog'),
    permissions: Type.Array(Type.String({ minLength: 1 })),
    hookTimeoutMs: Type.Integer({ minimum: 1 }),
  })
)

export const pluginHookTimeoutPolicy = createSchema(
  Type.Object({
    hook: Type.Union([
      Type.Literal('beforeCommand'),
      Type.Literal('afterCommand'),
      Type.Literal('beforeAiCommand'),
    ]),
    timeoutMs: Type.Integer({ minimum: 1 }),
  })
)

export const pluginHealthRoute = createSchema(
  Type.Object({
    pluginName: Type.String({ minLength: 1 }),
    kind: Type.Literal('admin'),
    path: Type.String({ minLength: 1 }),
  })
)

export const examplePluginContract = createSchema(
  Type.Object({
    name: Type.String({ minLength: 1 }),
    category: Type.String({ minLength: 1 }),
    adminOnly: Type.Boolean(),
    publicRoutes: Type.Integer({ minimum: 0 }),
  })
)

export const pluginSdkReleaseGate = createSchema(
  Type.Object({
    packageName: Type.Literal('@edgecms/plugin-sdk'),
    private: Type.Boolean(),
    checkScript: Type.String({ minLength: 1 }),
  })
)

export const adminPluginPanelState = createSchema(
  Type.Union([
    Type.Literal('loaded'),
    Type.Literal('disabled'),
    Type.Literal('blocked'),
  ])
)

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
