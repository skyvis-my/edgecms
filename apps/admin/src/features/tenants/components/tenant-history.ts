export type TenantHistoryItem = {
  path: string
  label: string
  timestamp: string
}

const MAX_HISTORY_ITEMS = 5
const TENANT_SLUG_PATTERN = /^[a-z0-9-]+$/
const KNOWN_ROUTE_ROOTS = new Set([
  'admin',
  'collections',
  'entries',
  'media',
  'publishing',
  'settings',
  'sync',
  'tenants',
  'users',
  'webhooks',
])

export function getTenantHistoryStorageKey(tenantSlug: string | null): string {
  return `edgecms:tenant-history:${tenantSlug ?? 'global'}`
}

export function buildHistoryLabel(path: string): string {
  if (path === '/') return 'Dashboard'

  const [pathname] = path.split('?')
  const rawSegments = pathname.split('/').filter(Boolean)
  const pathTenantSlug = getTenantSlugFromPathname(pathname)
  const routeSegments = pathTenantSlug ? rawSegments.slice(1) : rawSegments
  const segments = routeSegments.filter((segment) => segment !== 'tenants' && segment !== 'admin')
  const lastSegment = segments[segments.length - 1]
  if (!lastSegment) return 'Dashboard'

  return lastSegment.replace(/[-_]/g, ' ').replace(/\b\w/g, (match) => match.toUpperCase())
}

function getSafeStorage(): Storage | undefined {
  try {
    if (typeof window !== 'undefined' && 'localStorage' in window && window.localStorage) {
      return window.localStorage
    }
  } catch {
    // Storage access restricted or denied
  }
  return undefined
}

export function extractTenantSlugFromHistoryPath(path: string): string | null {
  const [pathname] = path.split('?')
  return getTenantSlugFromPathname(pathname)
}

export function readTenantHistory(
  storageKey: string,
  storage: Pick<Storage, 'getItem'> | undefined = getSafeStorage()
): TenantHistoryItem[] {
  if (!storage) return []
  try {
    const raw = storage.getItem(storageKey)
    if (!raw) return []
    const parsed = JSON.parse(raw) as TenantHistoryItem[]
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (item) =>
          typeof item === 'object' &&
          item !== null &&
          typeof item.path === 'string' &&
          typeof item.label === 'string' &&
          typeof item.timestamp === 'string'
      )
      .map((item) => ({
        ...item,
        path: normalizeTenantHistoryPath(item.path),
      }))
  } catch {
    return []
  }
}

export function recordTenantHistory(
  storageKey: string,
  path: string,
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = getSafeStorage(),
  tenantSlug: string | null = null
): TenantHistoryItem[] {
  if (!storage) return []

  const normalizedPath = resolveHistoryPathForTenant(path, tenantSlug)
  const nextItem: TenantHistoryItem = {
    path: normalizedPath,
    label: buildHistoryLabel(normalizedPath),
    timestamp: new Date().toISOString(),
  }

  const existing = readTenantHistory(storageKey, storage)
  const deduped = existing.filter((item) => item.path !== normalizedPath)
  const nextHistory = [nextItem, ...deduped].slice(0, MAX_HISTORY_ITEMS)
  try {
    storage.setItem(storageKey, JSON.stringify(nextHistory))
  } catch {
    // ignore storage write errors
  }
  return nextHistory
}

export function removeTenantHistoryItem(
  storageKey: string,
  path: string,
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = getSafeStorage()
): TenantHistoryItem[] {
  if (!storage) return []
  const existing = readTenantHistory(storageKey, storage)
  const nextHistory = existing.filter((item) => item.path !== path)
  try {
    storage.setItem(storageKey, JSON.stringify(nextHistory))
  } catch {
    // ignore storage write errors
  }
  return nextHistory
}

export function resolveHistoryPathForTenant(path: string, tenantSlug: string | null): string {
  if (!tenantSlug) return path

  const [pathname, hashFragment = ''] = path.split('#')
  const [routePath, queryString = ''] = pathname.split('?')
  const normalizedRoutePath = routePath.startsWith('/') ? routePath : `/${routePath}`
  const canonicalPrefix = `/tenants/${tenantSlug}`
  const existingTenantSlug = getTenantSlugFromPathname(normalizedRoutePath)
  const pathWithTenant =
    normalizedRoutePath === '/'
      ? canonicalPrefix
      : normalizedRoutePath.startsWith('/tenants/')
        ? normalizedRoutePath.replace(
            `/tenants/${existingTenantSlug ?? tenantSlug}`,
            canonicalPrefix
          )
        : `${canonicalPrefix}${normalizedRoutePath}`
  const nextQuery = queryString ? `?${queryString}` : ''
  const hash = hashFragment ? `#${hashFragment}` : ''
  return `${pathWithTenant}${nextQuery}${hash}`
}

function normalizeTenantHistoryPath(path: string): string {
  const [pathname, hashFragment = ''] = path.split('#')
  const [routePath, queryString = ''] = pathname.split('?')
  const rawSegments = routePath.split('/').filter(Boolean)
  const firstSegment = rawSegments[0] ?? null
  const secondSegment = rawSegments[1] ?? null

  if (
    firstSegment === 'tenants' ||
    !firstSegment ||
    !secondSegment ||
    KNOWN_ROUTE_ROOTS.has(firstSegment) ||
    !TENANT_SLUG_PATTERN.test(firstSegment)
  ) {
    return path
  }

  const remainder = rawSegments.slice(1).join('/')
  const canonicalPath = remainder
    ? `/tenants/${firstSegment}/${remainder}`
    : `/tenants/${firstSegment}`
  const nextQuery = queryString ? `?${queryString}` : ''
  const hash = hashFragment ? `#${hashFragment}` : ''
  return `${canonicalPath}${nextQuery}${hash}`
}

function getTenantSlugFromPathname(pathname: string): string | null {
  const rawSegments = pathname.split('/').filter(Boolean)
  const firstSegment = rawSegments[0] ?? null
  const secondSegment = rawSegments[1] ?? null
  if (!firstSegment) return null
  if (firstSegment === 'tenants' && secondSegment && TENANT_SLUG_PATTERN.test(secondSegment)) {
    return secondSegment
  }
  if (rawSegments.length <= 1) return null
  return KNOWN_ROUTE_ROOTS.has(firstSegment) ? null : firstSegment
}
