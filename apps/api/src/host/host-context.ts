import { env } from 'cloudflare:workers'
import { Elysia } from 'elysia'
import type { Env } from '@/env'
import { getRequestPathname } from '@/shared/utils/request-url'
import { isPublicReadRequest } from '@/tenants/tenant.middleware'
import { extractTenantSlug } from '@/tenants/tenant-path'
import type { TenantContext } from '@/tenants/tenant-context'
import type { ResolvedHostPolicies } from './host-policies'
import { createLimitEnforcer, type LimitEnforcer } from './limits'
import type { TenantEventPublisher } from './tenant-events'
import { createUsageRecorder, type UsageRecorder } from './usage'

/**
 * Request-path services for the metering and limit seams (HS-05, HS-06),
 * built once per app instance from its host policies.
 */
export interface HostRuntime {
  usage: UsageRecorder
  limits: LimitEnforcer
}

export function createHostRuntime(
  host: Pick<ResolvedHostPolicies, 'usageSink' | 'limits'>,
  events?: Pick<TenantEventPublisher, 'publish'>
): HostRuntime {
  return {
    usage: createUsageRecorder(host.usageSink),
    limits: createLimitEnforcer({
      limits: host.limits,
      events,
      kv: () => (env as Partial<Env> | undefined)?.CACHE,
    }),
  }
}

const defaultRuntime = createHostRuntime({})
const requestRuntimes = new WeakMap<Request, HostRuntime>()

/**
 * The host runtime of the app instance handling `request`. Requests that did
 * not pass through `createApp` (unit tests calling a controller directly) get
 * the defaults: no metering, no limits.
 */
export function getHostRuntime(request: Request | undefined): HostRuntime {
  return (request && requestRuntimes.get(request)) || defaultRuntime
}

/**
 * Attaches this instance's runtime to each request, the same per-Request
 * pattern as the tenant cache, and meters successful public reads.
 */
export function createHostRuntimePlugin(runtime: HostRuntime) {
  return new Elysia({ name: 'host-runtime' })
    .onRequest(({ request }) => {
      requestRuntimes.set(request, runtime)
    })
    .onAfterHandle({ as: 'global' }, (ctx) => {
      const method = ctx.request.method
      if (method !== 'GET' && method !== 'HEAD' && method !== 'POST') return
      const pathname = getRequestPathname(ctx.request)
      const tenantSlug = extractTenantSlug(pathname)
      if (!tenantSlug || !isPublicReadRequest(method, pathname, tenantSlug)) return
      const tenant = (ctx as { tenant?: TenantContext }).tenant?.tenant
      if (!tenant) return
      const response = (ctx as { response?: unknown }).response
      const status =
        response instanceof Response
          ? response.status
          : typeof ctx.set.status === 'number'
            ? ctx.set.status
            : 200
      if (status >= 400) return
      runtime.usage.record(ctx, {
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        metric: 'public_reads',
        quantity: 1,
      })
    })
}
