import type { Database } from '@/database/db'
import { normalizeAllowedAssetMimeTypes } from '@/assets/file-policy'
import type { ServiceResult } from '@/shared/types/result'
import { rbacService } from '@/auth/rbac.service'
import {
  deprovisionTenant as deprovisionTenantResources,
  provisionTenant as provisionTenantResources,
  type TenantResources,
} from './provisioning.service'
import {
  type TenantRow,
  type TenantUserDetail,
  type TenantWithUserCount,
  tenantsRepository,
} from './tenants.repository'
import { invalidateCorsCache } from './cors-cache'

/** Input for creating a tenant. */
export interface CreateTenantInput {
  name: string
  slug: string
  localeCatalog?: string[]
  targetUrl?: string
  corsOrigin?: string
  mediaUploadMaxBytes?: number
  mediaUploadMaxDimension?: number
  mediaAllowedMimeTypes?: string[]
}

/** Input for updating a tenant. */
export interface UpdateTenantInput {
  name?: string
  slug?: string
  status?: string
  localeCatalog?: string[]
  targetUrl?: string
  corsOrigin?: string
  mediaUploadMaxBytes?: number
  mediaUploadMaxDimension?: number
  mediaAllowedMimeTypes?: string[]
}

/** Input for provisioning tenant resources. */
export interface ProvisionTenantInput {
  accountId: string
  apiToken: string
}

/** Input for adding a user to a tenant. */
export interface AddUserToTenantInput {
  userId: string
  role: string
}

/** Valid tenant user roles. */
const VALID_ROLES = ['owner', 'admin', 'member'] as const
export type TenantRole = (typeof VALID_ROLES)[number]
const DEFAULT_TENANT_LOCALE_CATALOG = ['en']
const DEFAULT_MEDIA_UPLOAD_MAX_BYTES = 5 * 1024 * 1024
const DEFAULT_MEDIA_UPLOAD_MAX_DIMENSION = 2048

/**
 * Validate a tenant slug.
 * Slugs must be lowercase alphanumeric with hyphens, no leading/trailing hyphens.
 */
function validateSlug(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
}

/**
 * Validate a tenant role.
 */
function validateRole(role: string): role is TenantRole {
  return VALID_ROLES.includes(role as TenantRole)
}

function normalizeLocaleCatalog(locales?: string[]): string[] {
  if (!locales) return DEFAULT_TENANT_LOCALE_CATALOG
  return locales.map((locale) => locale.trim()).filter((locale) => locale.length > 0)
}

function validateLocaleCatalog(locales: string[]): string | null {
  if (locales.length === 0) return 'localeCatalog must be a non-empty array of locale codes'
  const unique = new Set(locales)
  if (unique.size !== locales.length) return 'localeCatalog must not contain duplicate locale codes'
  return null
}

function normalizeOptionalUrl(value: string | undefined): string | null {
  if (value === undefined) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function validateHttpUrl(value: string, field: 'targetUrl' | 'corsOrigin'): string | null {
  try {
    const urls = field === 'corsOrigin' ? value.split(',').map((u) => u.trim()).filter(Boolean) : [value]
    if (urls.length === 0) return `${field} must not be empty`
    for (const url of urls) {
      const parsed = new URL(url)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return `${field} must use http or https`
      }
    }
    return null
  } catch {
    return `${field} must be a valid URL`
  }
}

function normalizeMediaUploadMaxBytes(value: number | undefined): number {
  return value ?? DEFAULT_MEDIA_UPLOAD_MAX_BYTES
}

function normalizeMediaUploadMaxDimension(value: number | undefined): number {
  return value ?? DEFAULT_MEDIA_UPLOAD_MAX_DIMENSION
}

function validateAllowedMimeTypes(value: string[]): string | null {
  if (value.length === 0) return 'mediaAllowedMimeTypes must include at least one safe MIME type'
  return null
}

function validatePositiveInteger(value: number, field: string): string | null {
  if (!Number.isInteger(value) || value < 1) {
    return `${field} must be a positive integer`
  }
  return null
}

/**
 * Business logic layer for tenant management.
 *
 * Orchestrates repository calls with validation, slug checking,
 * and error handling.
 */
export const tenantsService = {
  /** List all tenants with user counts. */
  async findAll(db: Database): Promise<ServiceResult<TenantWithUserCount[]>> {
    const data = await tenantsRepository.findAllWithUserCount(db)
    return { success: true, data }
  },

  /** Get a tenant by ID or slug. */
  async findByIdOrSlug(db: Database, idOrSlug: string): Promise<ServiceResult<TenantRow>> {
    // Try by ID first, then by slug
    const byId = await tenantsRepository.findById(db, idOrSlug)
    if (byId) return { success: true, data: byId }

    const bySlug = await tenantsRepository.findBySlug(db, idOrSlug)
    if (bySlug) return { success: true, data: bySlug }

    return {
      success: false,
      error: { code: 'NOT_FOUND', message: `Tenant '${idOrSlug}' not found` },
    }
  },

  /** Get a tenant by ID or slug with its users' details. */
  async findByIdOrSlugWithUsers(
    db: Database,
    idOrSlug: string
  ): Promise<ServiceResult<TenantRow & { users: TenantUserDetail[] }>> {
    const tenantResult = await this.findByIdOrSlug(db, idOrSlug)
    if (!tenantResult.success) return tenantResult

    const users = await tenantsRepository.findTenantUsersWithDetails(db, tenantResult.data.id)
    return { success: true, data: { ...tenantResult.data, users } }
  },

  /** Get tenant users with profile details. */
  async findTenantUsersWithDetails(
    db: Database,
    tenantId: string
  ): Promise<ServiceResult<TenantUserDetail[]>> {
    const tenant = await tenantsRepository.findById(db, tenantId)
    if (!tenant) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: `Tenant '${tenantId}' not found` },
      }
    }

    const data = await tenantsRepository.findTenantUsersWithDetails(db, tenantId)
    return { success: true, data }
  },

  /** Create a new tenant with validation. */
  async create(db: Database, input: CreateTenantInput): Promise<ServiceResult<TenantRow>> {
    // Validate slug format
    if (!validateSlug(input.slug)) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Slug must be lowercase alphanumeric with hyphens, no leading/trailing hyphens',
        },
      }
    }

    // Check for slug conflicts
    const existing = await tenantsRepository.findBySlug(db, input.slug)
    if (existing) {
      return {
        success: false,
        error: { code: 'CONFLICT', message: `Tenant with slug '${input.slug}' already exists` },
      }
    }

    const localeCatalog = normalizeLocaleCatalog(input.localeCatalog)
    const localeValidationError = validateLocaleCatalog(localeCatalog)
    if (localeValidationError) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: localeValidationError,
        },
      }
    }
    const targetUrl = normalizeOptionalUrl(input.targetUrl)
    const corsOrigin = normalizeOptionalUrl(input.corsOrigin)
    const mediaUploadMaxBytes = normalizeMediaUploadMaxBytes(input.mediaUploadMaxBytes)
    const mediaUploadMaxDimension = normalizeMediaUploadMaxDimension(input.mediaUploadMaxDimension)
    const mediaAllowedMimeTypes = normalizeAllowedAssetMimeTypes(input.mediaAllowedMimeTypes)
    const mediaUploadMaxBytesError = validatePositiveInteger(
      mediaUploadMaxBytes,
      'mediaUploadMaxBytes'
    )
    if (mediaUploadMaxBytesError) {
      return { success: false, error: { code: 'VALIDATION_ERROR', message: mediaUploadMaxBytesError } }
    }
    const mediaUploadMaxDimensionError = validatePositiveInteger(
      mediaUploadMaxDimension,
      'mediaUploadMaxDimension'
    )
    if (mediaUploadMaxDimensionError) {
      return {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: mediaUploadMaxDimensionError },
      }
    }
    const mediaAllowedMimeTypesError = validateAllowedMimeTypes(mediaAllowedMimeTypes)
    if (mediaAllowedMimeTypesError) {
      return {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: mediaAllowedMimeTypesError },
      }
    }
    if (targetUrl) {
      const urlError = validateHttpUrl(targetUrl, 'targetUrl')
      if (urlError) {
        return { success: false, error: { code: 'VALIDATION_ERROR', message: urlError } }
      }
    }
    if (corsOrigin) {
      const urlError = validateHttpUrl(corsOrigin, 'corsOrigin')
      if (urlError) {
        return { success: false, error: { code: 'VALIDATION_ERROR', message: urlError } }
      }
    }

    const now = new Date().toISOString()
    const id = crypto.randomUUID()

    const row = await tenantsRepository.create(db, {
      id,
      name: input.name,
      slug: input.slug,
      status: 'active',
      localeCatalog,
      targetUrl,
      corsOrigin,
      mediaUploadMaxBytes,
      mediaUploadMaxDimension,
      mediaAllowedMimeTypes,
      createdAt: now,
      updatedAt: now,
    })

    // Seed built-in RBAC roles for the new tenant
    await rbacService.seedBuiltInRoles(db, id)

    return { success: true, data: row }
  },

  /** Update an existing tenant by ID. */
  async update(
    db: Database,
    id: string,
    input: UpdateTenantInput
  ): Promise<ServiceResult<TenantRow>> {
    const existing = await tenantsRepository.findById(db, id)
    if (!existing) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: `Tenant '${id}' not found` },
      }
    }

    // Validate slug if being updated
    if (input.slug !== undefined) {
      if (!validateSlug(input.slug)) {
        return {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message:
              'Slug must be lowercase alphanumeric with hyphens, no leading/trailing hyphens',
          },
        }
      }

      // Check for slug conflicts (excluding current tenant)
      const conflict = await tenantsRepository.findBySlug(db, input.slug)
      if (conflict && conflict.id !== id) {
        return {
          success: false,
          error: { code: 'CONFLICT', message: `Tenant with slug '${input.slug}' already exists` },
        }
      }
    }

    // Validate status if being updated
    if (input.status !== undefined && !['active', 'inactive', 'suspended'].includes(input.status)) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: "Status must be 'active', 'inactive', or 'suspended'",
        },
      }
    }

    if (input.localeCatalog !== undefined) {
      const normalizedLocaleCatalog = normalizeLocaleCatalog(input.localeCatalog)
      const localeValidationError = validateLocaleCatalog(normalizedLocaleCatalog)
      if (localeValidationError) {
        return {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: localeValidationError,
          },
        }
      }
      input.localeCatalog = normalizedLocaleCatalog
    }
    if (input.targetUrl !== undefined) {
      const normalizedTargetUrl = normalizeOptionalUrl(input.targetUrl)
      if (normalizedTargetUrl) {
        const urlError = validateHttpUrl(normalizedTargetUrl, 'targetUrl')
        if (urlError) {
          return { success: false, error: { code: 'VALIDATION_ERROR', message: urlError } }
        }
      }
      input.targetUrl = normalizedTargetUrl ?? undefined
    }
    if (input.corsOrigin !== undefined) {
      const normalizedCorsOrigin = normalizeOptionalUrl(input.corsOrigin)
      if (normalizedCorsOrigin) {
        const urlError = validateHttpUrl(normalizedCorsOrigin, 'corsOrigin')
        if (urlError) {
          return { success: false, error: { code: 'VALIDATION_ERROR', message: urlError } }
        }
      }
      input.corsOrigin = normalizedCorsOrigin ?? undefined
    }
    if (input.mediaUploadMaxBytes !== undefined) {
      const mediaUploadMaxBytesError = validatePositiveInteger(
        input.mediaUploadMaxBytes,
        'mediaUploadMaxBytes'
      )
      if (mediaUploadMaxBytesError) {
        return {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: mediaUploadMaxBytesError },
        }
      }
    }
    if (input.mediaUploadMaxDimension !== undefined) {
      const mediaUploadMaxDimensionError = validatePositiveInteger(
        input.mediaUploadMaxDimension,
        'mediaUploadMaxDimension'
      )
      if (mediaUploadMaxDimensionError) {
        return {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: mediaUploadMaxDimensionError },
        }
      }
    }
    if (input.mediaAllowedMimeTypes !== undefined) {
      const mediaAllowedMimeTypes = normalizeAllowedAssetMimeTypes(input.mediaAllowedMimeTypes)
      const mediaAllowedMimeTypesError = validateAllowedMimeTypes(mediaAllowedMimeTypes)
      if (mediaAllowedMimeTypesError) {
        return {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: mediaAllowedMimeTypesError },
        }
      }
      input.mediaAllowedMimeTypes = mediaAllowedMimeTypes
    }

    const now = new Date().toISOString()
    const updated = await tenantsRepository.update(db, id, {
      ...input,
      updatedAt: now,
    })

    if (!updated) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: `Tenant '${id}' not found` },
      }
    }

    invalidateCorsCache(updated.slug)
    if (existing.slug !== updated.slug) {
      invalidateCorsCache(existing.slug)
    }

    return { success: true, data: updated }
  },

  /** Delete a tenant by ID. */
  async deleteById(db: Database, id: string): Promise<ServiceResult<{ id: string }>> {
    const existing = await tenantsRepository.findById(db, id)
    const deleted = await tenantsRepository.deleteById(db, id)
    if (!deleted) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: `Tenant '${id}' not found` },
      }
    }
    if (existing?.slug) {
      invalidateCorsCache(existing.slug)
    }
    return { success: true, data: { id } }
  },

  /** Get all tenants a user belongs to. */
  async findUserTenants(db: Database, userId: string): Promise<ServiceResult<TenantRow[]>> {
    const data = await tenantsRepository.findUserTenants(db, userId)
    return { success: true, data }
  },

  /** Get all users in a tenant with their roles. */
  async findTenantUsers(
    db: Database,
    tenantId: string
  ): Promise<
    ServiceResult<Array<{ tenantId: string; userId: string; role: string; createdAt: string }>>
  > {
    const tenant = await tenantsRepository.findById(db, tenantId)
    if (!tenant) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: `Tenant '${tenantId}' not found` },
      }
    }

    const data = await tenantsRepository.findTenantUsers(db, tenantId)
    return { success: true, data }
  },

  /** Add a user to a tenant with a specific role. */
  async addUserToTenant(
    db: Database,
    tenantId: string,
    input: AddUserToTenantInput
  ): Promise<ServiceResult<{ tenantId: string; userId: string; role: string }>> {
    // Check tenant exists
    const tenant = await tenantsRepository.findById(db, tenantId)
    if (!tenant) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: `Tenant '${tenantId}' not found` },
      }
    }

    // Validate role
    if (!validateRole(input.role)) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: `Role must be one of: ${VALID_ROLES.join(', ')}`,
        },
      }
    }

    // Check if user is already a member
    const existing = await tenantsRepository.findTenantUser(db, tenantId, input.userId)
    if (existing) {
      return {
        success: false,
        error: {
          code: 'CONFLICT',
          message: `User '${input.userId}' is already a member of tenant '${tenantId}'`,
        },
      }
    }

    const now = new Date().toISOString()
    const row = await tenantsRepository.addUserToTenant(db, {
      tenantId,
      userId: input.userId,
      role: input.role,
      createdAt: now,
    })

    return { success: true, data: row }
  },

  /** Remove a user from a tenant. */
  async removeUserFromTenant(
    db: Database,
    tenantId: string,
    userId: string
  ): Promise<ServiceResult<{ tenantId: string; userId: string }>> {
    const deleted = await tenantsRepository.removeUserFromTenant(db, tenantId, userId)
    if (!deleted) {
      return {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `User '${userId}' is not a member of tenant '${tenantId}'`,
        },
      }
    }
    return { success: true, data: { tenantId, userId } }
  },

  /** Update a user's role in a tenant. */
  async updateUserRole(
    db: Database,
    tenantId: string,
    userId: string,
    role: string
  ): Promise<ServiceResult<{ tenantId: string; userId: string; role: string }>> {
    // Validate role
    if (!validateRole(role)) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: `Role must be one of: ${VALID_ROLES.join(', ')}`,
        },
      }
    }

    const updated = await tenantsRepository.updateUserRole(db, tenantId, userId, role)
    if (!updated) {
      return {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `User '${userId}' is not a member of tenant '${tenantId}'`,
        },
      }
    }

    return { success: true, data: updated }
  },

  /**
   * Provision Cloudflare resources (D1, KV, R2) for a tenant.
   *
   * This should be called after tenant creation to provision dedicated resources.
   * Requires CF_API_TOKEN and CLOUDFLARE_ACCOUNT_ID environment variables.
   */
  async provision(
    db: Database,
    tenantId: string,
    input: ProvisionTenantInput
  ): Promise<ServiceResult<TenantResources>> {
    const tenant = await tenantsRepository.findById(db, tenantId)
    if (!tenant) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: `Tenant '${tenantId}' not found` },
      }
    }

    // Check if resources already exist
    const existing = await tenantsRepository.getResources(db, tenantId)
    if (existing?.d1DatabaseId || existing?.kvNamespaceId || existing?.r2BucketName) {
      return {
        success: false,
        error: {
          code: 'CONFLICT',
          message: `Tenant '${tenantId}' already has provisioned resources`,
        },
      }
    }

    try {
      const resources = await provisionTenantResources(
        db,
        input.accountId,
        tenant.slug,
        tenantId,
        input.apiToken
      )
      return { success: true, data: resources }
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'PROVISIONING_ERROR',
          message: error instanceof Error ? error.message : 'Unknown provisioning error',
        },
      }
    }
  },

  /**
   * Deprovision Cloudflare resources for a tenant.
   *
   * This deletes the D1, KV, and R2 resources associated with the tenant.
   */
  async deprovision(
    db: Database,
    tenantId: string,
    input: ProvisionTenantInput
  ): Promise<ServiceResult<{ id: string }>> {
    const tenant = await tenantsRepository.findById(db, tenantId)
    if (!tenant) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: `Tenant '${tenantId}' not found` },
      }
    }

    try {
      await deprovisionTenantResources(db, input.accountId, tenant.slug, tenantId, input.apiToken)
      return { success: true, data: { id: tenantId } }
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'DEPROVISIONING_ERROR',
          message: error instanceof Error ? error.message : 'Unknown deprovisioning error',
        },
      }
    }
  },
}
