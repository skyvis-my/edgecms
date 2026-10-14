import { Elysia, t } from 'elysia'
import { betterAuthPlugin } from '@/auth/auth.middleware'
import { withTenantBindings } from '@/tenants/with-tenant-bindings'
import { entriesService } from './entries.service'
import { parsePublicFilters, buildDrizzleConditions, buildSortClause } from '@/public/query-filter'
import { toServiceResponse, createErrorEnvelope } from '@/shared/utils/service-response'

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
  .use(withTenantBindings)

  /**
   * GET / — List entries with optional filtering.
   * Query params: collectionId, status, page, perPage, populate, depth, locale
   * Filter params: filter[field][operator]=value, sort=-field1,field2
   */
  .get('/', {
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
  }, async ({ db, query, set, tenantCtx }) => {
    if (!tenantCtx?.tenant) {
      set.status = 400
      return createErrorEnvelope('TENANT_REQUIRED', 'Tenant context is required')
    }
    // Parse filter and sort params from query string
    const allQueryParams = query as Record<string, string | undefined>
    const { filters, sort, errors } = parsePublicFilters(allQueryParams)

    if (errors.length > 0) {
      set.status = 400
      return createErrorEnvelope('VALIDATION_ERROR', errors.join('; '))
    }

    const extraConditions = buildDrizzleConditions(filters)
    const orderByClause = buildSortClause(sort)

    const rawPage = query.page ? Number(query.page) : undefined
    const rawPerPage = query.perPage ? Number(query.perPage) : undefined
    const result = await entriesService.findAllWithLocaleAndPopulate(db, {
      collectionId: query.collectionId,
      collectionSlug: query.collectionSlug,
      status: query.status,
      page: rawPage !== undefined ? (Number.isFinite(rawPage) ? Math.floor(rawPage) : 1) : undefined,
      perPage:
        rawPerPage !== undefined
          ? Math.min(100, Math.max(1, Number.isFinite(rawPerPage) ? Math.floor(rawPerPage) : 20))
          : undefined,
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
  })

  /**
   * GET /batch — Get multiple entries by ID in a single request.
   * Query params: ids (comma-separated entry IDs, max 50)
   *
   * Must be registered before /:entryId to avoid route shadowing.
   */
  .get('/batch', {
    auth: true,
    query: t.Object({
      ids: t.String({ minLength: 1 }),
    }),
  }, async ({ db, query, set, tenantCtx }) => {
    if (!tenantCtx) {
      set.status = 400
      return createErrorEnvelope('TENANT_REQUIRED', 'Tenant context is required')
    }
    const ids = query.ids.split(',').filter(Boolean)
    if (ids.length === 0) {
      set.status = 400
      return createErrorEnvelope('VALIDATION_ERROR', 'At least one valid ID is required')
    }
    const result = await entriesService.findByIds(db, ids, tenantCtx.tenant.id)
    return toServiceResponse(set, result)
  })

  /**
   * POST /:entryId/duplicate — Duplicate an entry by ID.
   * Creates a copy with draft status and a new slug ending in -copy.
   */
  .post('/:entryId/duplicate', { auth: true }, async ({ db, params, user, set, tenantCtx }) => {
    const result = await entriesService.duplicate(
      db,
      params.entryId,
      user?.id,
      tenantCtx?.tenant.id
    )
    return toServiceResponse(set, result, { successStatus: 201 })
  })

  /**
   * GET /:entryId — Get an entry by ID.
   * Optional query params: populate (comma-separated field names), depth (1-3), locale
   */
  .get('/:entryId', {
    auth: true,
    query: t.Object({
      populate: t.Optional(t.String()),
      depth: t.Optional(t.String()),
      locale: t.Optional(t.String()),
    }),
  }, async ({ db, params, query, set, tenantCtx }) => {
    if (!tenantCtx?.tenant) {
      set.status = 400
      return createErrorEnvelope('TENANT_REQUIRED', 'Tenant context is required')
    }
    return toServiceResponse(
      set,
      await entriesService.findByIdWithLocaleAndPopulate(db, params.entryId, {
        locale: query.locale,
        populate: query.populate,
        depth: query.depth,
      }, tenantCtx?.tenant.id),
      { errorStatusMap: { NOT_FOUND: 200 }, defaultErrorStatus: 200 }
    )
  })

  /**
   * POST / — Create a new entry.
   */
  .post('/', {
    auth: true,
    body: t.Object({
      collectionId: t.String({ minLength: 1 }),
      slug: t.Optional(t.String()),
      status: t.Optional(t.String()),
      data: t.Record(t.String(), t.Unknown()),
    }),
  }, async ({ db, body, user, set, tenantCtx }) => {
    const result = await entriesService.create(db, body, user?.id, tenantCtx?.tenant.id)
    return toServiceResponse(set, result, { successStatus: 201 })
  })

  /**
   * PUT /:entryId — Update an entry by ID.
   */
  .put('/:entryId', {
    auth: true,
    body: t.Object({
      slug: t.Optional(t.String()),
      status: t.Optional(t.String()),
      data: t.Optional(t.Record(t.String(), t.Unknown())),
    }),
  }, async ({ db, params, body, user, set, tenantCtx }) => {
    const result = await entriesService.update(
      db,
      params.entryId,
      body,
      user?.id,
      undefined,
      tenantCtx?.tenant.id
    )
    return toServiceResponse(set, result)
  })

  /**
   * DELETE /:entryId — Delete an entry by ID.
   */
  .delete('/:entryId', { auth: true }, async ({ db, params, set, tenantCtx }) => {
    const result = await entriesService.deleteById(db, params.entryId, tenantCtx?.tenant.id)
    return toServiceResponse(set, result, { defaultErrorStatus: 404 })
  })
