import { Type, createSchema } from './typebox'
import { id, slug, timestamp } from './common'

/**
 * TypeBox schemas for tenant-related types.
 *
 * These schemas provide runtime validation for tenant data structures
 * and can be used across the API, admin UI, and AI tools.
 */

/**
 * Tenant status values.
 */
export const tenantStatus = createSchema(
  Type.Union([
    Type.Literal('active'),
    Type.Literal('inactive'),
    Type.Literal('suspended'),
  ])
)

export type TenantStatus = typeof tenantStatus.infer

/**
 * Tenant user role values.
 */
export const tenantRole = createSchema(
  Type.Union([
    Type.Literal('owner'),
    Type.Literal('admin'),
    Type.Literal('member'),
  ])
)

export type TenantRole = typeof tenantRole.infer

/**
 * Tenant entity — represents a tenant in the system.
 */
export const tenant = createSchema(
  Type.Object({
    id,
    slug,
    name: Type.String(),
    status: tenantStatus,
    localeCatalog: Type.Array(Type.String()),
    targetUrl: Type.Optional(Type.String()),
    corsOrigin: Type.Optional(Type.String()),
    mediaUploadMaxBytes: Type.Number(),
    mediaUploadMaxDimension: Type.Number(),
    mediaAllowedMimeTypes: Type.Array(Type.String()),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
)

export type Tenant = typeof tenant.infer

/**
 * Tenant creation input.
 */
export const createTenantInput = createSchema(
  Type.Object({
    name: Type.String(),
    slug,
    localeCatalog: Type.Optional(Type.Array(Type.String())),
    targetUrl: Type.Optional(Type.String()),
    corsOrigin: Type.Optional(Type.String()),
    mediaUploadMaxBytes: Type.Optional(Type.Number()),
    mediaUploadMaxDimension: Type.Optional(Type.Number()),
    mediaAllowedMimeTypes: Type.Optional(Type.Array(Type.String())),
  })
)

export type CreateTenantInput = typeof createTenantInput.infer

/**
 * Tenant update input.
 */
export const updateTenantInput = createSchema(
  Type.Object({
    name: Type.Optional(Type.String()),
    slug: Type.Optional(slug),
    status: Type.Optional(tenantStatus),
    localeCatalog: Type.Optional(Type.Array(Type.String())),
    targetUrl: Type.Optional(Type.String()),
    corsOrigin: Type.Optional(Type.String()),
    mediaUploadMaxBytes: Type.Optional(Type.Number()),
    mediaUploadMaxDimension: Type.Optional(Type.Number()),
    mediaAllowedMimeTypes: Type.Optional(Type.Array(Type.String())),
  })
)

export type UpdateTenantInput = typeof updateTenantInput.infer

/**
 * Tenant user membership — represents a user's membership in a tenant.
 */
export const tenantUser = createSchema(
  Type.Object({
    tenantId: id,
    userId: id,
    role: tenantRole,
    createdAt: timestamp,
  })
)

export type TenantUser = typeof tenantUser.infer

/**
 * Add user to tenant input.
 */
export const addUserToTenantInput = createSchema(
  Type.Object({
    userId: id,
    role: tenantRole,
  })
)

export type AddUserToTenantInput = typeof addUserToTenantInput.infer

/**
 * Tenant resources — tracks Cloudflare resource IDs for a tenant.
 */
export const tenantResources = createSchema(
  Type.Object({
    tenantId: id,
    d1DatabaseId: Type.Optional(Type.String()),
    kvNamespaceId: Type.Optional(Type.String()),
    r2BucketName: Type.Optional(Type.String()),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
)

export type TenantResources = typeof tenantResources.infer
