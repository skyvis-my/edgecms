import { cacheRequestUrl, getRequestUrl } from '@/shared/utils/request-url'

const TENANT_CANONICAL_PATH_PATTERN = /^\/api\/tenants\/([^/]+)\/(admin|public)(\/.*)?$/

export function normalizeTenantScopedPath(pathname: string): string {
  if (!pathname.startsWith('/api/tenants/')) {
    return pathname
  }

  const match = TENANT_CANONICAL_PATH_PATTERN.exec(pathname)
  if (!match) {
    return pathname
  }

  const [, tenantSlug, scope, suffix = ''] = match
  return `/api/tenants/${tenantSlug}/api/${scope}${suffix}`
}

export function rewriteTenantScopedRequest(request: Request): Request {
  if (!request.url.includes('/api/tenants/')) {
    return request
  }
  const url = getRequestUrl(request)
  const normalizedPath = normalizeTenantScopedPath(url.pathname)

  if (normalizedPath === url.pathname) {
    return request
  }

  const rewrittenHref = `${url.origin}${normalizedPath}${url.search}`
  const rewrittenUrl = new URL(rewrittenHref)
  const rewrittenRequest = new Request(rewrittenHref, request)
  cacheRequestUrl(rewrittenRequest, rewrittenUrl)
  return rewrittenRequest
}

type RequestEntryPoints = {
  fetch: (request: Request, ...args: unknown[]) => unknown
  handle: (request: Request) => Promise<Response>
}

export function applyTenantPathAliases<T extends RequestEntryPoints>(app: T): T {
  const originalHandle = app.handle.bind(app)
  const originalFetch = app.fetch.bind(app)

  app.handle = ((request: Request) =>
    originalHandle(rewriteTenantScopedRequest(request))) as T['handle']
  app.fetch = ((request: Request, ...args: unknown[]) =>
    originalFetch(rewriteTenantScopedRequest(request), ...args)) as T['fetch']

  return app
}
