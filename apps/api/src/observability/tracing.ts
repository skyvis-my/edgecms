export const TRACEPARENT_REGEX = /^00-([a-f0-9]{32})-([a-f0-9]{16})-([a-f0-9]{2})$/

export function getOrCreateRequestId(request: Request): string {
  const traceparent = request.headers.get('traceparent')
  if (traceparent) {
    const match = traceparent.match(TRACEPARENT_REGEX)
    const traceId = match?.[1]
    if (traceId) {
      return traceId
    }
  }
  return request.headers.get('x-request-id') ?? crypto.randomUUID()
}

export function setRequestIdHeader(set: { headers?: unknown }, requestId: string): void {
  if (!set.headers) {
    set.headers = { 'x-request-id': requestId }
    return
  }
  if (set.headers instanceof Headers || hasHeadersSetMethod(set.headers)) {
    set.headers.set('x-request-id', requestId)
    return
  }
  if (typeof set.headers === 'object' && set.headers !== null) {
    ;(set.headers as Record<string, string>)['x-request-id'] = requestId
  }
}

export function createTraceparentHeader(traceId: string): string {
  const normalizedTraceId = traceId.replace(/-/g, '').padEnd(32, '0').slice(0, 32)
  const spanId = crypto.randomUUID().replace(/-/g, '').slice(0, 16)
  return `00-${normalizedTraceId}-${spanId}-01`
}

function hasHeadersSetMethod(
  value: unknown
): value is { set: (key: string, value: string) => void } {
  return (
    typeof value === 'object' && value !== null && 'set' in value && typeof value.set === 'function'
  )
}
