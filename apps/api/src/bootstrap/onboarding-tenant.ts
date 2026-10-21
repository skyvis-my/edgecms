import type { Database } from '@/database/db'
import {
  resolveHostPolicies,
  type ResolvedHostPolicies,
  type TenantCreationActor,
} from '@/host/host-policies'
import type { LimitEnforcer } from '@/host/limits'
import type { TenantEventPublisher } from '@/host/tenant-events'
import { tenantsService } from '@/tenants/tenants.service'

type TenantRow = {
  id: string
  slug: string
  name: string
  status: string
  localeCatalog: string[]
  createdAt: string
  updatedAt: string
}

type OnboardingUser = {
  id: string
  name?: string | null
  email?: string | null
}

type ProvisionResult =
  | { success: true; data: TenantRow }
  | { success: false; error: { code: string; message: string } }

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'workspace'
}

function buildTenantName(user: OnboardingUser): string {
  const name = user.name?.trim()
  if (name) return `${name} Workspace`
  const local = user.email?.split('@')[0]?.trim()
  if (local) return `${local} Workspace`
  return 'Workspace'
}

function buildBaseSlug(user: OnboardingUser): string {
  const name = user.name?.trim()
  if (name) return slugify(name)
  const local = user.email?.split('@')[0]?.trim()
  if (local) return slugify(local)
  return 'workspace'
}

export type OnboardingTenantDeps = {
  /** Host policies for this app instance (HS-02). Defaults keep self-serve onboarding. */
  host?: Pick<ResolvedHostPolicies, 'canCreateTenant'>
  /** Lifecycle event publisher for this app instance (HS-08). */
  events?: TenantEventPublisher
  /** Whether the user is a super-admin; passed to the host policy. */
  isSuperAdmin?: boolean
  /** HS-06 tenant quota for this app instance (default: allow). */
  limits?: LimitEnforcer
}

const defaultHost = resolveHostPolicies()

export async function ensureUserHasOnboardingTenant(
  db: Database,
  user: OnboardingUser,
  deps: OnboardingTenantDeps = {}
): Promise<ProvisionResult> {
  const existing = await tenantsService.findUserTenants(db, user.id)
  if (!existing.success) return existing
  if (existing.data.length > 0) {
    const first = existing.data[0]
    if (!first) {
      return { success: false, error: { code: 'INTERNAL_ERROR', message: 'Missing tenant row' } }
    }
    return { success: true, data: first }
  }

  const actor: TenantCreationActor = {
    userId: user.id,
    email: user.email ?? '',
    isSuperAdmin: deps.isSuperAdmin ?? false,
    source: 'onboarding',
  }
  const authorized = await tenantsService.authorizeCreation(
    actor,
    deps.host ?? defaultHost,
    deps.limits
  )
  if (!authorized.success) return authorized

  const name = buildTenantName(user)
  const baseSlug = buildBaseSlug(user)

  for (let index = 0; index < 20; index++) {
    const slug = index === 0 ? baseSlug : `${baseSlug}-${index + 1}`
    // The user is added as owner in the same write as the tenant.
    const created = await tenantsService.createAuthorized(
      db,
      { name, slug },
      actor,
      authorized.data.initialStatus,
      { events: deps.events }
    )
    if (created.success) {
      return { success: true, data: created.data }
    }
    if (created.error.code !== 'CONFLICT') {
      return created
    }
  }

  return {
    success: false,
    error: { code: 'CONFLICT', message: 'Unable to allocate a unique tenant slug' },
  }
}
