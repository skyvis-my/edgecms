import { cacheRequestUrl, getRequestUrl } from '@/shared/utils/request-url'

const TENANT_CANONICAL_PATH_PATTERN = /^\/api\/tenants\/([^/]+)\/(admin|public|graphql)(\/.*)?$/

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
  const ownFetchDesc = Object.getOwnPropertyDescriptor(app, 'fetch')
  const ownHandleDesc = Object.getOwnPropertyDescriptor(app, 'handle')

  const getSuperFetch = (): ((req: Request, ...args: unknown[]) => unknown) => {
    if (ownFetchDesc?.value) {
      return ownFetchDesc.value.bind(app)
    }
    let proto = Object.getPrototypeOf(app)
    while (proto) {
      const desc = Object.getOwnPropertyDescriptor(proto, 'fetch')
      if (desc?.get) {
        return desc.get.call(app)
      }
      proto = Object.getPrototypeOf(proto)
    }
    return (app as unknown as { fetchFn?: (req: Request, ...args: unknown[]) => unknown }).fetchFn ?? (ownFetchDesc?.value ?? app.fetch)
  }

  const getSuperHandle = (): ((req: Request) => Promise<Response>) => {
    if (ownHandleDesc?.value) {
      return ownHandleDesc.value.bind(app)
    }
    let proto = Object.getPrototypeOf(app)
    while (proto) {
      const desc = Object.getOwnPropertyDescriptor(proto, 'handle')
      if (desc?.get) {
        return desc.get.call(app)
      }
      proto = Object.getPrototypeOf(proto)
    }
    return (app as unknown as { _handle?: (req: Request) => Promise<Response> })._handle ?? (ownHandleDesc?.value ?? app.handle)
  }

  Object.defineProperty(app, 'handle', {
    get() {
      const superHandle = getSuperHandle()
      return (request: Request) => superHandle(rewriteTenantScopedRequest(request))
    },
    configurable: true,
  })
  Object.defineProperty(app, 'fetch', {
    get() {
      const superFetch = getSuperFetch()
      return (request: Request, ...args: unknown[]) =>
        superFetch(rewriteTenantScopedRequest(request), ...args)
    },
    configurable: true,
  })

  return app
}
