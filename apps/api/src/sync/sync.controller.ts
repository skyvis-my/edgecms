import { env } from 'cloudflare:workers'
import { Elysia, t } from 'elysia'
import { betterAuthPlugin } from '@/auth/auth.middleware'
import { hasSuperAdminRole, isSuperAdminEmail, parseSuperAdminEmails } from '@/auth/super-admin'
import { executeCommand } from '@/commands/engine'
import type { Env } from '@/env'
import { incrementMetric } from '@/observability/metrics'
import {
  executeSyncPushCommands,
  MAX_SYNC_PULL_LIMIT,
  normalizeSyncPullLimit,
  pullSyncChanges,
} from '@/sync/sync.service'
import { type SyncEvent, subscribeSyncEvents } from '@/sync/sync-events'
import { hasTenantContext, resolveTenantBindings } from '@/tenants/tenant-context'
import { tenantsRepository } from '@/tenants/tenants.repository'
import { getRequestUrl } from '@/shared/utils/request-url'

const MAX_PUSH_COMMANDS = 100
const SSE_HEARTBEAT_MS = 25000
const SSE_EVENT_FLUSH_MS = 50

type SyncUserLike = {
  id: string
  role?: unknown
  email?: unknown
}

function isGlobalSyncAdmin(
  user: SyncUserLike,
  session: unknown,
  workerEnv: Env
): boolean {
  if (user.role === 'admin') return true
  if (hasSuperAdminRole(user.role)) return true
  if (hasSuperAdminRole((session as { role?: unknown } | undefined)?.role)) return true
  return (
    typeof user.email === 'string' &&
    isSuperAdminEmail(user.email, parseSuperAdminEmails(workerEnv.SUPER_ADMIN_EMAILS))
  )
}

async function resolveGlobalSyncSelector(params: {
  tenantSlug: string | undefined
  user: SyncUserLike
  session: unknown
  db: ReturnType<typeof resolveTenantBindings>['db']
  workerEnv: Env
}):
  Promise<
    | { ok: true; tenantScope?: string; includeAllTenants: boolean; syncChannel: string }
    | { ok: false; status: 403 | 404; code: 'FORBIDDEN' | 'NOT_FOUND'; message: string }
  > {
  const tenantSlug = params.tenantSlug?.trim()
  if (!tenantSlug) {
    return {
      ok: true,
      tenantScope: undefined,
      includeAllTenants: false,
      syncChannel: 'global',
    }
  }

  if (!isGlobalSyncAdmin(params.user, params.session, params.workerEnv)) {
    return {
      ok: false,
      status: 403,
      code: 'FORBIDDEN',
      message: 'Admin role required to select tenant scope on global sync routes',
    }
  }

  if (tenantSlug === '*') {
    return {
      ok: true,
      tenantScope: undefined,
      includeAllTenants: true,
      syncChannel: '*',
    }
  }

  const tenant = await tenantsRepository.findBySlug(params.db, tenantSlug)
  if (!tenant) {
    return {
      ok: false,
      status: 404,
      code: 'NOT_FOUND',
      message: `Tenant '${tenantSlug}' not found`,
    }
  }

  return {
    ok: true,
    tenantScope: tenant.id,
    includeAllTenants: false,
    syncChannel: tenant.id,
  }
}

/**
 * ElysiaJS controller for offline-first sync endpoints.
 *
 * Provides cursor-based sync protocol for pulling server changes and
 * pushing offline commands with conflict detection.
 *
 * All routes are protected with `{ auth: true }`.
 *
 * Registered under `/api/admin/sync` in the main app.
 */
export const syncController = new Elysia({ prefix: '/api/admin/sync' })
  .use(betterAuthPlugin)

  /**
   * GET /pull — Pull changes since cursor.
   *
   * Clients use this endpoint to fetch incremental updates from the server.
   * The cursor is the last sequence number the client has seen.
   *
   * Query params:
   * - cursor: number (default 0) — Last sequence number client has
   * - limit: number (default 100, max 500) — Max changes to return
   *
   * Response:
   * - changes: Array of change log entries
   * - cursor: number — New cursor value (last sequence in results, or same if empty)
   * - hasMore: boolean — Whether there are more changes beyond this batch
   */
  .get(
    '/pull',
    async (ctx) => {
      const workerEnv = env as unknown as Env
      const tenantCtx = hasTenantContext(ctx) ? ctx.tenant : undefined
      const { db } = resolveTenantBindings(tenantCtx, workerEnv)
      const { query } = ctx
      const cursor = query.cursor ?? 0
      const limit = normalizeSyncPullLimit(query.limit)
      let tenantScope = tenantCtx?.tenant.id
      let includeAllTenants = false

      if (!tenantCtx) {
        const scope = await resolveGlobalSyncSelector({
          tenantSlug: query.tenantSlug,
          user: ctx.user as SyncUserLike,
          session: (ctx as { session?: unknown }).session,
          db,
          workerEnv,
        })
        if (!scope.ok) {
          ctx.set.status = scope.status
          return {
            success: false as const,
            error: { code: scope.code, message: scope.message },
          }
        }
        tenantScope = scope.tenantScope
        includeAllTenants = scope.includeAllTenants
      }

      const pullPayload = await pullSyncChanges({
        db,
        cursor,
        limit,
        tenantScope,
        includeAllTenants,
      })

      incrementMetric('sync_pull_total', {
        status: 'success',
        hasMore: pullPayload.hasMore ? 'true' : 'false',
      })
      return {
        success: true as const,
        data: pullPayload,
      }
    },
    {
      auth: true,
      query: t.Object({
        cursor: t.Optional(t.Number({ minimum: 0 })),
        limit: t.Optional(t.Number({ minimum: 1, maximum: MAX_SYNC_PULL_LIMIT })),
        tenantSlug: t.Optional(t.String({ minLength: 1 })),
      }),
    }
  )

  /**
   * GET /stream — Subscribe to sync change notifications via SSE.
   *
   * Clients keep this connection open and trigger immediate pulls when
   * receiving `change` events, reducing pull latency and unnecessary polling.
   */
  .get(
    '/stream',
    async (ctx) => {
      const workerEnv = env as unknown as Env
      const tenantCtx = hasTenantContext(ctx) ? ctx.tenant : undefined
      const { db } = resolveTenantBindings(tenantCtx, workerEnv)
      let syncChannel = tenantCtx?.tenant.id ?? 'global'

      if (!tenantCtx) {
        const tenantSlug = getRequestUrl(ctx.request).searchParams.get('tenantSlug') ?? undefined
        const scope = await resolveGlobalSyncSelector({
          tenantSlug,
          user: ctx.user as SyncUserLike,
          session: (ctx as { session?: unknown }).session,
          db,
          workerEnv,
        })
        if (!scope.ok) {
          ctx.set.status = scope.status
          return {
            success: false as const,
            error: { code: scope.code, message: scope.message },
          }
        }
        syncChannel = scope.syncChannel
      }
      const encoder = new TextEncoder()
      let closeStream = () => {}

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          let closed = false
          const pendingEvents: SyncEvent[] = []

          const sendEvent = (eventName: string, payload: Record<string, unknown>) => {
            if (closed) return
            controller.enqueue(
              encoder.encode(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`)
            )
          }

          const flushPendingEvents = () => {
            while (!closed && pendingEvents.length > 0) {
              const event = pendingEvents.shift()
              if (!event) break
              sendEvent(event.type, event)
            }
          }

          const flush = setInterval(() => {
            flushPendingEvents()
          }, SSE_EVENT_FLUSH_MS)

          const heartbeat = setInterval(() => {
            if (closed) return
            flushPendingEvents()
            controller.enqueue(encoder.encode(': keep-alive\n\n'))
          }, SSE_HEARTBEAT_MS)

          const unsubscribe = subscribeSyncEvents((event) => {
            if (closed) return
            pendingEvents.push(event)
          }, syncChannel)
          const abortHandler = () => {
            cleanup()
          }

          const cleanup = () => {
            if (closed) return
            closed = true
            clearInterval(flush)
            clearInterval(heartbeat)
            unsubscribe()
            ctx.request.signal.removeEventListener('abort', abortHandler)
            try {
              controller.close()
            } catch {
              // Ignore close errors when stream is already closed/cancelled.
            }
          }

          closeStream = cleanup
          ctx.request.signal.addEventListener('abort', abortHandler)

          sendEvent('connected', {
            type: 'connected',
            timestamp: new Date().toISOString(),
          })
        },
        cancel() {
          closeStream()
        },
      })

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
        },
      })
    },
    {
      auth: true,
    }
  )

  /**
   * POST /push — Push offline commands.
   *
   * Clients use this endpoint to push commands that were queued offline.
   * The server executes each command and returns per-command results,
   * including conflict detection based on optimistic version numbers.
   *
   * Request body:
   * - commands: Array of command envelopes
   *
   * Response:
   * - results: Array of per-command results with status:
   *   - 'success': Command executed successfully
   *   - 'conflict': Optimistic version mismatch (client is out of date)
   *   - 'failed': Command execution failed
   */
  .post(
    '/push',
    async (elysiaCtx) => {
      const { body, user, set } = elysiaCtx
      const workerEnv = env as unknown as Env
      const tenantCtx = hasTenantContext(elysiaCtx) ? elysiaCtx.tenant : undefined
      const { db, kv } = resolveTenantBindings(tenantCtx, workerEnv)
      const syncChannel = tenantCtx?.tenant.id ?? 'global'
      const { commands } = body

      if (!commands || commands.length === 0) {
        set.status = 400
        return {
          success: false as const,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Request body must contain a non-empty "commands" array',
          },
        }
      }

      if (commands.length > MAX_PUSH_COMMANDS) {
        set.status = 400
        return {
          success: false as const,
          error: {
            code: 'VALIDATION_ERROR',
            message: `Too many commands in one sync push. Max allowed: ${MAX_PUSH_COMMANDS}`,
          },
        }
      }

      const results = await executeSyncPushCommands({
        commands,
        userId: user.id,
        db,
        kv,
        syncChannel,
        executeCommandFn: executeCommand,
      })

      incrementMetric('sync_push_total', {
        status: results.every((r) => r.status === 'success') ? 'success' : 'mixed',
      })
      return {
        success: true as const,
        data: { results },
      }
    },
    {
      auth: true,
      body: t.Object({
        commands: t.Array(
          t.Object({
            type: t.String(),
            payload: t.Record(t.String(), t.Unknown()),
            actor: t.Optional(
              t.Object({
                userId: t.String(),
                source: t.String(),
              })
            ),
            timestamp: t.Optional(t.String()),
            optimisticVersion: t.Optional(t.Number()),
            dryRun: t.Optional(t.Boolean()),
            transactionId: t.Optional(t.String()),
          })
        ),
      }),
    }
  )
