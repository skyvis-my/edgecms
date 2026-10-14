import { cacheRequestUrl, getRequestUrl } from '@/shared/utils/request-url'

type RequestEntryPoints = {
  fetch: (request: Request, ...args: unknown[]) => unknown
  handle: (request: Request) => Promise<Response>
}

function rewriteAssetPath(pathname: string): string {
  if (!pathname.includes('/assets/')) return pathname
  const parts = pathname.split('/')

  // /api/public/assets/:assetId/:variant.:format
  if (parts.length === 6 && parts[1] === 'api' && parts[2] === 'public' && parts[3] === 'assets') {
    const last = parts[5] ?? ''
    const lastDot = last.lastIndexOf('.')
    if (lastDot > 0 && lastDot < last.length - 1) {
      const variant = last.slice(0, lastDot)
      const format = last.slice(lastDot + 1)
      return `/api/public/assets/${parts[4] ?? ''}/${variant}/${format}`
    }
  }

  // /api/tenants/:tenantSlug/public/assets/:assetId/:variant.:format
  if (
    parts.length === 8 &&
    parts[1] === 'api' &&
    parts[2] === 'tenants' &&
    parts[4] === 'public' &&
    parts[5] === 'assets'
  ) {
    const last = parts[7] ?? ''
    const lastDot = last.lastIndexOf('.')
    if (lastDot > 0 && lastDot < last.length - 1) {
      const variant = last.slice(0, lastDot)
      const format = last.slice(lastDot + 1)
      return `/api/tenants/${parts[3] ?? ''}/public/assets/${parts[6] ?? ''}/${variant}/${format}`
    }
  }

  // /api/tenants/:tenantSlug/api/public/assets/:assetId/:variant.:format
  if (
    parts.length === 9 &&
    parts[1] === 'api' &&
    parts[2] === 'tenants' &&
    parts[4] === 'api' &&
    parts[5] === 'public' &&
    parts[6] === 'assets'
  ) {
    const last = parts[8] ?? ''
    const lastDot = last.lastIndexOf('.')
    if (lastDot > 0 && lastDot < last.length - 1) {
      const variant = last.slice(0, lastDot)
      const format = last.slice(lastDot + 1)
      return `/api/tenants/${parts[3] ?? ''}/api/public/assets/${parts[7] ?? ''}/${variant}/${format}`
    }
  }

  return pathname
}

export function rewritePublicAssetFormatRequest(request: Request): Request {
  if (!request.url.includes('/assets/')) return request
  const url = getRequestUrl(request)
  const rewritten = rewriteAssetPath(url.pathname)
  if (rewritten === url.pathname) return request
  const rewrittenHref = `${url.origin}${rewritten}${url.search}`
  const rewrittenUrl = new URL(rewrittenHref)
  const rewrittenRequest = new Request(rewrittenHref, request)
  cacheRequestUrl(rewrittenRequest, rewrittenUrl)
  return rewrittenRequest
}

export function applyPublicAssetFormatAliases<T extends RequestEntryPoints>(app: T): T {
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
      return (request: Request) => superHandle(rewritePublicAssetFormatRequest(request))
    },
    configurable: true,
  })
  Object.defineProperty(app, 'fetch', {
    get() {
      const superFetch = getSuperFetch()
      return (request: Request, ...args: unknown[]) =>
        superFetch(rewritePublicAssetFormatRequest(request), ...args)
    },
    configurable: true,
  })

  return app
}
