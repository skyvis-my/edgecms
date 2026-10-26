import { Elysia } from 'elysia'
import {
  createRequestMetrics,
  defaultMetricsRegistry,
  type MetricsRegistry,
} from '@/observability/metrics'
import { logger } from '@/observability/logger'
import {
  createTraceparentHeader,
  getOrCreateRequestId,
  setRequestIdHeader,
} from '@/observability/tracing'
import { getRequestPathname, getRequestUrl } from '@/shared/utils/request-url'
import { applyApiSecurityHeaders, type MutableHeaders } from '@/auth/cors'
import { API_VERSION } from '@/version'

export type RequestObservabilityOptions = {
  metricsRegistry?: MetricsRegistry
  hstsHeader?: string | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function normalizePathLabel(pathname: string): string {
  return pathname
    .split('/')
    .map((seg) => {
      if (!seg) return seg
      if (UUID_RE.test(seg)) return ':id'
      if (/^\d+$/.test(seg)) return ':id'
      if (seg.length >= 20 && /^[A-Za-z0-9_-]+$/.test(seg)) return ':id'
      return seg
    })
    .join('/')
}

type ObservabilityCtx = {
  request: Request
  set: { status?: unknown; headers: Record<string, string | number | string[] | undefined> }
  requestMetrics?: {
    flush: (cb: (name: string, labels: Record<string, string>, value: number) => void) => void
  }
  requestId?: string
  pathname?: string
  parsedUrl?: URL
  startTime?: number
}

function finalizeObservability(
  ctx: ObservabilityCtx,
  metricsRegistry: MetricsRegistry,
  hstsHeader: string | null | undefined,
  level: 'completed' | 'failed'
) {
  const rawPath = ctx.pathname ?? getRequestPathname(ctx.request)
  const pathname = rawPath
  const pathLabel = normalizePathLabel(rawPath)
  const requestId = ctx.requestId ?? getOrCreateRequestId(ctx.request)

  ctx.requestMetrics?.flush((name: string, labels: Record<string, string>, _value: number) => {
    metricsRegistry.increment(name, labels)
  })

  metricsRegistry.increment('http_requests_total', {
    method: ctx.request.method,
    path: pathLabel,
    status: String(ctx.set.status ?? 200),
  })
  setRequestIdHeader(ctx.set, requestId)

  const traceparent = createTraceparentHeader(requestId)
  const headers = ctx.set.headers as MutableHeaders
  headers['traceparent'] = traceparent
  headers['X-API-Version'] = API_VERSION

  const duration =
    ctx.startTime !== undefined ? Math.max(0, performance.now() - ctx.startTime) : undefined
  if (duration !== undefined) {
    const totalTiming = `total;dur=${Number(duration.toFixed(2))}`
    const existingKey = Object.keys(headers).find(
      (k) => k.toLowerCase() === 'server-timing'
    )
    const existing = existingKey ? headers[existingKey] : undefined
    if (typeof existing === 'string' && existing.length > 0) {
      if (!existing.includes('total;dur=')) {
        headers[existingKey!] = `${existing}, ${totalTiming}`
      }
    } else {
      headers[existingKey ?? 'Server-Timing'] = totalTiming
    }
  }

  applyApiSecurityHeaders(headers, pathname)
  const url = ctx.parsedUrl ?? getRequestUrl(ctx.request)
  if (hstsHeader && url.protocol === 'https:') {
    headers['Strict-Transport-Security'] = hstsHeader
  }

  if (level === 'failed') {
    logger.error('request_failed', {
      method: ctx.request.method,
      path: pathname,
      status: String(ctx.set.status ?? 500),
      requestId,
    })
  } else {
    logger.info('request_completed', {
      method: ctx.request.method,
      path: pathname,
      status: String(ctx.set.status ?? 200),
      requestId,
    })
  }
}

/**
 * Elysia plugin for request observability and distributed tracing.
 *
 * Provides:
 * 1. Global context derivation: requestId, requestMetrics, metrics, parsedUrl, pathname
 * 2. Response lifecycle handling: batch metric flush, request completion logging,
 *    traceparent header, X-API-Version header, and security headers.
 */
export function createRequestObservabilityPlugin(options: RequestObservabilityOptions = {}) {
  const metricsRegistry = options.metricsRegistry ?? defaultMetricsRegistry
  const hstsHeader = options.hstsHeader

  return new Elysia({ name: 'request-observability' })
    .derive('global', ({ request }) => {
      const url = getRequestUrl(request)
      return {
        startTime: performance.now(),
        requestId: getOrCreateRequestId(request),
        requestMetrics: createRequestMetrics(),
        metrics: metricsRegistry,
        parsedUrl: url,
        pathname: url.pathname,
      }
    })
    .onAfterHandle('global', (ctx) => {
      finalizeObservability(ctx as unknown as ObservabilityCtx, metricsRegistry, hstsHeader, 'completed')
    })
    .onError('global', (ctx) => {
      finalizeObservability(
        ctx as unknown as ObservabilityCtx,
        metricsRegistry,
        hstsHeader,
        'failed'
      )
    })
}
