import { Elysia, t } from 'elysia'
import { betterAuthPlugin } from '@/auth/auth.middleware'
import { toServiceResponse } from '@/shared/utils/service-response'
import { withTenantBindings } from '@/tenants/with-tenant-bindings'
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
  .use(withTenantBindings)

  /**
   * GET /:entryId/versions — List all versions for an entry (paginated).
   */
  .get('/:entryId/versions', {
    auth: true,
    params: t.Object({
      entryId: t.String({ minLength: 1 }),
    }),
    query: t.Object({
      page: t.Optional(t.String()),
      limit: t.Optional(t.String()),
    }),
  }, async ({ db, params, query, set }) => {
    const page = query.page ? Number.parseInt(query.page, 10) : undefined
    const limit = query.limit ? Number.parseInt(query.limit, 10) : undefined
    return toServiceResponse(
      set,
      await versioningService.listVersions(db, params.entryId, { page, limit })
    )
  })

  /**
   * GET /:entryId/versions/:versionId — Get a single version by ID.
   */
  .get('/:entryId/versions/:versionId', {
    auth: true,
    params: t.Object({
      entryId: t.String({ minLength: 1 }),
      versionId: t.String({ minLength: 1 }),
    }),
  }, async ({ db, params, set }) => {
    return toServiceResponse(
      set,
      await versioningService.getVersion(db, params.entryId, params.versionId)
    )
  })

  /**
   * GET /:entryId/versions/:versionId/diff/:targetVersionId — Compute diff between two versions.
   */
  .get('/:entryId/versions/:versionId/diff/:targetVersionId', {
    auth: true,
    params: t.Object({
      entryId: t.String({ minLength: 1 }),
      versionId: t.String({ minLength: 1 }),
      targetVersionId: t.String({ minLength: 1 }),
    }),
  }, async ({ db, params, set }) => {
    return toServiceResponse(
      set,
      await versioningService.diffVersions(
        db,
        params.entryId,
        params.versionId,
        params.targetVersionId
      )
    )
  })

  /**
   * POST /:entryId/versions/:versionId/rollback — Rollback entry to a specific version.
   */
  .post('/:entryId/versions/:versionId/rollback', {
    auth: true,
    params: t.Object({
      entryId: t.String({ minLength: 1 }),
      versionId: t.String({ minLength: 1 }),
    }),
  }, async ({ db, params, user, set, tenantCtx }) => {
    const userId = user?.id

    const result = await versioningService.rollback(
      db,
      params.entryId,
      params.versionId,
      userId,
      tenantCtx?.tenant.slug ?? null
    )

    if (!result.success) {
      return toServiceResponse(set, result)
    }

    return {
      success: true as const,
      data: {
        ...result.data,
        message: `Successfully rolled back to version ${result.data.newVersion.version}`,
      },
    }
  })
