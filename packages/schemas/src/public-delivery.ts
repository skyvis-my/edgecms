import { type } from 'arktype'

export const localeFallbackPolicy = type({
  tenantSlug: 'string > 0',
  requestedLocale: 'string > 0',
  fallbackLocale: 'string > 0',
  fallbackEnabled: 'boolean',
})

export const localeCompletenessRow = type({
  locale: 'string > 0',
  requiredFields: type('string > 0').array(),
  missingFields: type('string > 0').array(),
})

export const localeCacheKeyParts = type({
  tenantSlug: 'string > 0',
  collectionSlug: 'string > 0',
  requestedLocale: 'string > 0',
  status: "'published'",
  filterHash: 'string > 0',
})

export const publicFilterAllowlist = type({
  topLevelFields: type('string > 0').array(),
  dataFieldPattern: 'string > 0',
})

export const revalidationPayloadContract = type({
  tenantSlug: 'string > 0',
  collectionSlug: 'string > 0',
  event: 'string > 0',
  paths: type('string > 0').array(),
  tags: type('string > 0').array(),
})

export const publicCacheTagParts = type({
  collectionSlug: 'string > 0',
  locale: 'string > 0',
  'entryId?': 'string > 0',
})

export const publicReadPerfFixture = type({
  path: 'string > 0',
  tenantSlug: 'string > 0',
  collectionSlug: 'string > 0',
  entrySlug: 'string > 0',
})

export const publicReadPerfThreshold = type({
  mode: "'local' | 'remote'",
  p95Ms: 'number >= 0',
  thresholdMs: 'number > 0',
})

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
