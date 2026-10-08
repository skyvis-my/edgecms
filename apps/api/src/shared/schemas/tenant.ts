import { type } from 'arktype'
import { id, slug, timestamp } from './common'

/**
 * ArkType schemas for tenant-related types.
 *
 * These schemas provide runtime validation for tenant data structures
 * and can be used across the API, admin UI, and AI tools.
 */

/**
 * Tenant status values.
 */
export const tenantStatus = type("'active'|'inactive'|'suspended'")

export type TenantStatus = typeof tenantStatus.infer

/**
 * Tenant user role values.
 */
export const tenantRole = type("'owner'|'admin'|'member'")

export type TenantRole = typeof tenantRole.infer

/**
 * Tenant entity — represents a tenant in the system.
 */
export const tenant = type({
  id,
  slug,
  name: 'string',
  status: tenantStatus,
  localeCatalog: 'string[]',
  'targetUrl?': 'string',
  'corsOrigin?': 'string',
  mediaUploadMaxBytes: 'number',
  mediaUploadMaxDimension: 'number',
  mediaAllowedMimeTypes: 'string[]',
  createdAt: timestamp,
  updatedAt: timestamp,
})

export type Tenant = typeof tenant.infer

/**
 * Tenant creation input.
 */
export const createTenantInput = type({
  name: 'string',
  slug,
  'localeCatalog?': 'string[]',
  'targetUrl?': 'string',
  'corsOrigin?': 'string',
  'mediaUploadMaxBytes?': 'number',
  'mediaUploadMaxDimension?': 'number',
  'mediaAllowedMimeTypes?': 'string[]',
})

export type CreateTenantInput = typeof createTenantInput.infer

/**
 * Tenant update input.
 */
export const updateTenantInput = type({
  'name?': 'string',
  'slug?': slug,
  'status?': tenantStatus,
  'localeCatalog?': 'string[]',
  'targetUrl?': 'string',
  'corsOrigin?': 'string',
  'mediaUploadMaxBytes?': 'number',
  'mediaUploadMaxDimension?': 'number',
  'mediaAllowedMimeTypes?': 'string[]',
})

export type UpdateTenantInput = typeof updateTenantInput.infer

/**
 * Tenant user membership — represents a user's membership in a tenant.
 */
export const tenantUser = type({
  tenantId: id,
  userId: id,
  role: tenantRole,
  createdAt: timestamp,
})

export type TenantUser = typeof tenantUser.infer

/**
 * Add user to tenant input.
 */
export const addUserToTenantInput = type({
  userId: id,
  role: tenantRole,
})

export type AddUserToTenantInput = typeof addUserToTenantInput.infer

/**
 * Tenant resources — tracks Cloudflare resource IDs for a tenant.
 */
export const tenantResources = type({
  tenantId: id,
  'd1DatabaseId?': 'string',
  'kvNamespaceId?': 'string',
  'r2BucketName?': 'string',
  createdAt: timestamp,
  updatedAt: timestamp,
})

export type TenantResources = typeof tenantResources.infer
