import { describe, expect, it } from 'bun:test'
import {
  canEnablePublicPluginRoute,
  canPublishPackage,
  collectionImportPreview,
  dataPortabilityRoadmap,
  deployedProofGate,
  hasDeployedProof,
  isPortableRoadmapSafe,
  isSafeImportPreview,
  publicPluginSafetyGate,
  publishAutomationGate,
} from '../final-loop'

describe('@edgecms/schemas final loop gates', () => {
  it('validates non-destructive collection import preview', () => {
    const preview = collectionImportPreview({
      collectionSlug: 'posts',
      additions: 2,
      changes: 1,
      removals: 0,
      destructiveApply: false,
    })

    expect(isSafeImportPreview(preview)).toBe(true)
  })

  it('rejects destructive collection import apply from preview proof', () => {
    const preview = collectionImportPreview({
      collectionSlug: 'posts',
      additions: 0,
      changes: 1,
      removals: 1,
      destructiveApply: true,
    })

    expect(isSafeImportPreview(preview)).toBe(false)
  })

  it('validates data portability roadmap safety rules', () => {
    const roadmap = dataPortabilityRoadmap({
      exportFormats: ['json', 'typescript'],
      importPreviewRequired: true,
      destructiveApplyBlocked: true,
    })

    expect(isPortableRoadmapSafe(roadmap)).toBe(true)
  })

  it('keeps public plugin route blocked until tenant auth cache tests exist', () => {
    const gate = publicPluginSafetyGate({
      pluginName: 'form-capture',
      publicRoute: '/api/public/plugins/form-capture/submit',
      tenantTests: true,
      authTests: false,
      cacheTests: true,
    })

    expect(canEnablePublicPluginRoute(gate)).toBe(false)
  })

  it('keeps package publish blocked when manual approval is required', () => {
    const gate = publishAutomationGate({
      packageName: 'create-edgecms-app',
      dryRunPassed: true,
      manualApprovalRequired: true,
    })

    expect(canPublishPackage(gate)).toBe(false)
  })

  it('keeps deployed proof incomplete without smoke and perf pass', () => {
    const gate = deployedProofGate({
      url: 'https://edgecms.example.test',
      smokePassed: true,
      perfPassed: false,
      operatorReceiptRequired: true,
    })

    expect(hasDeployedProof(gate)).toBe(false)
  })
})
