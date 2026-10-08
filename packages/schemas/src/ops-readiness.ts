import { type } from 'arktype'

export const smokeAssetFixture = type({
  tenantSlug: 'string > 0',
  assetId: 'string > 0',
  filename: 'string > 0',
  publicPath: 'string > 0',
})

export const smokePluginFixture = type({
  pluginName: 'string > 0',
  enabled: 'boolean',
  trustedOnly: 'boolean',
})

export const checklistItem = type({
  id: 'string > 0',
  label: 'string > 0',
  done: 'boolean',
})

export const publishChecklist = type({
  seo: 'boolean',
  locale: 'boolean',
  media: 'boolean',
  schedule: 'boolean',
})

export const autosaveConflictWarning = type({
  entryId: 'string > 0',
  localVersion: 'number.integer >= 1',
  remoteVersion: 'number.integer >= 1',
})

export const auditLogPolicy = type({
  surface: 'string > 0',
  redactedFields: type('string > 0').array(),
})

export const rateLimitDocsPolicy = type({
  surface: "'public' | 'admin' | 'auth'",
  windowMs: 'number > 0',
  limit: 'number > 0',
})

export const securityHeaderPolicy = type({
  contentSecurityPolicy: 'string > 0',
  frameOptions: "'DENY' | 'SAMEORIGIN'",
})

export const backupExportPlan = type({
  d1Export: 'boolean',
  r2Lifecycle: 'boolean',
  operatorReceiptRequired: 'boolean',
})

export function isSmokeFixturePublic(asset: typeof smokeAssetFixture.infer): boolean {
  return asset.publicPath.startsWith('/api/tenants/')
}

export function isTrustedPluginFixture(fixture: typeof smokePluginFixture.infer): boolean {
  return fixture.trustedOnly && fixture.enabled
}

export function isChecklistComplete(items: Array<typeof checklistItem.infer>): boolean {
  return items.length > 0 && items.every((item) => item.done)
}

export function hasRequiredChecklistItems(
  items: Array<typeof checklistItem.infer>,
  requiredIds: string[]
): boolean {
  const completedIds = new Set(items.filter((item) => item.done).map((item) => item.id))
  return requiredIds.every((id) => completedIds.has(id))
}

export function isPublishChecklistReady(checklist: typeof publishChecklist.infer): boolean {
  return checklist.seo && checklist.locale && checklist.media && checklist.schedule
}

export function hasAutosaveConflict(warning: typeof autosaveConflictWarning.infer): boolean {
  return warning.remoteVersion > warning.localVersion
}

export function redactsSensitiveAuditFields(policy: typeof auditLogPolicy.infer): boolean {
  return ['password', 'token', 'secret', 'tenantId', 'tenantSlug'].every((field) =>
    policy.redactedFields.includes(field)
  )
}

export function redactAuditPayload(
  payload: Record<string, unknown>,
  policy: typeof auditLogPolicy.infer
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(payload).map(([key, value]) => [
      key,
      policy.redactedFields.includes(key) ? '[redacted]' : value,
    ])
  )
}

export function isRateLimitPolicyDocumented(policy: typeof rateLimitDocsPolicy.infer): boolean {
  return policy.windowMs > 0 && policy.limit > 0
}

export function requiresOperatorBackupReceipt(plan: typeof backupExportPlan.infer): boolean {
  return plan.d1Export && plan.r2Lifecycle && plan.operatorReceiptRequired
}
