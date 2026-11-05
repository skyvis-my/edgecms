import { Elysia, t } from 'elysia'
import { betterAuthPlugin } from '@/auth/auth.middleware'
import { createErrorEnvelope, toServiceResponse } from '@/shared/utils/service-response'
import { getRequestContentAccess, requestCanAccessContent } from '@/auth/content-access'
import { withTenantBindings } from '@/tenants/with-tenant-bindings'
import { versioningService } from './versioning.service'
import type { CommandContext } from '@/commands/engine'
import type { WaitUntilContext } from '@/commands/deferred-work'
import { createCommandHostHooks } from '@/host/command-hooks'
import { getHostRuntime } from '@/host/host-context'
import { getRequestPathname } from '@/shared/utils/request-url'

/** Cloudflare `waitUntil` from the Elysia context, when the runtime has it. */
function getExecutionCtx(elysiaCtx: unknown): WaitUntilContext | undefined {
  const waitUntil = (elysiaCtx as { waitUntil?: unknown }).waitUntil
  if (typeof waitUntil !== 'function') return undefined
  const fn = waitUntil as (promise: Promise<unknown>) => void
  return { waitUntil: (promise) => fn.call(elysiaCtx, promise) }
}

const ROLLBACK_ERROR_STATUS: Record<string, number> = {
  VERSION_CONFLICT: 409,
  INTERNAL_ERROR: 500,
}

/**
 * ElysiaJS controller for version management endpoints.
 *
 * All routes are protected with `{ auth: true }` and return responses
 * in the standard API envelope format.
 *
 * Registered under `/api/admin/entries/:entryId/versions` in the main app.
 */
const CONTENT_FORBIDDEN = createErrorEnvelope(
  'FORBIDDEN',
  'Your role cannot access entries in this collection'
)

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
  }, async ({ db, params, query, request, set, tenantCtx }) => {
    if (
      !(await requestCanAccessContent(request, db, tenantCtx?.tenant.id, 'read', { entryIds: [params.entryId] }))
    ) {
      set.status = 403
      return CONTENT_FORBIDDEN
    }
    const page = query.page ? Number.parseInt(query.page, 10) : undefined
    const limit = query.limit ? Number.parseInt(query.limit, 10) : undefined
    return toServiceResponse(
      set,
      await versioningService.listVersions(db, params.entryId, {
        page,
        limit,
        tenantId: tenantCtx?.tenant.id,
      })
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
  }, async ({ db, params, request, set, tenantCtx }) => {
    if (
      !(await requestCanAccessContent(request, db, tenantCtx?.tenant.id, 'read', { entryIds: [params.entryId] }))
    ) {
      set.status = 403
      return CONTENT_FORBIDDEN
    }
    return toServiceResponse(
      set,
      await versioningService.getVersion(db, params.entryId, params.versionId, tenantCtx?.tenant.id)
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
  }, async ({ db, params, request, set, tenantCtx }) => {
    if (
      !(await requestCanAccessContent(request, db, tenantCtx?.tenant.id, 'read', { entryIds: [params.entryId] }))
    ) {
      set.status = 403
      return CONTENT_FORBIDDEN
    }
    return toServiceResponse(
      set,
      await versioningService.diffVersions(
        db,
        params.entryId,
        params.versionId,
        params.targetVersionId,
        tenantCtx?.tenant.id
      )
    )
  })

  /**
   * POST /:entryId/versions/:versionId/rollback — Rollback entry to a specific version.
   *
   * P3: runs as an `updateEntry` command through the command engine (see
   * `versioningService.rollback`). `?dryRun=true` previews the change.
   */
  .post('/:entryId/versions/:versionId/rollback', {
    auth: true,
    params: t.Object({
      entryId: t.String({ minLength: 1 }),
      versionId: t.String({ minLength: 1 }),
    }),
    query: t.Object({
      dryRun: t.Optional(t.String()),
    }),
  }, async (elysiaCtx) => {
    const { db, kv, workerEnv, params, query, request, user, set, tenantCtx } = elysiaCtx
    if (
      !(await requestCanAccessContent(request, db, tenantCtx?.tenant.id, 'update', { entryIds: [params.entryId] }))
    ) {
      set.status = 403
      return CONTENT_FORBIDDEN
    }

    const actor = { userId: user.id, source: 'admin' as const }
    const ctx: CommandContext = {
      db,
      actor,
      tenantScope: tenantCtx?.tenant.id,
      kv,
      env: workerEnv,
      executionCtx: getExecutionCtx(elysiaCtx),
      syncChannel: tenantCtx?.tenant.id ?? 'global',
      hostHooks: createCommandHostHooks(getHostRuntime(request), {
        source: elysiaCtx,
        tenant: tenantCtx?.tenant,
        actorId: user.id,
      }),
      requestMeta: {
        requestId: crypto.randomUUID(),
        pathname: getRequestPathname(request),
        method: request.method,
      },
      contentAccess: await getRequestContentAccess(request),
    }

    const result = await versioningService.rollback(ctx, params.entryId, params.versionId, {
      tenantId: tenantCtx?.tenant.id,
      dryRun: query.dryRun === 'true',
    })

    if (!result.success) {
      return toServiceResponse(set, result, { errorStatusMap: ROLLBACK_ERROR_STATUS })
    }

    if (ctx.invalidatedCacheTags && ctx.invalidatedCacheTags.length > 0) {
      const purgeHeaderValue = ctx.invalidatedCacheTags.join(',')
      set.headers['Cache-Tag-Purge'] = purgeHeaderValue
      set.headers['X-Cache-Tag-Purge'] = purgeHeaderValue
      set.headers['CF-Cache-Purge'] = purgeHeaderValue
    }

    if (result.data.dryRun) {
      return { success: true as const, data: result.data }
    }

    return {
      success: true as const,
      data: {
        ...result.data,
        message: `Successfully rolled back to version ${result.data.newVersion.version}`,
      },
    }
  })
