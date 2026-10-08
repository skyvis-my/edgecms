import { and, count, eq, sql } from 'drizzle-orm'
import { DEFAULT_ASSET_ALLOWED_MIME_TYPES } from '@/assets/file-policy'
import type { Database } from '@/database/db'
import { user } from '@/database/schema/auth.schema'
import { tenantResources, tenants, tenantUsers } from '@/database/schema'

/** Row type inferred from the tenants table. */
export type TenantRow = typeof tenants.$inferSelect

/** Insert type inferred from the tenants table. */
export type TenantInsert = typeof tenants.$inferInsert

/** Row type inferred from the tenant_users table. */
export type TenantUserRow = typeof tenantUsers.$inferSelect

/** Insert type inferred from the tenant_users table. */
export type TenantUserInsert = typeof tenantUsers.$inferInsert

/** Row type inferred from the tenant_resources table. */
export type TenantResourceRow = typeof tenantResources.$inferSelect

/** Insert type inferred from the tenant_resources table. */
export type TenantResourceInsert = typeof tenantResources.$inferInsert

/** Tenant with user count for list views. */
export type TenantWithUserCount = TenantRow & { userCount: number }

/** Tenant user with profile details from the user table. */
export type TenantUserDetail = {
  id: string
  name: string
  email: string
  role: string
}

const DEFAULT_TENANT_LOCALE_CATALOG = ['en'] as const
const DEFAULT_MEDIA_UPLOAD_MAX_BYTES = 5 * 1024 * 1024
const DEFAULT_MEDIA_UPLOAD_MAX_DIMENSION = 2048
const DEFAULT_MEDIA_ALLOWED_MIME_TYPES = [...DEFAULT_ASSET_ALLOWED_MIME_TYPES]

function isMissingOptionalTenantColumnsError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return (
    message.includes('no such column') &&
    (message.includes('localecatalog') ||
      message.includes('targeturl') ||
      message.includes('corsorigin') ||
      message.includes('mediauploadmaxbytes') ||
      message.includes('mediauploadmaxdimension') ||
      message.includes('mediaallowedmimetypes'))
  )
}

function withDefaultTenantColumns<
  T extends Omit<
    TenantRow,
    | 'localeCatalog'
    | 'targetUrl'
    | 'corsOrigin'
    | 'mediaUploadMaxBytes'
    | 'mediaUploadMaxDimension'
    | 'mediaAllowedMimeTypes'
  >,
>(row: T): TenantRow {
  return {
    ...row,
    localeCatalog: [...DEFAULT_TENANT_LOCALE_CATALOG],
    targetUrl: null,
    corsOrigin: null,
    mediaUploadMaxBytes: DEFAULT_MEDIA_UPLOAD_MAX_BYTES,
    mediaUploadMaxDimension: DEFAULT_MEDIA_UPLOAD_MAX_DIMENSION,
    mediaAllowedMimeTypes: DEFAULT_MEDIA_ALLOWED_MIME_TYPES,
  }
}

/**
 * Data access layer for tenant management.
 *
 * Provides CRUD operations for tenants, user membership, and resource tracking.
 */
export const tenantsRepository = {
  /** List all tenants ordered by creation date (newest first). */
  async findAll(db: Database): Promise<TenantRow[]> {
    try {
      return await db.select().from(tenants).all()
    } catch (error) {
      if (!isMissingOptionalTenantColumnsError(error)) throw error
      const rows = await db
        .select({
          id: tenants.id,
          slug: tenants.slug,
          name: tenants.name,
          status: tenants.status,
          createdAt: tenants.createdAt,
          updatedAt: tenants.updatedAt,
        })
        .from(tenants)
        .all()
      return rows.map(withDefaultTenantColumns)
    }
  },

  /** List all tenants with their user counts. */
  async findAllWithUserCount(db: Database): Promise<TenantWithUserCount[]> {
    const userCountSubquery = db
      .select({
        tenantId: tenantUsers.tenantId,
        userCount: count().as('userCount'),
      })
      .from(tenantUsers)
      .groupBy(tenantUsers.tenantId)
      .as('userCounts')

    const rows = await db
      .select({
        id: tenants.id,
        slug: tenants.slug,
        name: tenants.name,
        status: tenants.status,
        localeCatalog: tenants.localeCatalog,
        targetUrl: tenants.targetUrl,
        corsOrigin: tenants.corsOrigin,
        mediaUploadMaxBytes: tenants.mediaUploadMaxBytes,
        mediaUploadMaxDimension: tenants.mediaUploadMaxDimension,
        mediaAllowedMimeTypes: tenants.mediaAllowedMimeTypes,
        createdAt: tenants.createdAt,
        updatedAt: tenants.updatedAt,
        userCount: sql<number>`coalesce(${userCountSubquery.userCount}, 0)`,
      })
      .from(tenants)
      .leftJoin(userCountSubquery, eq(tenants.id, userCountSubquery.tenantId))
      .all()

    return rows.map((row) => ({
      ...row,
      userCount: Number(row.userCount),
    }))
  },

  /** Find a single tenant by its primary key. */
  async findById(db: Database, id: string): Promise<TenantRow | undefined> {
    try {
      const rows = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1)
      return rows[0]
    } catch (error) {
      if (!isMissingOptionalTenantColumnsError(error)) throw error
      const rows = await db
        .select({
          id: tenants.id,
          slug: tenants.slug,
          name: tenants.name,
          status: tenants.status,
          createdAt: tenants.createdAt,
          updatedAt: tenants.updatedAt,
        })
        .from(tenants)
        .where(eq(tenants.id, id))
        .limit(1)
      const row = rows[0]
      return row ? withDefaultTenantColumns(row) : undefined
    }
  },

  /** Find a single tenant by its unique slug. */
  async findBySlug(db: Database, slug: string): Promise<TenantRow | undefined> {
    try {
      const rows = await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1)
      return rows[0]
    } catch (error) {
      if (!isMissingOptionalTenantColumnsError(error)) throw error
      const rows = await db
        .select({
          id: tenants.id,
          slug: tenants.slug,
          name: tenants.name,
          status: tenants.status,
          createdAt: tenants.createdAt,
          updatedAt: tenants.updatedAt,
        })
        .from(tenants)
        .where(eq(tenants.slug, slug))
        .limit(1)
      const row = rows[0]
      return row ? withDefaultTenantColumns(row) : undefined
    }
  },

  /** Insert a new tenant row. */
  async create(db: Database, data: TenantInsert): Promise<TenantRow> {
    const rows = await db.insert(tenants).values(data).returning()
    const row = rows[0]
    if (!row) {
      throw new Error('Failed to create tenant: insert returned no rows')
    }
    return row
  },

  /** Update an existing tenant by ID. Returns the updated row or undefined if not found. */
  async update(
    db: Database,
    id: string,
    data: Partial<Omit<TenantInsert, 'id'>>
  ): Promise<TenantRow | undefined> {
    const rows = await db.update(tenants).set(data).where(eq(tenants.id, id)).returning()
    return rows[0]
  },

  /** Delete a tenant by ID. Returns true if a row was deleted. */
  async deleteById(db: Database, id: string): Promise<boolean> {
    const rows = await db.delete(tenants).where(eq(tenants.id, id)).returning({ id: tenants.id })
    return rows.length > 0
  },

  /** Find all tenants a user belongs to. */
  async findUserTenants(db: Database, userId: string): Promise<TenantRow[]> {
    const results = await db
      .select({ tenant: tenants })
      .from(tenantUsers)
      .innerJoin(tenants, eq(tenantUsers.tenantId, tenants.id))
      .where(eq(tenantUsers.userId, userId))
      .all()

    return results.map((r) => r.tenant)
  },

  /** Find all users in a tenant with their roles. */
  async findTenantUsers(db: Database, tenantId: string): Promise<TenantUserRow[]> {
    return db.select().from(tenantUsers).where(eq(tenantUsers.tenantId, tenantId)).all()
  },

  /** Find all users in a tenant with their profile details (name, email). */
  async findTenantUsersWithDetails(db: Database, tenantId: string): Promise<TenantUserDetail[]> {
    const rows = await db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        role: tenantUsers.role,
      })
      .from(tenantUsers)
      .innerJoin(user, eq(tenantUsers.userId, user.id))
      .where(eq(tenantUsers.tenantId, tenantId))
      .all()

    return rows
  },

  /** Check if a user is a member of a tenant. */
  async findTenantUser(
    db: Database,
    tenantId: string,
    userId: string
  ): Promise<TenantUserRow | undefined> {
    const rows = await db
      .select()
      .from(tenantUsers)
      .where(and(eq(tenantUsers.tenantId, tenantId), eq(tenantUsers.userId, userId)))
      .limit(1)
    return rows[0]
  },

  async findMembershipRole(
    db: Database,
    userId: string,
    tenantSlug: string
  ): Promise<string | undefined> {
    const rows = await db
      .select({ role: tenantUsers.role })
      .from(tenantUsers)
      .innerJoin(tenants, eq(tenantUsers.tenantId, tenants.id))
      .where(and(eq(tenantUsers.userId, userId), eq(tenants.slug, tenantSlug)))
      .limit(1)
    return rows[0]?.role ?? undefined
  },

  /** Add a user to a tenant with a specific role. */
  async addUserToTenant(db: Database, data: TenantUserInsert): Promise<TenantUserRow> {
    const rows = await db.insert(tenantUsers).values(data).returning()
    const row = rows[0]
    if (!row) {
      throw new Error('Failed to add user to tenant: insert returned no rows')
    }
    return row
  },

  /** Remove a user from a tenant. Returns true if a row was deleted. */
  async removeUserFromTenant(db: Database, tenantId: string, userId: string): Promise<boolean> {
    const rows = await db
      .delete(tenantUsers)
      .where(and(eq(tenantUsers.tenantId, tenantId), eq(tenantUsers.userId, userId)))
      .returning({ tenantId: tenantUsers.tenantId })
    return rows.length > 0
  },

  /** Update a user's role in a tenant. */
  async updateUserRole(
    db: Database,
    tenantId: string,
    userId: string,
    role: string
  ): Promise<TenantUserRow | undefined> {
    const rows = await db
      .update(tenantUsers)
      .set({ role })
      .where(and(eq(tenantUsers.tenantId, tenantId), eq(tenantUsers.userId, userId)))
      .returning()
    return rows[0]
  },

  /** Get resource IDs for a tenant. */
  async getResources(db: Database, tenantId: string): Promise<TenantResourceRow | undefined> {
    const rows = await db
      .select()
      .from(tenantResources)
      .where(eq(tenantResources.tenantId, tenantId))
      .limit(1)
    return rows[0]
  },

  /** Delete resource IDs for a tenant. Returns true if a row was deleted. */
  async deleteResources(db: Database, tenantId: string): Promise<boolean> {
    const rows = await db
      .delete(tenantResources)
      .where(eq(tenantResources.tenantId, tenantId))
      .returning({ tenantId: tenantResources.tenantId })
    return rows.length > 0
  },

  /** Set or update resource IDs for a tenant. */
  async setResources(
    db: Database,
    tenantId: string,
    data: Omit<TenantResourceInsert, 'tenantId'>
  ): Promise<TenantResourceRow> {
    const existing = await this.getResources(db, tenantId)

    if (existing) {
      const rows = await db
        .update(tenantResources)
        .set({ ...data, updatedAt: new Date().toISOString() })
        .where(eq(tenantResources.tenantId, tenantId))
        .returning()
      const row = rows[0]
      if (!row) {
        throw new Error('Failed to update tenant resources: update returned no rows')
      }
      return row
    }

    const rows = await db
      .insert(tenantResources)
      .values({
        tenantId,
        ...data,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .returning()
    const row = rows[0]
    if (!row) {
      throw new Error('Failed to create tenant resources: insert returned no rows')
    }
    return row
  },
}
