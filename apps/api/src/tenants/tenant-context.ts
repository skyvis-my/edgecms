/**
 * Tenant context types and helpers for multi-tenant request handling.
 *
 * Tenant context is attached to request objects by the tenant middleware
 * and provides access to tenant-specific metadata and resource bindings.
 */

import { createDb, type Database } from '@/database/db'
import { tenantsRepository } from './tenants.repository'

/** Tenant information attached to request context. */
export interface TenantContext {
  /** Tenant metadata from the tenants table. */
  tenant: {
    id: string
    slug: string
    name: string
    status: string
    mediaUploadMaxBytes: number
    mediaUploadMaxDimension: number
    mediaAllowedMimeTypes: string[]
  }
  /** Shared infrastructure metadata. */
  resources: {
    mode: 'shared'
  } | {
    mode: 'isolated'
    bindings: {
      db?: string
      kv?: string
      r2?: string
    }
  }
}

/** Resolved bindings for a request — tenant-scoped or static env fallback. */
export interface ResolvedBindings {
  db: Database
  kv: KVNamespace
  r2: R2Bucket
}

/**
 * Type guard to check if a request has tenant context.
 *
 * Useful for handlers that optionally support tenant-scoped behavior.
 */
export function hasTenantContext(ctx: unknown): ctx is { tenant: TenantContext } {
  return (
    typeof ctx === 'object' &&
    ctx !== null &&
    'tenant' in ctx &&
    typeof (ctx as { tenant: unknown }).tenant === 'object' &&
    (ctx as { tenant: unknown }).tenant !== null &&
    'tenant' in ((ctx as { tenant: unknown }).tenant as object) &&
    'resources' in ((ctx as { tenant: unknown }).tenant as object)
  )
}

/**
 * Extract tenant context from request context.
 *
 * Throws if tenant context is not available (middleware not applied).
 */
export function getTenantContext(ctx: { tenant: TenantContext }): TenantContext {
  if (!hasTenantContext(ctx)) {
    throw new Error('Tenant context not available. Ensure tenant middleware is applied.')
  }
  return ctx.tenant
}

/**
 * Resolve D1/KV/R2 bindings from tenant context when available, falling back to static env.
 *
 * In the current phase, tenant resource IDs are stored as metadata but the actual
 * runtime binding resolution (connecting to provisioned D1/KV/R2 resources) requires
 * the Cloudflare API. Until provisioning is fully wired up, tenant-scoped routes
 * fall back to the Worker's static bindings — this function centralizes that logic
 * so the switch to real tenant bindings is a single-point change.
 *
 * @param tenantContext - Tenant context from middleware (may be undefined for non-tenant routes)
 * @param workerEnv - Static Worker environment bindings
 * @returns Resolved bindings object with db, kv, and r2
 */
export function resolveTenantBindings(
  tenantContext: TenantContext | undefined,
  workerEnv: { DB: D1Database; CACHE: KVNamespace; MEDIA: R2Bucket }
): ResolvedBindings {
  if (tenantContext?.resources.mode === 'isolated') {
    const dbBindingName = tenantContext.resources.bindings.db
    const kvBindingName = tenantContext.resources.bindings.kv
    const r2BindingName = tenantContext.resources.bindings.r2

    const dynamicBindings = workerEnv as unknown as Record<string, unknown>
    const dbBinding = (dbBindingName ? dynamicBindings[dbBindingName] : undefined) as
      | D1Database
      | undefined
    const kvBinding = (kvBindingName ? dynamicBindings[kvBindingName] : undefined) as
      | KVNamespace
      | undefined
    const r2Binding = (r2BindingName ? dynamicBindings[r2BindingName] : undefined) as
      | R2Bucket
      | undefined

    return {
      db: createDb(dbBinding ?? workerEnv.DB),
      kv: kvBinding ?? workerEnv.CACHE,
      r2: r2Binding ?? workerEnv.MEDIA,
    }
  }

  return {
    db: createDb(workerEnv.DB),
    kv: workerEnv.CACHE,
    r2: workerEnv.MEDIA,
  }
}

/**
 * Verify that a user is a member of the specified tenant.
 *
 * This function queries the tenant_users table to check if the user
 * has been granted access to the tenant. It returns the user's role
 * if membership exists, or null if the user is not a member.
 *
 * @param db - Database instance (global DB for tenant lookups)
 * @param userId - User ID to check
 * @param tenantId - Tenant ID to verify membership for
 * @returns The user's role in the tenant, or null if not a member
 */
export async function verifyTenantMembership(
  db: Database,
  userId: string,
  tenantId: string
): Promise<string | null> {
  const membership = await tenantsRepository.findTenantUser(db, tenantId, userId)
  return membership?.role ?? null
}
