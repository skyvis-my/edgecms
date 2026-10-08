import type { Database } from '@/database/db'
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

export async function ensureUserHasOnboardingTenant(
  db: Database,
  user: OnboardingUser
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

  const name = buildTenantName(user)
  const baseSlug = buildBaseSlug(user)

  let createdTenant: TenantRow | null = null
  for (let index = 0; index < 20; index++) {
    const slug = index === 0 ? baseSlug : `${baseSlug}-${index + 1}`
    const created = await tenantsService.create(db, { name, slug })
    if (created.success) {
      createdTenant = created.data
      break
    }
    if (created.error.code !== 'CONFLICT') {
      return created
    }
  }

  if (!createdTenant) {
    return {
      success: false,
      error: { code: 'CONFLICT', message: 'Unable to allocate a unique tenant slug' },
    }
  }

  const membership = await tenantsService.addUserToTenant(db, createdTenant.id, {
    userId: user.id,
    role: 'owner',
  })
  if (!membership.success) return membership

  return { success: true, data: createdTenant }
}
