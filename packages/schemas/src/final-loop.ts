import { Type, createSchema } from './typebox'

export const collectionImportPreview = createSchema(
  Type.Object({
    collectionSlug: Type.String({ minLength: 1 }),
    additions: Type.Number({ minimum: 0 }),
    changes: Type.Number({ minimum: 0 }),
    removals: Type.Number({ minimum: 0 }),
    destructiveApply: Type.Boolean(),
  })
)

export const dataPortabilityRoadmap = createSchema(
  Type.Object({
    exportFormats: Type.Array(Type.String({ minLength: 1 })),
    importPreviewRequired: Type.Boolean(),
    destructiveApplyBlocked: Type.Boolean(),
  })
)

export const publicPluginSafetyGate = createSchema(
  Type.Object({
    pluginName: Type.String({ minLength: 1 }),
    publicRoute: Type.String({ minLength: 1 }),
    tenantTests: Type.Boolean(),
    authTests: Type.Boolean(),
    cacheTests: Type.Boolean(),
  })
)

export const publishAutomationGate = createSchema(
  Type.Object({
    packageName: Type.String({ minLength: 1 }),
    dryRunPassed: Type.Boolean(),
    manualApprovalRequired: Type.Boolean(),
  })
)

export const deployedProofGate = createSchema(
  Type.Object({
    url: Type.String({ minLength: 1 }),
    smokePassed: Type.Boolean(),
    perfPassed: Type.Boolean(),
    operatorReceiptRequired: Type.Boolean(),
  })
)

export function isSafeImportPreview(preview: typeof collectionImportPreview.infer): boolean {
  return !preview.destructiveApply
}

export function isPortableRoadmapSafe(roadmap: typeof dataPortabilityRoadmap.infer): boolean {
  return roadmap.importPreviewRequired && roadmap.destructiveApplyBlocked
}

export function canEnablePublicPluginRoute(gate: typeof publicPluginSafetyGate.infer): boolean {
  return gate.tenantTests && gate.authTests && gate.cacheTests
}

export function canPublishPackage(gate: typeof publishAutomationGate.infer): boolean {
  return gate.dryRunPassed && !gate.manualApprovalRequired
}

export function hasDeployedProof(gate: typeof deployedProofGate.infer): boolean {
  return gate.url.startsWith('https://') && gate.smokePassed && gate.perfPassed
}
