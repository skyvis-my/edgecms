import { env } from 'cloudflare:workers'
import { Elysia, t } from 'elysia'
import { betterAuthPlugin } from '@/auth/auth.middleware'
import type { Env } from '@/env'
import { hasTenantContext, resolveTenantBindings } from '@/tenants/tenant-context'
import { versioningService } from './versioning.service'

/**
 * ElysiaJS controller for version management endpoints.
 *
 * All routes are protected with `{ auth: true }` and return responses
 * in the standard API envelope format.
 *
 * Registered under `/api/admin/entries/:entryId/versions` in the main app.
 */
export const versioningController = new Elysia({ prefix: '/api/admin/entries' })
  .use(betterAuthPlugin)

  /**
   * GET /:entryId/versions — List all versions for an entry (paginated).
   */
  .get(
    '/:entryId/versions',
    async (ctx) => {
      const workerEnv = env as unknown as Env
      const tenantCtx = hasTenantContext(ctx) ? ctx.tenant : undefined
      const { db } = resolveTenantBindings(tenantCtx, workerEnv)
      const { params, query } = ctx
      const page = query.page ? Number.parseInt(query.page, 10) : undefined
      const limit = query.limit ? Number.parseInt(query.limit, 10) : undefined

      const result = await versioningService.listVersions(db, params.entryId, { page, limit })

      if (!result.success) {
        return { success: false as const, error: result.error }
      }

      return { success: true as const, data: result.data }
    },
    {
      auth: true,
      query: t.Object({
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
    }
  )

  /**
   * GET /:entryId/versions/:versionId — Get a single version by ID.
   */
  .get(
    '/:entryId/versions/:versionId',
    async (ctx) => {
      const workerEnv = env as unknown as Env
      const tenantCtx = hasTenantContext(ctx) ? ctx.tenant : undefined
      const { db } = resolveTenantBindings(tenantCtx, workerEnv)
      const result = await versioningService.getVersion(
        db,
        ctx.params.entryId,
        ctx.params.versionId
      )

      if (!result.success) {
        return { success: false as const, error: result.error }
      }

      return { success: true as const, data: result.data }
    },
    { auth: true }
  )

  /**
   * GET /:entryId/versions/:versionId/diff/:targetVersionId — Compute diff between two versions.
   */
  .get(
    '/:entryId/versions/:versionId/diff/:targetVersionId',
    async (ctx) => {
      const workerEnv = env as unknown as Env
      const tenantCtx = hasTenantContext(ctx) ? ctx.tenant : undefined
      const { db } = resolveTenantBindings(tenantCtx, workerEnv)
      const result = await versioningService.diffVersions(
        db,
        ctx.params.entryId,
        ctx.params.versionId,
        ctx.params.targetVersionId
      )

      if (!result.success) {
        return { success: false as const, error: result.error }
      }

      return { success: true as const, data: result.data }
    },
    { auth: true }
  )

  /**
   * POST /:entryId/versions/:versionId/rollback — Rollback entry to a specific version.
   */
  .post(
    '/:entryId/versions/:versionId/rollback',
    async (ctx) => {
      const workerEnv = env as unknown as Env
      const tenantCtx = hasTenantContext(ctx) ? ctx.tenant : undefined
      const { db } = resolveTenantBindings(tenantCtx, workerEnv)
      const userId = ctx.user?.id

      const result = await versioningService.rollback(
        db,
        ctx.params.entryId,
        ctx.params.versionId,
        userId,
        tenantCtx?.tenant.slug ?? null
      )

      if (!result.success) {
        ctx.set.status = result.error.code === 'NOT_FOUND' ? 404 : 400
        return { success: false as const, error: result.error }
      }

      return {
        success: true as const,
        data: {
          ...result.data,
          message: `Successfully rolled back to version ${result.data.newVersion.version}`,
        },
      }
    },
    { auth: true }
  )
