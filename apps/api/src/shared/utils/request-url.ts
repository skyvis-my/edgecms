const requestUrlCache = new WeakMap<Request, URL>()

/**
 * Returns a cached WHATWG URL object for the given Request,
 * avoiding repeated URL parsing across middleware and handlers.
 * Stored in a WeakMap so there is zero memory retention after the Request is collected.
 */
export function getRequestUrl(request: Request): URL {
  let url = requestUrlCache.get(request)
  if (!url) {
    url = new URL(request.url)
    requestUrlCache.set(request, url)
  }
  return url
}

/**
 * Returns the pathname for the given Request using the cached URL.
 */
export function getRequestPathname(request: Request): string {
  return getRequestUrl(request).pathname
}

/**
 * Registers an already parsed URL for a Request (e.g. after a rewritten Request is created).
 */
export function cacheRequestUrl(request: Request, url: URL): void {
  requestUrlCache.set(request, url)
}
