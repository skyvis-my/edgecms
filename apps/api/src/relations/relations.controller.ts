import { env } from 'cloudflare:workers'
import { Elysia, t } from 'elysia'
import { betterAuthPlugin } from '@/auth/auth.middleware'
import type { Env } from '@/env'
import { hasTenantContext, resolveTenantBindings } from '@/tenants/tenant-context'
import { relationsService } from './relations.service'

/**
 * ElysiaJS controller for relation CRUD endpoints.
 *
 * All routes are protected with `{ auth: true }` and return responses
 * in the standard API envelope format.
 *
 * Registered under `/api/admin/relations` in the main app.
 */
export const relationsController = new Elysia({ prefix: '/api/admin/relations' })
  .use(betterAuthPlugin)

  /**
   * POST /link — Link two entries.
   * Creates a relation between a source entry and a target entry.
   */
  .post(
    '/link',
    async (ctx) => {
      const workerEnv = env as unknown as Env
      const tenantCtx = hasTenantContext(ctx) ? ctx.tenant : undefined
      const { db } = resolveTenantBindings(tenantCtx, workerEnv)
      const result = await relationsService.link(db, ctx.body)
      if (!result.success) {
        if (result.error.code === 'NOT_FOUND') {
          ctx.set.status = 404
        } else if (
          result.error.code === 'CARDINALITY_VIOLATION' ||
          result.error.code === 'DUPLICATE_RELATION' ||
          result.error.code === 'VALIDATION_ERROR'
        ) {
          ctx.set.status = 400
        } else {
          ctx.set.status = 400
        }
        return { success: false as const, error: result.error }
      }
      ctx.set.status = 201
      return { success: true as const, data: result.data }
    },
    {
      auth: true,
      body: t.Object({
        sourceEntryId: t.String({ minLength: 1 }),
        targetEntryId: t.String({ minLength: 1 }),
        sourceCollectionId: t.String({ minLength: 1 }),
        targetCollectionId: t.String({ minLength: 1 }),
        relationType: t.Union([
          t.Literal('one-to-one'),
          t.Literal('one-to-many'),
          t.Literal('many-to-many'),
        ]),
        fieldName: t.String({ minLength: 1 }),
        sortOrder: t.Optional(t.Integer({ minimum: 0 })),
      }),
    }
  )

  /**
   * POST /unlink — Unlink two entries.
   * Removes a relation between a source entry and a target entry.
   */
  .post(
    '/unlink',
    async (ctx) => {
      const workerEnv = env as unknown as Env
      const tenantCtx = hasTenantContext(ctx) ? ctx.tenant : undefined
      const { db } = resolveTenantBindings(tenantCtx, workerEnv)
      const result = await relationsService.unlink(db, ctx.body)
      if (!result.success) {
        ctx.set.status = 404
        return { success: false as const, error: result.error }
      }
      return { success: true as const, data: result.data }
    },
    {
      auth: true,
      body: t.Object({
        sourceEntryId: t.String({ minLength: 1 }),
        targetEntryId: t.String({ minLength: 1 }),
        fieldName: t.String({ minLength: 1 }),
      }),
    }
  )

  /**
   * GET /:entryId — List relations for an entry.
   * Returns all relations where the given entry is the source.
   * Optional query param: fieldName to filter by specific field.
   */
  .get(
    '/:entryId',
    async (ctx) => {
      const workerEnv = env as unknown as Env
      const tenantCtx = hasTenantContext(ctx) ? ctx.tenant : undefined
      const { db } = resolveTenantBindings(tenantCtx, workerEnv)
      const result = await relationsService.getRelationsForEntry(
        db,
        ctx.params.entryId,
        ctx.query.fieldName
      )
      if (!result.success) {
        return { success: false as const, error: result.error }
      }
      return { success: true as const, data: result.data }
    },
    {
      auth: true,
      query: t.Object({
        fieldName: t.Optional(t.String()),
      }),
    }
  )
