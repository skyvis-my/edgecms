export type PublicFetchOptions = {
  baseUrl: string
  tenantSlug: string
  collectionSlug: string
  entrySlug?: string
  locale?: string
  fallbackLocale?: string
}

export function buildPublicReadCacheTags(options: Pick<PublicFetchOptions, 'collectionSlug' | 'locale'>): string[] {
  const tags = [`edgecms:collection:${options.collectionSlug}`]
  if (options.locale) tags.push(`edgecms:locale:${options.locale}`)
  return tags
}

export function buildPublicReadUrl(options: PublicFetchOptions): string {
  const base = options.baseUrl.replace(/\/$/, '')
  const path = options.entrySlug
    ? `/api/tenants/${options.tenantSlug}/api/public/${options.collectionSlug}/${options.entrySlug}`
    : `/api/tenants/${options.tenantSlug}/api/public/${options.collectionSlug}`
  const url = new URL(`${base}${path}`)
  if (options.locale) url.searchParams.set('locale', options.locale)
  if (options.fallbackLocale && options.fallbackLocale !== options.locale) {
    url.searchParams.set('fallbackLocale', options.fallbackLocale)
  }
  return url.toString()
}

export async function fetchPublishedEntry<T>(options: PublicFetchOptions): Promise<T> {
  const response = await fetch(buildPublicReadUrl(options), {
    headers: { accept: 'application/json' },
  })
  if (!response.ok) {
    throw new Error(`EdgeCMS public read failed: ${response.status}`)
  }
  return response.json() as Promise<T>
}
