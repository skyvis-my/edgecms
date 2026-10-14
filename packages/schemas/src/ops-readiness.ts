import { Type, createSchema } from './typebox'

export const smokeAssetFixture = createSchema(
  Type.Object({
    tenantSlug: Type.String({ minLength: 1 }),
    assetId: Type.String({ minLength: 1 }),
    filename: Type.String({ minLength: 1 }),
    publicPath: Type.String({ minLength: 1 }),
  })
)

export const smokePluginFixture = createSchema(
  Type.Object({
    pluginName: Type.String({ minLength: 1 }),
    enabled: Type.Boolean(),
    trustedOnly: Type.Boolean(),
  })
)

export const checklistItem = createSchema(
  Type.Object({
    id: Type.String({ minLength: 1 }),
    label: Type.String({ minLength: 1 }),
    done: Type.Boolean(),
  })
)

export const publishChecklist = createSchema(
  Type.Object({
    seo: Type.Boolean(),
    locale: Type.Boolean(),
    media: Type.Boolean(),
    schedule: Type.Boolean(),
  })
)

export const autosaveConflictWarning = createSchema(
  Type.Object({
    entryId: Type.String({ minLength: 1 }),
    localVersion: Type.Integer({ minimum: 1 }),
    remoteVersion: Type.Integer({ minimum: 1 }),
  })
)

export const auditLogPolicy = createSchema(
  Type.Object({
    surface: Type.String({ minLength: 1 }),
    redactedFields: Type.Array(Type.String({ minLength: 1 })),
  })
)

export const rateLimitDocsPolicy = createSchema(
  Type.Object({
    surface: Type.Union([
      Type.Literal('public'),
      Type.Literal('admin'),
      Type.Literal('auth'),
    ]),
    windowMs: Type.Number({ minimum: 1 }),
    limit: Type.Number({ minimum: 1 }),
  })
)

export const securityHeaderPolicy = createSchema(
  Type.Object({
    contentSecurityPolicy: Type.String({ minLength: 1 }),
    frameOptions: Type.Union([Type.Literal('DENY'), Type.Literal('SAMEORIGIN')]),
  })
)

export const backupExportPlan = createSchema(
  Type.Object({
    d1Export: Type.Boolean(),
    r2Lifecycle: Type.Boolean(),
    operatorReceiptRequired: Type.Boolean(),
  })
)

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
