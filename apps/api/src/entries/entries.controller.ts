import { env } from 'cloudflare:workers'
import { Elysia, t } from 'elysia'
import { betterAuthPlugin } from '@/auth/auth.middleware'
import type { Env } from '@/env'
import { hasTenantContext, resolveTenantBindings } from '@/tenants/tenant-context'
import { entriesService } from './entries.service'
import { parsePublicFilters, buildDrizzleConditions, buildSortClause } from '@/public/query-filter'

/**
 * ElysiaJS controller for entry CRUD endpoints.
 *
 * All routes are protected with `{ auth: true }` and return responses
 * in the standard API envelope format.
 *
 * Note: These endpoints provide direct CRUD access for internal use and reads.
 * For admin mutations with versioning and audit logging, prefer using the
 * command endpoint at POST /api/admin/commands.
 *
 * Registered under `/api/admin/entries` in the main app.
 */
export const entriesController = new Elysia({ prefix: '/api/admin/entries' })
  .use(betterAuthPlugin)

  /**
   * GET / — List entries with optional filtering.
   * Query params: collectionId, status, page, perPage, populate, depth, locale
   * Filter params: filter[field][operator]=value, sort=-field1,field2
   */
  .get(
    '/',
    async (ctx) => {
      const workerEnv = env as unknown as Env
      const tenantCtx = hasTenantContext(ctx) ? ctx.tenant : undefined
      const { db } = resolveTenantBindings(tenantCtx, workerEnv)
      const { query } = ctx

      // Parse filter and sort params from query string
      const allQueryParams = ctx.query as Record<string, string | undefined>
      const { filters, sort, errors } = parsePublicFilters(allQueryParams)

      if (errors.length > 0) {
        ctx.set.status = 400
        return {
          success: false as const,
          error: { code: 'VALIDATION_ERROR', message: errors.join('; ') },
        }
      }

      const extraConditions = buildDrizzleConditions(filters)
      const orderByClause = buildSortClause(sort)

      const result = await entriesService.findAllWithLocaleAndPopulate(db, {
        collectionId: query.collectionId,
        collectionSlug: query.collectionSlug,
        status: query.status,
        page: query.page ? Number(query.page) : undefined,
        perPage: query.perPage ? Number(query.perPage) : undefined,
        locale: query.locale,
        populate: query.populate,
        depth: query.depth,
        extraConditions,
        orderByClause,
      }, tenantCtx?.tenant.id)
      if (!result.success) {
        return { success: false as const, error: result.error }
      }

      return {
        success: true as const,
        data: result.data.entries,
        meta: {
          pagination: {
            total: result.data.total,
            page: result.data.page,
            perPage: result.data.perPage,
            hasMore: result.data.page * result.data.perPage < result.data.total,
          },
        },
      }
    },
    {
      auth: true,
      query: t.Object({
        collectionId: t.Optional(t.String()),
        collectionSlug: t.Optional(t.String()),
        status: t.Optional(t.String()),
        page: t.Optional(t.String()),
        perPage: t.Optional(t.String()),
        populate: t.Optional(t.String()),
        depth: t.Optional(t.String()),
        locale: t.Optional(t.String()),
        sort: t.Optional(t.String()),
        'filter[data.title][contains]': t.Optional(t.String()),
        'filter[data.category][eq]': t.Optional(t.String()),
        'filter[slug][eq]': t.Optional(t.String()),
        'filter[status][eq]': t.Optional(t.String()),
        'filter[createdAt][gte]': t.Optional(t.String()),
        'filter[createdAt][lte]': t.Optional(t.String()),
      }),
    }
  )

  /**
   * GET /batch — Get multiple entries by ID in a single request.
   * Query params: ids (comma-separated entry IDs, max 50)
   *
   * Must be registered before /:entryId to avoid route shadowing.
   */
  .get(
    '/batch',
    async (ctx) => {
      const workerEnv = env as unknown as Env
      const tenantCtx = hasTenantContext(ctx) ? ctx.tenant : undefined
      if (!tenantCtx) {
        ctx.set.status = 400
        return {
          success: false as const,
          error: { code: 'TENANT_REQUIRED', message: 'Tenant context is required' },
        }
      }
      const { db } = resolveTenantBindings(tenantCtx, workerEnv)
      const ids = ctx.query.ids.split(',').filter(Boolean)
      if (ids.length === 0) {
        ctx.set.status = 400
        return {
          success: false as const,
          error: { code: 'VALIDATION_ERROR', message: 'At least one valid ID is required' },
        }
      }
      const result = await entriesService.findByIds(db, ids, tenantCtx.tenant.id)
      if (!result.success) {
        ctx.set.status = 400
        return { success: false as const, error: result.error }
      }
      return { success: true as const, data: result.data }
    },
    {
      auth: true,
      query: t.Object({
        ids: t.String({ minLength: 1 }),
      }),
    }
  )

  /**
   * POST /:entryId/duplicate — Duplicate an entry by ID.
   * Creates a copy with draft status and a new slug ending in -copy.
   */
  .post(
    '/:entryId/duplicate',
    async (ctx) => {
      const workerEnv = env as unknown as Env
      const tenantCtx = hasTenantContext(ctx) ? ctx.tenant : undefined
      const { db } = resolveTenantBindings(tenantCtx, workerEnv)
      const result = await entriesService.duplicate(
        db,
        ctx.params.entryId,
        ctx.user?.id,
        tenantCtx?.tenant.id
      )
      if (!result.success) {
        ctx.set.status = result.error.code === 'NOT_FOUND' ? 404 : 400
        return { success: false as const, error: result.error }
      }
      ctx.set.status = 201
      return { success: true as const, data: result.data }
    },
    { auth: true }
  )

  /**
   * GET /:entryId — Get an entry by ID.
   * Optional query params: populate (comma-separated field names), depth (1-3), locale
   */
  .get(
    '/:entryId',
    async (ctx) => {
      const workerEnv = env as unknown as Env
      const tenantCtx = hasTenantContext(ctx) ? ctx.tenant : undefined
      const { db } = resolveTenantBindings(tenantCtx, workerEnv)
      const { params, query } = ctx
      const result = await entriesService.findByIdWithLocaleAndPopulate(db, params.entryId, {
        locale: query.locale,
        populate: query.populate,
        depth: query.depth,
      }, tenantCtx?.tenant.id)
      if (!result.success) {
        return { success: false as const, error: result.error }
      }
      return { success: true as const, data: result.data }
    },
    {
      auth: true,
      query: t.Object({
        populate: t.Optional(t.String()),
        depth: t.Optional(t.String()),
        locale: t.Optional(t.String()),
      }),
    }
  )

  /**
   * POST / — Create a new entry.
   */
  .post(
    '/',
    async (ctx) => {
      const workerEnv = env as unknown as Env
      const tenantCtx = hasTenantContext(ctx) ? ctx.tenant : undefined
      const { db } = resolveTenantBindings(tenantCtx, workerEnv)
      const result = await entriesService.create(db, ctx.body, ctx.user?.id, tenantCtx?.tenant.id)
      if (!result.success) {
        ctx.set.status = result.error.code === 'NOT_FOUND' ? 404 : 400
        return { success: false as const, error: result.error }
      }
      ctx.set.status = 201
      return { success: true as const, data: result.data }
    },
    {
      auth: true,
      body: t.Object({
        collectionId: t.String({ minLength: 1 }),
        slug: t.Optional(t.String()),
        status: t.Optional(t.String()),
        data: t.Record(t.String(), t.Unknown()),
      }),
    }
  )

  /**
   * PUT /:entryId — Update an entry by ID.
   */
  .put(
    '/:entryId',
    async (ctx) => {
      const workerEnv = env as unknown as Env
      const tenantCtx = hasTenantContext(ctx) ? ctx.tenant : undefined
      const { db } = resolveTenantBindings(tenantCtx, workerEnv)
      const result = await entriesService.update(
        db,
        ctx.params.entryId,
        ctx.body,
        ctx.user?.id,
        undefined,
        tenantCtx?.tenant.id
      )
      if (!result.success) {
        ctx.set.status = result.error.code === 'NOT_FOUND' ? 404 : 400
        return { success: false as const, error: result.error }
      }
      return { success: true as const, data: result.data }
    },
    {
      auth: true,
      body: t.Object({
        slug: t.Optional(t.String()),
        status: t.Optional(t.String()),
        data: t.Optional(t.Record(t.String(), t.Unknown())),
      }),
    }
  )

  /**
   * DELETE /:entryId — Delete an entry by ID.
   */
  .delete(
    '/:entryId',
    async (ctx) => {
      const workerEnv = env as unknown as Env
      const tenantCtx = hasTenantContext(ctx) ? ctx.tenant : undefined
      const { db } = resolveTenantBindings(tenantCtx, workerEnv)
      const result = await entriesService.deleteById(db, ctx.params.entryId, tenantCtx?.tenant.id)
      if (!result.success) {
        ctx.set.status = 404
        return { success: false as const, error: result.error }
      }
      return { success: true as const, data: result.data }
    },
    { auth: true }
  )
