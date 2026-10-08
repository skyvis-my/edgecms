import { env } from 'cloudflare:workers'
import { Elysia, t } from 'elysia'
import { betterAuthPlugin } from '@/auth/auth.middleware'
import type { Env } from '@/env'
import { hasTenantContext, resolveTenantBindings } from '@/tenants/tenant-context'
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

  /**
   * GET / — List all collections.
   */
  .get(
    '/',
    async (ctx) => {
      const workerEnv = env as unknown as Env
      const tenantCtx = hasTenantContext(ctx) ? ctx.tenant : undefined
      const { db } = resolveTenantBindings(tenantCtx, workerEnv)
      const result = await collectionsService.findAll(db, tenantCtx?.tenant.id)
      if (!result.success) {
        return { success: false as const, error: result.error }
      }
      return { success: true as const, data: result.data }
    },
    { auth: true }
  )

  /**
   * GET /:collectionIdOrSlug — Get a collection by ID or slug.
   */
  .get(
    '/:collectionIdOrSlug',
    async (ctx) => {
      const workerEnv = env as unknown as Env
      const tenantCtx = hasTenantContext(ctx) ? ctx.tenant : undefined
      const { db } = resolveTenantBindings(tenantCtx, workerEnv)
      const result = await collectionsService.findByIdOrSlug(
        db,
        ctx.params.collectionIdOrSlug,
        tenantCtx?.tenant.id
      )
      if (!result.success) {
        return { success: false as const, error: result.error }
      }
      return { success: true as const, data: result.data }
    },
    { auth: true }
  )

  /**
   * POST / — Create a new collection.
   */
  .post(
    '/',
    async (ctx) => {
      const workerEnv = env as unknown as Env
      const tenantCtx = hasTenantContext(ctx) ? ctx.tenant : undefined
      const { db } = resolveTenantBindings(tenantCtx, workerEnv)
      const result = await collectionsService.create(db, ctx.body, tenantCtx?.tenant.id)
      if (!result.success) {
        ctx.set.status = 400
        return { success: false as const, error: result.error }
      }
      ctx.set.status = 201
      return { success: true as const, data: result.data }
    },
    {
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
    }
  )

  /**
   * PUT /:collectionId — Update a collection by ID.
   */
  .put(
    '/:collectionId',
    async (ctx) => {
      const workerEnv = env as unknown as Env
      const tenantCtx = hasTenantContext(ctx) ? ctx.tenant : undefined
      const { db } = resolveTenantBindings(tenantCtx, workerEnv)
      const result = await collectionsService.update(
        db,
        ctx.params.collectionId,
        ctx.body,
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
      }),
    }
  )

  /**
   * DELETE /:collectionId — Delete a collection by ID.
   */
  .delete(
    '/:collectionId',
    async (ctx) => {
      const workerEnv = env as unknown as Env
      const tenantCtx = hasTenantContext(ctx) ? ctx.tenant : undefined
      const { db } = resolveTenantBindings(tenantCtx, workerEnv)
      const result = await collectionsService.deleteById(
        db,
        ctx.params.collectionId,
        tenantCtx?.tenant.id
      )
      if (!result.success) {
        ctx.set.status = 404
        return { success: false as const, error: result.error }
      }
      return { success: true as const, data: result.data }
    },
    { auth: true }
  )
