const TENANT_PATH_PREFIX = '/api/tenants/'

export function extractTenantSlug(pathname: string): string | undefined {
  if (!pathname.startsWith(TENANT_PATH_PREFIX)) return undefined
  const start = TENANT_PATH_PREFIX.length
  const slashIndex = pathname.indexOf('/', start)
  const slug = slashIndex === -1 ? pathname.slice(start) : pathname.slice(start, slashIndex)
  return slug || undefined
}
