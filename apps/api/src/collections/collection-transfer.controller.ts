import { Elysia, t } from 'elysia'
import { betterAuthPlugin } from '@/auth/auth.middleware'
import { getRequestContentAccess } from '@/auth/content-access'
import { createCommandHostHooks } from '@/host/command-hooks'
import { getHostRuntime } from '@/host/host-context'
import { getRequestPathname } from '@/shared/utils/request-url'
import { createErrorEnvelope } from '@/shared/utils/service-response'
import { withTenantBindings } from '@/tenants/with-tenant-bindings'
import {
  collectionTransferService,
  type TransferContext,
  type TransferError,
} from './collection-transfer.service'

const ERROR_STATUS: Record<string, number> = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  DRY_RUN_FAILED: 422,
}

function errorResponse(set: { status?: number | string | unknown }, error: TransferError) {
  set.status = error.status ?? ERROR_STATUS[error.code] ?? 400
  return createErrorEnvelope(error.code, error.message, error.reason ? { reason: error.reason } : undefined)
}

type RequestScope = {
  request: Request
  user?: unknown
  db: TransferContext['db']
  kv: KVNamespace
  workerEnv: TransferContext['env']
  tenantCtx?: { tenant: { id: string } }
}

async function transferContext(scope: RequestScope): Promise<TransferContext | undefined> {
  const userId = (scope.user as { id?: string } | undefined)?.id
  if (!scope.tenantCtx?.tenant || !userId) return undefined
  return {
    db: scope.db,
    kv: scope.kv,
    env: scope.workerEnv,
    tenantId: scope.tenantCtx.tenant.id,
    actor: { userId },
    contentAccess: await getRequestContentAccess(scope.request),
    requestMeta: {
      requestId: crypto.randomUUID(),
      pathname: getRequestPathname(scope.request),
      method: scope.request.method,
    },
  }
}

const strategy = t.Optional(t.Union([t.Literal('skip'), t.Literal('update')]))

/**
 * OP-06: collection export and non-destructive import.
 *
 * - GET  /api/admin/collections/:collectionSlug/export
 * - POST /api/admin/collections/:collectionSlug/import/preview  — plan + receipt, writes no content
 * - POST /api/admin/collections/:collectionSlug/import/execute  — runs exactly the previewed plan
 *
 * Tenant routes only. The request guard treats these as content routes
 * (PL-03); the service and the command engine check per-collection grants.
 */
export const collectionTransferController = new Elysia({ prefix: '/api/admin/collections' })
  .use(betterAuthPlugin)
  .use(withTenantBindings)
  .get('/:collectionSlug/export', { auth: true }, async (ctx) => {
    const { params, set } = ctx
    const transferCtx = await transferContext(ctx)
    if (!transferCtx) {
      set.status = 400
      return createErrorEnvelope('TENANT_REQUIRED', 'Tenant context is required')
    }
    const result = await collectionTransferService.exportCollection(transferCtx, params.collectionSlug)
    if (!result.success) return errorResponse(set, result.error)
    set.headers['cache-control'] = 'no-store'
    return { success: true as const, data: result.data }
  })

  .post(
    '/:collectionSlug/import/preview',
    { auth: true, body: t.Object({ document: t.Unknown(), strategy }) },
    async (ctx) => {
      const { params, body, set } = ctx
      const transferCtx = await transferContext(ctx)
      if (!transferCtx) {
        set.status = 400
        return createErrorEnvelope('TENANT_REQUIRED', 'Tenant context is required')
      }
      const result = await collectionTransferService.previewImport(transferCtx, params.collectionSlug, body)
      if (!result.success) return errorResponse(set, result.error)
      return { success: true as const, data: result.data }
    }
  )

  .post(
    '/:collectionSlug/import/execute',
    {
      auth: true,
      body: t.Object({ document: t.Unknown(), strategy, previewReceipt: t.String({ minLength: 1 }) }),
    },
    async (elysiaCtx) => {
      const { params, body, set, tenantCtx, request } = elysiaCtx
      const transferCtx = await transferContext(elysiaCtx)
      if (!transferCtx) {
        set.status = 400
        return createErrorEnvelope('TENANT_REQUIRED', 'Tenant context is required')
      }
      const result = await collectionTransferService.executeImport(
        {
          ...transferCtx,
          hostHooks: createCommandHostHooks(getHostRuntime(request), {
            source: elysiaCtx,
            tenant: tenantCtx?.tenant,
            actorId: transferCtx.actor.userId,
          }),
        },
        params.collectionSlug,
        body
      )
      if (!result.success) return errorResponse(set, result.error)
      // 207: some commands ran and some did not (D1 has no rollback).
      set.status = result.data.status === 'partial_failure' ? 207 : 200
      return { success: true as const, data: result.data }
    }
  )
