import { Elysia, t } from 'elysia'
import { betterAuthPlugin } from '@/auth/auth.middleware'
import { createErrorEnvelope, toServiceResponse } from '@/shared/utils/service-response'
import { withTenantBindings } from '@/tenants/with-tenant-bindings'
import { collectionsService } from './collections.service'

/**
 * ElysiaJS controller for collection CRUD endpoints.
 *
 * All routes are protected with `{ auth: true }` and return responses
 * in the standard API envelope format.
 *
 * Note: These endpoints provide direct CRUD access for internal use and reads.
 * For admin mutations with versioning and audit logging, prefer using the
 * command endpoint at POST /api/admin/commands.
 *
 * Registered under `/api/admin/collections` in the main app.
 */
export const collectionsController = new Elysia({ prefix: '/api/admin/collections' })
  .use(betterAuthPlugin)
  .use(withTenantBindings)

  /**
   * GET / — List all collections.
   */
  .get('/', { auth: true }, async ({ db, set, tenantCtx }) => {
    if (!tenantCtx?.tenant) {
      set.status = 400
      return createErrorEnvelope('TENANT_REQUIRED', 'Tenant context is required')
    }
    return toServiceResponse(set, await collectionsService.findAll(db, tenantCtx?.tenant.id))
  })

  /**
   * GET /:collectionIdOrSlug — Get a collection by ID or slug.
   */
  .get('/:collectionIdOrSlug', { auth: true }, async ({ db, params, set, tenantCtx }) => {
    if (!tenantCtx?.tenant) {
      set.status = 400
      return createErrorEnvelope('TENANT_REQUIRED', 'Tenant context is required')
    }
    return toServiceResponse(
      set,
      await collectionsService.findByIdOrSlug(
        db,
        params.collectionIdOrSlug,
        tenantCtx?.tenant.id
      ),
      { errorStatusMap: { NOT_FOUND: 200 }, defaultErrorStatus: 200 }
    )
  })

  /**
   * POST / — Create a new collection.
   */
  .post('/', {
    auth: true,
    body: t.Object({
      name: t.String({ minLength: 1 }),
      slug: t.Optional(t.String({ minLength: 1 })),
      singleton: t.Optional(t.Boolean()),
      fields: t.Array(
        t.Object({
          name: t.String({ minLength: 1 }),
          type: t.String({ minLength: 1 }),
          required: t.Boolean(),
          localizable: t.Boolean(),
          options: t.Optional(t.Record(t.String(), t.Unknown())),
        })
      ),
      defaultLocale: t.Optional(t.String()),
      supportedLocales: t.Optional(t.Array(t.String())),
      displayName: t.Optional(t.String()),
      description: t.Optional(t.String()),
      icon: t.Optional(t.String()),
      color: t.Optional(t.String()),
      listFields: t.Optional(t.Array(t.String())),
      searchFields: t.Optional(t.Array(t.String())),
      defaultSort: t.Optional(t.String()),
      defaultSortOrder: t.Optional(t.Union([t.Literal('asc'), t.Literal('desc')])),
    }),
  }, async ({ db, body, set, tenantCtx }) => {
    return toServiceResponse(
      set,
      await collectionsService.create(db, body, tenantCtx?.tenant.id),
      { successStatus: 201 }
    )
  })

  /**
   * PUT /:collectionId — Update a collection by ID.
   */
  .put('/:collectionId', {
    auth: true,
    body: t.Object({
      name: t.Optional(t.String({ minLength: 1 })),
      singleton: t.Optional(t.Boolean()),
      fields: t.Optional(
        t.Array(
          t.Object({
            name: t.String({ minLength: 1 }),
            type: t.String({ minLength: 1 }),
            required: t.Boolean(),
            localizable: t.Boolean(),
            options: t.Optional(t.Record(t.String(), t.Unknown())),
          })
        )
      ),
      defaultLocale: t.Optional(t.String()),
      supportedLocales: t.Optional(t.Array(t.String())),
      displayName: t.Optional(t.String()),
      description: t.Optional(t.String()),
      icon: t.Optional(t.String()),
      color: t.Optional(t.String()),
      listFields: t.Optional(t.Array(t.String())),
      searchFields: t.Optional(t.Array(t.String())),
      defaultSort: t.Optional(t.String()),
      defaultSortOrder: t.Optional(t.Union([t.Literal('asc'), t.Literal('desc')])),
      bypassManagedLock: t.Optional(t.Boolean()),
    }),
  }, async ({ db, params, body, set, tenantCtx }) => {
    return toServiceResponse(
      set,
      await collectionsService.update(
        db,
        params.collectionId,
        body,
        tenantCtx?.tenant.id
      )
    )
  })

  /**
   * DELETE /:collectionId — Delete a collection by ID.
   */
  .delete('/:collectionId', { auth: true }, async ({ db, params, set, tenantCtx }) => {
    return toServiceResponse(
      set,
      await collectionsService.deleteById(
        db,
        params.collectionId,
        tenantCtx?.tenant.id
      )
    )
  })
