import { describe, expect, it } from 'bun:test'
import {
  auditLogPolicy,
  autosaveConflictWarning,
  backupExportPlan,
  checklistItem,
  hasAutosaveConflict,
  hasRequiredChecklistItems,
  isChecklistComplete,
  isPublishChecklistReady,
  isRateLimitPolicyDocumented,
  isSmokeFixturePublic,
  isTrustedPluginFixture,
  publishChecklist,
  rateLimitDocsPolicy,
  redactAuditPayload,
  redactsSensitiveAuditFields,
  requiresOperatorBackupReceipt,
  securityHeaderPolicy,
  smokeAssetFixture,
  smokePluginFixture,
} from '../ops-readiness'

describe('@edgecms/schemas ops readiness', () => {
  it('validates smoke asset fixture for public reads', () => {
    const fixture = smokeAssetFixture({
      tenantSlug: 'smoke',
      assetId: 'asset-1',
      filename: 'hero.png',
      publicPath: '/api/tenants/smoke/api/public/assets/asset-1/original/png',
    })

    expect(isSmokeFixturePublic(fixture)).toBe(true)
  })

  it('validates trusted smoke plugin fixture', () => {
    const fixture = smokePluginFixture({
      pluginName: 'audit-trace',
      enabled: true,
      trustedOnly: true,
    })

    expect(isTrustedPluginFixture(fixture)).toBe(true)
  })

  it('validates onboarding and content model checklists', () => {
    const items = [
      checklistItem({ id: 'tenant', label: 'Confirm tenant', done: true }),
      checklistItem({ id: 'create-collection', label: 'Create collection', done: true }),
      checklistItem({ id: 'create-entry', label: 'Create entry', done: true }),
      checklistItem({ id: 'publish-entry', label: 'Publish entry', done: true }),
      checklistItem({ id: 'public-read', label: 'Read public entry', done: true }),
    ]

    expect(isChecklistComplete(items)).toBe(true)
    expect(
      hasRequiredChecklistItems(items, [
        'tenant',
        'create-collection',
        'create-entry',
        'publish-entry',
        'public-read',
      ])
    ).toBe(true)
  })

  it('validates publish readiness checklist before content goes live', () => {
    const checklist = publishChecklist({
      seo: true,
      locale: true,
      media: true,
      schedule: true,
    })

    expect(isPublishChecklistReady(checklist)).toBe(true)
    expect(isPublishChecklistReady({ ...checklist, media: false })).toBe(false)
  })

  it('detects autosave version conflicts', () => {
    const warning = autosaveConflictWarning({
      entryId: 'entry-1',
      localVersion: 2,
      remoteVersion: 3,
    })

    expect(hasAutosaveConflict(warning)).toBe(true)
  })

  it('validates public-safe audit log redaction', () => {
    const policy = auditLogPolicy({
      surface: 'commands',
      redactedFields: ['password', 'token', 'secret', 'tenantId', 'tenantSlug'],
    })

    expect(redactsSensitiveAuditFields(policy)).toBe(true)
    expect(
      redactAuditPayload(
        {
          action: 'asset.upload',
          tenantSlug: 'acme',
          token: 'secret-token',
        },
        policy
      )
    ).toEqual({
      action: 'asset.upload',
      tenantSlug: '[redacted]',
      token: '[redacted]',
    })
  })

  it('validates rate limit docs policy', () => {
    const policy = rateLimitDocsPolicy({
      surface: 'public',
      windowMs: 60_000,
      limit: 300,
    })

    expect(policy.limit).toBe(300)
    expect(isRateLimitPolicyDocumented(policy)).toBe(true)
  })

  it('validates CSP/security header policy', () => {
    const policy = securityHeaderPolicy({
      contentSecurityPolicy: "default-src 'self'",
      frameOptions: 'DENY',
    })

    expect(policy.frameOptions).toBe('DENY')
  })

  it('validates backup/export operator receipt requirement', () => {
    const plan = backupExportPlan({
      d1Export: true,
      r2Lifecycle: true,
      operatorReceiptRequired: true,
    })

    expect(requiresOperatorBackupReceipt(plan)).toBe(true)
  })
})
