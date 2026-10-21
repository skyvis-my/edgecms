import type { AuthPolicyOverrides } from '@/auth/auth-policies'
import type { RateLimitCategory, RateLimitPolicy } from '@/auth/rate-limit.middleware'
import { logger } from '@/observability/logger'
import type { LimitDimension, TenantLimits } from './limits'
import type { UsageSink } from './usage'

/**
 * Host policies (PRD §10.1 hosting seams).
 *
 * A host — anyone running EdgeCMS as a multi-customer service — passes these
 * to `createApp({ host })` at composition time. They are never read from
 * request input, and each app instance owns its own copy (no module state).
 * Every hook is optional; omitted hooks keep the framework defaults.
 */

/** Where a tenant-creation request came from. */
export type TenantCreationSource =
  /** `POST /api/admin/tenants` (tenant management API). */
  | 'admin-api'
  /** `POST /api/bootstrap/provision-tenant` (first-workspace onboarding). */
  | 'onboarding'

/** The authenticated caller asking to create a tenant. */
export interface TenantCreationActor {
  userId: string
  email: string
  /** Super-admin by role, by `SUPER_ADMIN_EMAILS`, or by `SUPER_ADMIN_DEV_MODE`. */
  isSuperAdmin: boolean
  source: TenantCreationSource
}

/** Initial state a host may assign to a newly created tenant. */
export type InitialTenantStatus = 'active' | 'pending'

/** Result of `canCreateTenant`. `true` equals `{ allowed: true }`. */
export type TenantCreationDecision =
  | boolean
  | { allowed: true; initialStatus?: InitialTenantStatus }
  | { allowed: false; reason?: string }

/** Tenant lifecycle event names (HS-08). Dot-notation per webhook naming. */
export type TenantEventType =
  | 'tenant.created'
  | 'tenant.activated'
  | 'tenant.suspended'
  | 'tenant.deleted'
  /** HS-06: a limit denied a request; once per tenant, dimension and period. */
  | 'tenant.limit_reached'

/** Details of a `tenant.limit_reached` event. */
export interface TenantLimitReached {
  dimension: LimitDimension
  kind: 'quota' | 'rate'
  limit?: number
  used?: number
  upgradeUrl?: string
  period: string
}

/** Payload delivered to `onTenantEvent`. */
export interface TenantLifecycleEvent {
  id: string
  event: TenantEventType
  timestamp: string
  tenant: { id: string; slug: string; name: string; status: string }
  /** Previous status for state transitions (`tenant.activated`, `tenant.suspended`). */
  previousStatus?: string
  /** User who caused the event, when known. */
  actorId?: string
  /** Set on `tenant.limit_reached`. */
  limit?: TenantLimitReached
}

/** Input to the per-tenant rate-limit policy (HS-07). */
export interface TenantRateLimitRequest {
  /** Tenant slug from the request path (`/api/tenants/:tenantSlug/...`), not yet verified. */
  tenantSlug: string
  category: RateLimitCategory
  /** The framework policy that applies when the host returns nothing. */
  defaultPolicy: RateLimitPolicy
}

/** Per-tenant rate-limit policy. */
export interface TenantRateLimitPolicy extends RateLimitPolicy {
  /**
   * Optional budget shared by every caller of this tenant in this category
   * per `windowMs`, on top of the per-caller `limit`.
   */
  tenantLimit?: number
  /** Upgrade link included in the `429 RATE_LIMITED` details. */
  upgradeUrl?: string
}

export interface HostPolicies {
  /**
   * HS-02: decide whether `actor` may create a tenant.
   * Default: super-admins only on the admin API; onboarding keeps its
   * self-serve first workspace (a user with no tenant gets one).
   */
  canCreateTenant?: (
    actor: TenantCreationActor
  ) => TenantCreationDecision | Promise<TenantCreationDecision>
  /**
   * HS-08: called after a tenant lifecycle change is committed. Errors are
   * logged and never fail the request.
   */
  onTenantEvent?: (event: TenantLifecycleEvent) => void | Promise<void>
  /**
   * HS-01 / HS-11: signup policy, email sender for verification and invite
   * emails, and the super-admin MFA requirement. Values given here win over
   * `SIGNUP_POLICY`, `AUTH_EMAIL_SENDER` and `SUPER_ADMIN_REQUIRE_MFA`.
   * Unlike the other hooks these apply to the whole Worker isolate, because
   * every auth entry point builds Better Auth from the Worker env.
   */
  auth?: AuthPolicyOverrides
  /**
   * HS-05: receives per-tenant usage events after the response, through
   * `waitUntil`. Errors are logged and dropped. Default: no-op.
   * `createD1UsageRollupSink` writes daily rollups to D1.
   */
  usageSink?: UsageSink
  /**
   * HS-06: checked before commands, entry creation, uploads, AI calls and
   * tenant creation. A throwing provider allows the request (fail open).
   * Default: allow everything.
   */
  limits?: TenantLimits
  /**
   * HS-07: per-tenant rate-limit policy for tenant routes. Return nothing to
   * keep the framework policy. Results are cached per instance for 30 s; a
   * throwing resolver keeps the framework policy.
   */
  rateLimits?: (
    request: TenantRateLimitRequest
  ) => TenantRateLimitPolicy | undefined | Promise<TenantRateLimitPolicy | undefined>
}

/** Host policies with defaults applied. */
export interface ResolvedHostPolicies {
  canCreateTenant: (actor: TenantCreationActor) => Promise<NormalizedTenantCreationDecision>
  onTenantEvent?: HostPolicies['onTenantEvent']
  usageSink?: UsageSink
  limits?: TenantLimits
  rateLimits?: HostPolicies['rateLimits']
}

export type NormalizedTenantCreationDecision =
  | { allowed: true; initialStatus: InitialTenantStatus }
  | { allowed: false; reason?: string }

/** Default HS-02 rule: today's behavior. */
export function defaultCanCreateTenant(actor: TenantCreationActor): boolean {
  return actor.source === 'onboarding' || actor.isSuperAdmin
}

function normalizeDecision(decision: TenantCreationDecision): NormalizedTenantCreationDecision {
  if (decision === true) return { allowed: true, initialStatus: 'active' }
  if (decision === false || !decision || typeof decision !== 'object') return { allowed: false }
  if (decision.allowed === true) {
    return {
      allowed: true,
      initialStatus: decision.initialStatus === 'pending' ? 'pending' : 'active',
    }
  }
  return { allowed: false, reason: decision.reason }
}

export function resolveHostPolicies(host: HostPolicies = {}): ResolvedHostPolicies {
  const canCreate = host.canCreateTenant ?? defaultCanCreateTenant
  return {
    canCreateTenant: async (actor) => {
      try {
        return normalizeDecision(await canCreate(actor))
      } catch (err) {
        // Fail closed: a throwing host policy denies creation.
        logger.error('host_can_create_tenant_failed', {
          error: err instanceof Error ? err.message : String(err),
        })
        return { allowed: false }
      }
    },
    onTenantEvent: host.onTenantEvent,
    usageSink: host.usageSink,
    limits: host.limits,
    rateLimits: host.rateLimits,
  }
}
