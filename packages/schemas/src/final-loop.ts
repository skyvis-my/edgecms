import { type } from 'arktype'

export const collectionImportPreview = type({
  collectionSlug: 'string > 0',
  additions: 'number >= 0',
  changes: 'number >= 0',
  removals: 'number >= 0',
  destructiveApply: 'boolean',
})

export const dataPortabilityRoadmap = type({
  exportFormats: type('string > 0').array(),
  importPreviewRequired: 'boolean',
  destructiveApplyBlocked: 'boolean',
})

export const publicPluginSafetyGate = type({
  pluginName: 'string > 0',
  publicRoute: 'string > 0',
  tenantTests: 'boolean',
  authTests: 'boolean',
  cacheTests: 'boolean',
})

export const publishAutomationGate = type({
  packageName: 'string > 0',
  dryRunPassed: 'boolean',
  manualApprovalRequired: 'boolean',
})

export const deployedProofGate = type({
  url: 'string > 0',
  smokePassed: 'boolean',
  perfPassed: 'boolean',
  operatorReceiptRequired: 'boolean',
})

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
