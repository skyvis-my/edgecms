import { env } from 'cloudflare:workers'
import { Elysia } from 'elysia'
import { resolveActorSessionDetails } from '@/auth/rbac'
import { createDb } from '@/database/db'
import type { Env } from '@/env'
import { logger } from '@/observability/logger'
import { getRequestPathname } from '@/shared/utils/request-url'
import { getCachedFastActor, getCachedTenant } from '@/tenants/tenant-cache'
import { tenantsService } from '@/tenants/tenants.service'
import { AUDIT_GLOBAL_SCOPE } from './audit-chain'
import { type AuditCategory, auditService, resolveAuditRetentionDays } from './audit.service'

const TENANT_ADMIN_PREFIX = /^\/api\/tenants\/([^/]+)\/api\/admin\/(.+)$/
const GLOBAL_ADMIN_PREFIX = /^\/api\/admin\/(.+)$/
/** Admin areas whose changes are security-relevant (permissions, tenants, settings). */
const AUDITED_AREAS = new Set([
  'tenants',
  'users',
  'roles',
  'settings',
  'webhooks',
  'plugins',
  'system',
  'collections',
  'audit',
])
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export type AdminAuditTarget = {
  scope: 'global' | { tenantSlug: string }
  category: AuditCategory
  area: string
}

/**
 * Decide whether an admin request is audited. Mutations in the audited areas
 * are; reads are not, except audit exports and verifications (who read the
 * audit log is itself evidence).
 */
export function classifyAdminAuditRequest(pathname: string, method: string): AdminAuditTarget | null {
  const tenantMatch = TENANT_ADMIN_PREFIX.exec(pathname)
  const globalMatch = tenantMatch ? null : GLOBAL_ADMIN_PREFIX.exec(pathname)
  const rest = tenantMatch?.[2] ?? globalMatch?.[1]
  if (!rest) return null
  const area = rest.split('/')[0] ?? ''
  if (!AUDITED_AREAS.has(area)) return null
  if (area === 'audit' ? method !== 'GET' : !MUTATING_METHODS.has(method)) return null

  const scope = tenantMatch ? { tenantSlug: safeDecode(tenantMatch[1]!) } : 'global'
  const touchesMembership = area === 'roles' || area === 'users' || /\/users(\/|$)/.test(rest)
  const category: AuditCategory =
    area === 'audit'
      ? 'audit'
      : touchesMembership
        ? 'rbac'
        : scope === 'global'
          ? 'super_admin'
          : 'settings'
  return { scope, category, area }
}

/** Pair a route template (`/a/:id`) with the concrete path to read its params. */
export function extractRouteParams(route: string | undefined, pathname: string): Record<string, string> {
  if (!route) return {}
  const templateParts = route.split('/')
  const pathParts = pathname.split('/')
  const params: Record<string, string> = {}
  templateParts.forEach((part, index) => {
    if (part.startsWith(':') && pathParts[index] !== undefined) {
      params[part.slice(1)] = safeDecode(pathParts[index]!)
    }
  })
  return params
}

async function resolveActorId(request: Request): Promise<string | null> {
  const cached = getCachedFastActor(request)
  if (cached) return cached.actor.actorId
  try {
    return (await resolveActorSessionDetails(request)).actorId ?? null
  } catch {
    return null
  }
}

async function resolveScope(request: Request, target: AdminAuditTarget, typedEnv: Env): Promise<string | null> {
  if (target.scope === 'global') return AUDIT_GLOBAL_SCOPE
  const slug = target.scope.tenantSlug
  const cached = getCachedTenant(request, slug)
  const tenant = cached
    ? await cached
    : await tenantsService
        .findByIdOrSlug(createDb(typedEnv.DB), slug)
        .then((r) => (r.success ? r.data : undefined))
  return tenant?.id ?? null
}

type AuditTrailCtx = {
  request: Request
  set: { status?: unknown }
  route?: string
  pathname?: string
}

async function recordAdminRequest(ctx: AuditTrailCtx, statusOverride?: number) {
  const pathname = ctx.pathname ?? getRequestPathname(ctx.request)
  const method = ctx.request.method
  const target = classifyAdminAuditRequest(pathname, method)
  if (!target) return
  const typedEnv = env as unknown as Env
  if (!typedEnv?.DB) return

  try {
    const status = statusOverride ?? (typeof ctx.set.status === 'number' ? ctx.set.status : 200)
    const scope = await resolveScope(ctx.request, target, typedEnv)
    // Unknown tenant: nothing happened inside a tenant, record in the global chain.
    const params = extractRouteParams(ctx.route, pathname)
    // A user id identifies a person: it goes to targetId (pseudonymizable), never metadata.
    const { userId, ...otherParams } = params
    const targetId = userId ?? null
    const metadata: Record<string, unknown> = {
      method,
      route: ctx.route ?? pathname,
      status,
      ...otherParams,
    }

    await auditService.recordSafely(
      createDb(typedEnv.DB),
      {
        scope: scope ?? AUDIT_GLOBAL_SCOPE,
        category: target.category,
        action: `admin.${target.area}.${method.toLowerCase()}`,
        outcome: status < 400 ? 'success' : 'failure',
        actorId: await resolveActorId(ctx.request),
        actorSource: 'user',
        targetType: targetId ? 'user' : target.area,
        targetId,
        metadata,
      },
      { retentionDays: resolveAuditRetentionDays(typedEnv.AUDIT_RETENTION_DAYS) }
    )
  } catch (err) {
    logger.error('admin_audit_failed', {
      route: ctx.route,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/**
 * HS-12: records permission/role changes, tenant membership changes and
 * super-admin actions (including denied attempts) in the audit ledger.
 */
export const auditTrailPlugin = new Elysia({ name: 'audit-trail' })
  .onAfterHandle('global', async (ctx) => {
    await recordAdminRequest(ctx as unknown as AuditTrailCtx)
  })
  .onError('global', async (ctx) => {
    const code = (ctx as { code?: unknown }).code
    const status =
      code === 'VALIDATION'
        ? 422
        : code === 'NOT_FOUND'
          ? 404
          : typeof ctx.set.status === 'number' && ctx.set.status >= 400
            ? ctx.set.status
            : 500
    await recordAdminRequest(ctx as unknown as AuditTrailCtx, status)
  })
