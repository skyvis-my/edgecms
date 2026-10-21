import { Elysia, t } from 'elysia'
import { betterAuthPlugin } from '@/auth/auth.middleware'
import type { Env } from '@/env'
import { logger } from '@/observability/logger'
import type { CommandEnvelope, CommandResult } from '@edgecms/schemas/commands'
import { withTenantBindings } from '@/tenants/with-tenant-bindings'
import { eventBus } from '@/webhooks/event-bus'
import { initWebhookProducer } from '@/webhooks/queue-producer'
import { type CommandContext, executeCommand } from './engine'
import type { WaitUntilContext } from './deferred-work'
import { getRequestPathname } from '@/shared/utils/request-url'
import { createErrorEnvelope } from '@/shared/utils/service-response'
import { createCommandHostHooks, getCommandLimitError } from '@/host/command-hooks'
import { getHostRuntime } from '@/host/host-context'

/**
 * Resolve the Cloudflare execution context from the Elysia request context.
 * Mirrors the assets controller `getDeferredWorkScheduler` pattern: Elysia
 * exposes `waitUntil` on the request context on Workers; absent in tests and
 * non-worker runtimes (engine falls back to detached execution).
 */
function getCommandExecutionCtx(elysiaCtx: unknown): WaitUntilContext | undefined {
  const waitUntil = (elysiaCtx as { waitUntil?: unknown }).waitUntil
  if (typeof waitUntil !== 'function') return undefined
  const fn = waitUntil as (promise: Promise<unknown>) => void
  return { waitUntil: (promise) => fn.call(elysiaCtx, promise) }
}

const COMMAND_ERROR_STATUS_MAP: Record<string, number> = {
  VERSION_CONFLICT: 409,
  NOT_FOUND: 404,
  BAD_REQUEST: 400,
  VALIDATION_ERROR: 400,
  INVALID_COMMAND_TYPE: 400,
  UNKNOWN_COMMAND: 400,
  INVALID_TRANSITION: 400,
  INVALID_STATUS_TRANSITION: 400,
  INVALID_PREVIEW_RECEIPT: 400,
  UNAUTHORIZED: 403,
}

export function initializeWebhookProducerIfNeeded(
  workerEnv: Env,
  bus: typeof eventBus
): void {
  if (!workerEnv.WEBHOOK_QUEUE) return
  try {
    initWebhookProducer(bus, workerEnv.DB, workerEnv.WEBHOOK_QUEUE)
  } catch (err) {
    logger.error('webhook_producer_init_failed', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/**
 * ElysiaJS controller for the command engine.
 *
 * All CMS mutations go through this single endpoint, which validates
 * the command envelope and delegates execution to the command engine.
 *
 * Registered under `/api/admin/commands` in the main app.
 */
export const commandsController = new Elysia({ prefix: '/api/admin/commands', normalize: 'typebox' })
  .use(betterAuthPlugin)
  .use(withTenantBindings)

  /**
   * POST / — Execute a command through the command engine.
   *
   * This is the main entry point for all CMS mutations. Admin mutations
   * should prefer this endpoint over direct CRUD operations to ensure
   * proper versioning, audit logging, and command replay.
   *
   * Security: The authenticated user's ID overrides the actor.userId from
   * the request body to prevent impersonation.
   *
   * Error handling maps engine failures to HTTP status codes:
   * - VERSION_CONFLICT → 409
   * - NOT_FOUND → 404
   * - VALIDATION_ERROR, INVALID_COMMAND_TYPE → 400
   * - UNAUTHORIZED → 403
   * - Other errors → 500
   */
  .post('/', {
    auth: true,
    body: t.Object({
      type: t.Union([
        t.Literal('createEntry'),
        t.Literal('updateEntry'),
        t.Literal('deleteEntry'),
        t.Literal('bulkUpdate'),
        t.Literal('updateSingleton'),
        t.Literal('linkRelation'),
        t.Literal('unlinkRelation'),
        t.Literal('publishNow'),
        t.Literal('unpublishNow'),
        t.Literal('schedulePublish'),
        t.Literal('scheduleUnpublish'),
        t.Literal('cancelSchedule'),
        t.Literal('transaction'),
      ]),
      payload: t.Record(t.String(), t.Unknown()),
      actor: t.Object({
        userId: t.String({ minLength: 1 }),
        source: t.Union([
          t.Literal('admin'),
          t.Literal('ai'),
          t.Literal('sync'),
          t.Literal('scheduler'),
        ]),
      }),
      optimisticVersion: t.Optional(t.Integer({ minimum: 1 })),
      transactionId: t.Optional(t.String({ minLength: 1 })),
      dryRun: t.Optional(t.Boolean()),
      previewReceipt: t.Optional(t.String({ minLength: 1 })),
      idempotencyKey: t.Optional(t.String({ minLength: 1 })),
      timestamp: t.String(),
    }),
  }, async (elysiaCtx) => {
    const { body, user, set, db, kv, workerEnv, tenantCtx } = elysiaCtx
    const requestPathname = getRequestPathname(elysiaCtx.request)
    const syncChannel = tenantCtx?.tenant.id ?? 'global'
  
    const idempotencyKey =
      (elysiaCtx.headers as Record<string, string | undefined>)['idempotency-key'] ||
      elysiaCtx.request.headers.get('idempotency-key') ||
      (body as { idempotencyKey?: string }).idempotencyKey
  
    // Build command envelope — override actor.userId with authenticated user for security
    const envelope: CommandEnvelope = {
      type: body.type as CommandEnvelope['type'],
      payload: body.payload,
      actor: {
        userId: user.id,
        source: body.actor.source as 'admin' | 'ai' | 'sync' | 'scheduler',
      },
      optimisticVersion: body.optimisticVersion,
      transactionId: body.transactionId,
      dryRun: body.dryRun,
      previewReceipt: body.previewReceipt,
      idempotencyKey: idempotencyKey || undefined,
      timestamp: body.timestamp,
    }
  
    // Construct command context with KV namespace for cache invalidation
    const ctx: CommandContext = {
      db,
      actor: envelope.actor,
      tenantScope: tenantCtx?.tenant.id,
      kv,
      env: workerEnv,
      executionCtx: getCommandExecutionCtx(elysiaCtx),
      syncChannel,
      idempotencyKey: idempotencyKey || undefined,
      hostHooks: createCommandHostHooks(getHostRuntime(elysiaCtx.request), {
        source: elysiaCtx,
        tenant: tenantCtx?.tenant,
        actorId: user.id,
      }),
      requestMeta: {
        requestId:
          (elysiaCtx as unknown as { requestId?: string }).requestId ?? crypto.randomUUID(),
        pathname: requestPathname,
        method: elysiaCtx.request.method,
      },
    }
  
    // Execute command through engine
    const result: CommandResult = await executeCommand(ctx, envelope)
  
    // Map result status to HTTP status code
    if (result.status === 'success') {
      // Set CDN Cache-Tag purge headers if cache invalidation was triggered
      if (ctx.invalidatedCacheTags && ctx.invalidatedCacheTags.length > 0) {
        const purgeHeaderValue = ctx.invalidatedCacheTags.join(',')
        set.headers['Cache-Tag-Purge'] = purgeHeaderValue
        set.headers['X-Cache-Tag-Purge'] = purgeHeaderValue
        set.headers['CF-Cache-Purge'] = purgeHeaderValue
      }
  
      // Special case: createEntry returns 201 Created
      if (result.type === 'createEntry') {
        set.status = 201
      } else {
        set.status = 200
      }
      return { success: true as const, data: result }
    }
  
    if (result.status === 'dry_run') {
      set.status = 200
      return { success: true as const, data: result }
    }
  
    // HS-06: limit rejections carry the dimension and upgrade link.
    const limitError = getCommandLimitError(result)
    if (limitError && result.error) {
      set.status = limitError.status
      return createErrorEnvelope(result.error.code, result.error.message, limitError.details)
    }

    // Error handling — map error codes to HTTP status
    if (result.error) {
      set.status = COMMAND_ERROR_STATUS_MAP[result.error.code] ?? 500
      return createErrorEnvelope(result.error.code, result.error.message)
    }
  
    // Fallback error for unexpected states
    set.status = 500
    return createErrorEnvelope('INTERNAL_ERROR', 'Command execution failed with unknown error')
  })
