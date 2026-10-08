const requestSessionCache = new WeakMap<Request, Promise<any>>()

/**
 * Deduplicates session resolution across multiple middlewares/macros in the same request.
 * Returns the same Promise if already resolving or resolved for this Request.
 */
export async function getSessionForRequest(
  auth: { api: { getSession: (args: { headers: Headers }) => Promise<any> } },
  request: Request
): Promise<any> {
  const cached = requestSessionCache.get(request)
  if (cached) return cached
  const sessionPromise = auth.api.getSession({ headers: request.headers })
  requestSessionCache.set(request, sessionPromise)
  return sessionPromise
}
