import { Type, createSchema } from './typebox'

export const localeFallbackPolicy = createSchema(
  Type.Object({
    tenantSlug: Type.String({ minLength: 1 }),
    requestedLocale: Type.String({ minLength: 1 }),
    fallbackLocale: Type.String({ minLength: 1 }),
    fallbackEnabled: Type.Boolean(),
  })
)

export const localeCompletenessRow = createSchema(
  Type.Object({
    locale: Type.String({ minLength: 1 }),
    requiredFields: Type.Array(Type.String({ minLength: 1 })),
    missingFields: Type.Array(Type.String({ minLength: 1 })),
  })
)

export const localeCacheKeyParts = createSchema(
  Type.Object({
    tenantSlug: Type.String({ minLength: 1 }),
    collectionSlug: Type.String({ minLength: 1 }),
    requestedLocale: Type.String({ minLength: 1 }),
    status: Type.Literal('published'),
    filterHash: Type.String({ minLength: 1 }),
  })
)

export const publicFilterAllowlist = createSchema(
  Type.Object({
    topLevelFields: Type.Array(Type.String({ minLength: 1 })),
    dataFieldPattern: Type.String({ minLength: 1 }),
  })
)

export const revalidationPayloadContract = createSchema(
  Type.Object({
    tenantSlug: Type.String({ minLength: 1 }),
    collectionSlug: Type.String({ minLength: 1 }),
    event: Type.String({ minLength: 1 }),
    paths: Type.Array(Type.String({ minLength: 1 })),
    tags: Type.Array(Type.String({ minLength: 1 })),
  })
)

export const publicCacheTagParts = createSchema(
  Type.Object({
    collectionSlug: Type.String({ minLength: 1 }),
    locale: Type.String({ minLength: 1 }),
    entryId: Type.Optional(Type.String({ minLength: 1 })),
  })
)

export const publicReadPerfFixture = createSchema(
  Type.Object({
    path: Type.String({ minLength: 1 }),
    tenantSlug: Type.String({ minLength: 1 }),
    collectionSlug: Type.String({ minLength: 1 }),
    entrySlug: Type.String({ minLength: 1 }),
  })
)

export const publicReadPerfThreshold = createSchema(
  Type.Object({
    mode: Type.Union([Type.Literal('local'), Type.Literal('remote')]),
    p95Ms: Type.Number({ minimum: 0 }),
    thresholdMs: Type.Number({ minimum: 1 }),
  })
)

export type LocaleFallbackPolicy = typeof localeFallbackPolicy.infer
export type LocaleCompletenessRow = typeof localeCompletenessRow.infer
export type LocaleCacheKeyParts = typeof localeCacheKeyParts.infer

export function shouldFallbackLocale(policy: LocaleFallbackPolicy): boolean {
  return policy.fallbackEnabled && policy.requestedLocale !== policy.fallbackLocale
}

export function resolvePublicReadLocale(
  policy: LocaleFallbackPolicy,
  availableLocales: string[]
): string | null {
  if (availableLocales.includes(policy.requestedLocale)) return policy.requestedLocale
  if (shouldFallbackLocale(policy) && availableLocales.includes(policy.fallbackLocale)) {
    return policy.fallbackLocale
  }
  return null
}

export function isLocaleComplete(row: LocaleCompletenessRow): boolean {
  return row.missingFields.length === 0
}

export function missingRequiredLocalizedFields(
  requiredFields: string[],
  localizedData: Record<string, unknown>
): string[] {
  return requiredFields.filter((field) => localizedData[field] === undefined || localizedData[field] === null)
}

export function buildLocaleCompletenessMatrix(
  requiredFields: string[],
  localizedByLocale: Record<string, Record<string, unknown>>
): LocaleCompletenessRow[] {
  return Object.entries(localizedByLocale).map(([locale, localizedData]) => ({
    locale,
    requiredFields,
    missingFields: missingRequiredLocalizedFields(requiredFields, localizedData),
  }))
}

export function hasLocalizedRequiredFieldGaps(rows: LocaleCompletenessRow[]): boolean {
  return rows.some((row) => !isLocaleComplete(row))
}

export function buildLocaleCacheKey(parts: LocaleCacheKeyParts): string {
  return [
    'public-read',
    `tenant:${parts.tenantSlug}`,
    `collection:${parts.collectionSlug}`,
    `locale:${parts.requestedLocale}`,
    `status:${parts.status}`,
    `filters:${parts.filterHash}`,
  ].join('|')
}

export function isAllowedPublicFilter(
  allowlist: typeof publicFilterAllowlist.infer,
  field: string
): boolean {
  return allowlist.topLevelFields.includes(field) || new RegExp(allowlist.dataFieldPattern).test(field)
}

export function rejectsUnsupportedPublicFilter(
  allowlist: typeof publicFilterAllowlist.infer,
  field: string
): boolean {
  return !isAllowedPublicFilter(allowlist, field)
}

export function hasRevalidationTarget(payload: typeof revalidationPayloadContract.infer): boolean {
  return payload.paths.length > 0 || payload.tags.length > 0
}

export function buildRevalidationTargets(payload: typeof revalidationPayloadContract.infer): {
  tenantSlug: string
  collectionSlug: string
  paths: string[]
  tags: string[]
} {
  return {
    tenantSlug: payload.tenantSlug,
    collectionSlug: payload.collectionSlug,
    paths: payload.paths,
    tags: payload.tags,
  }
}

export function buildPublicCacheTags(parts: typeof publicCacheTagParts.infer): string[] {
  const tags = [`collection:${parts.collectionSlug}`, `locale:${parts.locale}`]
  if (parts.entryId) tags.push(`entry:${parts.entryId}`)
  return tags
}

export function meetsPublicReadThreshold(result: typeof publicReadPerfThreshold.infer): boolean {
  return result.p95Ms <= result.thresholdMs
}
