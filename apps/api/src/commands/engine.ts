import { extractCacheTagsFromCommand, invalidateByTags } from '@/cache/invalidation.service'
import { cdnPurgeService } from '@/cache/cdn-purge.service'
import { logger } from '@/observability/logger'
import type { Database } from '@/database/db'
import type { Env } from '@/env'
import type { EntryRow } from '@/entries/entries.repository'
import { incrementMetric } from '@/observability/metrics'
import type { PluginHookContext } from '@/plugins/plugin-hooks'
import { pluginRegistry } from '@/plugins/plugin-registry'
import type { CommandEnvelope, CommandResult } from '@edgecms/schemas/commands'
import { publishSyncEvent } from '@/sync/sync-events'
import { type EventType, eventBus } from '@/webhooks/event-bus'
import {
  outboxInsertValues,
  outboxRepository,
  type OutboxEntry,
} from '@/webhooks/outbox.repository'
import { relayOutbox } from '@/webhooks/outbox-relay'
import { recordCommandAuditEvent } from '@/audit/audit-recorders'
import { scheduleDeferredWork } from './deferred-work'
import { buildMessagesForEvent, type WebhookQueueMessage } from '@/webhooks/queue-producer'
import { commandsRepository } from './commands.repository'
import { computeDiff } from './diff.service'
import { createPreviewReceipt, markPreviewReceiptConsumed, verifyPreviewReceipt } from '@/ai/preview-receipt.service'
import {
  handleBulkUpdate,
  handleCreateEntry,
  handleDeleteEntry,
  handleUpdateEntry,
  handleUpdateSingleton,
} from './handlers/entry-handlers'
import { handlePublishNow, handleUnpublishNow } from './handlers/publishing-handlers'
import { handleLinkRelation, handleUnlinkRelation } from './handlers/relation-handlers'
import {
  handleCancelSchedule,
  handleSchedulePublish,
  handleScheduleUnpublish,
} from './handlers/scheduling-handlers'

// ============================================================================
// Types
// ============================================================================

/**
 * Context passed to every command handler.
 *
 * Provides the database connection, actor identity, and optional KV namespace
 * for cache invalidation. KV is optional to support testing without KV bindings.
 */
export type CommandContext = {
  db: Database
  actor: { userId: string; source: string }
  tenantScope?: string
  kv?: KVNamespace
  env?: Env
  /**
   * Cloudflare execution context for deferred background work.
   * Threaded from the request handler when `waitUntil` is available
   * (mirrors the assets controller `getDeferredWorkScheduler` pattern).
   * Absent in tests, DO alarm invocations, and non-worker runtimes —
   * use `scheduleDeferredWork` from `./deferred-work`, which falls back
   * to detached `void` execution with caught rejections.
   */
  executionCtx?: Pick<ExecutionContext, 'waitUntil'>
  syncChannel?: string
  idempotencyKey?: string
  requestMeta?: {
    requestId?: string
    pathname?: string
    method?: string
  }
  invalidatedCacheTags?: string[]
  /**
   * QRY-05: handlers attach the already-loaded entry row here so later
   * stages (cache-tag extraction, webhooks, follow-up commands reusing the
   * same context) can reuse it instead of re-fetching the same row.
   */
  cachedEntry?: EntryRow | null
}

/**
 * A single audit entry describing one entity-level change.
 */
export type AuditEntry = {
  entityType: string
  entityId: string
  action: string
  changes?: Record<string, unknown>
}

/**
 * The return shape of every command handler.
 */
export type CommandHandlerResult = {
  success: boolean
  data?: Record<string, unknown>
  before?: Record<string, unknown> | null
  error?: { code: string; message: string }
  auditEntries?: AuditEntry[]
}

/**
 * A command handler function signature.
 *
 * Handlers receive the execution context, the command-specific payload,
 * and an optional optimistic version for concurrency control.
 */
export type CommandHandler = (
  ctx: CommandContext,
  payload: Record<string, unknown>,
  optimisticVersion?: number
) => Promise<CommandHandlerResult>

// ============================================================================
// Handler Registry
// ============================================================================

/**
 * Map of command type discriminants to their handler functions.
 *
 * The 'transaction' type is handled separately by the engine itself,
 * so it does not appear in this registry.
 */
const handlers: Record<string, CommandHandler> = {
  createEntry: handleCreateEntry,
  updateEntry: handleUpdateEntry,
  deleteEntry: handleDeleteEntry,
  bulkUpdate: handleBulkUpdate,
  updateSingleton: handleUpdateSingleton,
  linkRelation: handleLinkRelation,
  unlinkRelation: handleUnlinkRelation,
  publishNow: handlePublishNow,
  unpublishNow: handleUnpublishNow,
  schedulePublish: handleSchedulePublish,
  scheduleUnpublish: handleScheduleUnpublish,
  cancelSchedule: handleCancelSchedule,
}

const DEFAULT_PLUGIN_PATHNAME = '/internal/commands'
const DEFAULT_PLUGIN_METHOD = 'INTERNAL'

function buildPluginHookContext(
  ctx: CommandContext,
  envelope: CommandEnvelope,
  result?: CommandResult
): PluginHookContext {
  return {
    requestId: ctx.requestMeta?.requestId ?? crypto.randomUUID(),
    pathname: ctx.requestMeta?.pathname ?? DEFAULT_PLUGIN_PATHNAME,
    method: ctx.requestMeta?.method ?? DEFAULT_PLUGIN_METHOD,
    tenantScope: ctx.tenantScope,
    commandType: envelope.type,
    commandStatus: result?.status,
    commandId: result?.commandId,
    actorSource: envelope.actor.source,
  }
}

async function runPluginHookSafely(
  hook: Parameters<typeof pluginRegistry.execute>[0],
  context: PluginHookContext
) {
  try {
    await pluginRegistry.execute(hook, context)
  } catch (err) {
    logger.error('plugin_hook_failed', { hook, error: err instanceof Error ? err.message : String(err) })
  }
}

/**
 * Map command types to webhook event types.
 *
 * Returns the corresponding webhook event type for a given command type.
 * Commands that don't trigger events (e.g., transaction) return null.
 */
function mapCommandToEvent(commandType: string): EventType | null {
  const mapping: Record<string, EventType | null> = {
    createEntry: 'entry.created',
    updateEntry: 'entry.updated',
    deleteEntry: 'entry.deleted',
    publishNow: 'entry.published',
    unpublishNow: 'entry.unpublished',
    bulkUpdate: 'entry.bulk_updated',
    linkRelation: 'relation.linked',
    unlinkRelation: 'relation.unlinked',
    schedulePublish: 'entry.scheduled',
    scheduleUnpublish: 'entry.scheduled',
    cancelSchedule: null,
    transaction: null,
    updateSingleton: 'entry.updated', // Singletons are entries
  }

  return mapping[commandType] ?? null
}

// ============================================================================
// Engine Core
// ============================================================================

/**
 * Record a processed command and its audit entries in D1.
 *
 * Uses db.batch() when available so the processed row + audit rows + webhook
 * outbox rows land together (H1: the outbox row is the durable webhook
 * intent); falls back to sequential inserts on mock drivers.
 */
async function recordCommand(
  db: Database,
  commandId: string,
  envelope: CommandEnvelope,
  status: 'success' | 'failed' | 'dry_run',
  tenantScope: string | null,
  result?: Record<string, unknown> | null,
  auditEntries?: AuditEntry[],
  outboxEntries?: OutboxEntry[]
): Promise<void> {
  const now = new Date().toISOString()
  const hasBatch = typeof (db as unknown as { batch?: unknown }).batch === 'function'
  const pendingOutbox = outboxEntries ?? []

  if (hasBatch && ((auditEntries ?? []).length > 0 || pendingOutbox.length > 0)) {
    try {
      const { auditLog, processedCommands, webhookOutbox } = await import('@/database/schema')
      const processedBuilder = db.insert(processedCommands).values({
        id: commandId,
        commandType: envelope.type,
        payload: envelope.payload,
        actor: envelope.actor,
        result: result ?? null,
        status,
        tenantScope,
        executedAt: now,
      })
      const builders: unknown[] = [processedBuilder]
      if ((auditEntries ?? []).length > 0) {
        builders.push(
          db.insert(auditLog).values(
            (auditEntries ?? []).map((entry) => ({
              id: crypto.randomUUID(),
              commandId,
              entityType: entry.entityType,
              entityId: entry.entityId,
              action: entry.action,
              changes: entry.changes ?? null,
              timestamp: now,
            }))
          )
        )
      }
      for (const entry of pendingOutbox) {
        builders.push(db.insert(webhookOutbox).values(outboxInsertValues(entry, now)))
      }
      await (db as unknown as { batch: (q: unknown[]) => Promise<unknown> }).batch(builders)
      return
    } catch {
      // Fall through to repository path below.
    }
  }

  await commandsRepository.insertProcessedCommand({
    db,
    commandId,
    envelope,
    status,
    tenantScope,
    result,
    executedAt: now,
  })

  await commandsRepository.insertAuditEntries({
    db,
    commandId,
    entries: auditEntries ?? [],
    timestamp: now,
  })

  for (const entry of pendingOutbox) {
    try {
      await outboxRepository.enqueue(db, entry)
    } catch (err) {
      // Outbox is best-effort durability: never flip a committed mutation
      // to failed because the intent-log write failed.
      logger.warn('webhook_outbox_enqueue_failed', {
        eventId: entry.eventId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

/**
 * Record change log entries for successful command execution.
 *
 * Called after successful command execution (non-dry-run) to populate the
 * change_log table for cursor-based sync. Each audit entry from the command
 * handler is converted into a change log entry that clients can pull.
 */
async function recordChangeLog(
  db: Database,
  commandId: string,
  auditEntries: AuditEntry[],
  tenantScope: string | null
): Promise<void> {
  if (auditEntries.length === 0) return

  const now = new Date().toISOString()

  await commandsRepository.insertChangeLogEntries({
    db,
    commandId,
    entries: auditEntries,
    tenantScope,
    timestamp: now,
  })
}

/**
 * Check if a command has already been processed with the same idempotency key.
 * If yes, return the cached result directly. If conflicts are detected, return IDEMPOTENCY_CONFLICT.
 */
async function checkIdempotency(
  db: Database,
  commandId: string,
  envelope: CommandEnvelope,
  defaultFailureCode: string
): Promise<CommandResult | null> {
  try {
    const existing = await commandsRepository.findById(db, commandId)
    if (!existing) return null

    const keyName = envelope.idempotencyKey ?? commandId.replace(/^idem_/, '')

    if (existing.commandType !== envelope.type) {
      return {
        commandId,
        type: envelope.type,
        status: 'failed',
        error: {
          code: 'IDEMPOTENCY_CONFLICT',
          message: `Idempotency key '${keyName}' was already used for command type '${existing.commandType}'`,
        },
        executedAt: existing.executedAt,
      }
    }

    if (JSON.stringify(existing.payload ?? {}) !== JSON.stringify(envelope.payload ?? {})) {
      return {
        commandId,
        type: envelope.type,
        status: 'failed',
        error: {
          code: 'IDEMPOTENCY_CONFLICT',
          message: `Idempotency key '${keyName}' was already used with a different payload`,
        },
        executedAt: existing.executedAt,
      }
    }

    if (existing.status === 'pending') {
      return {
        commandId,
        type: envelope.type,
        status: 'failed',
        error: {
          code: 'CONCURRENT_REQUEST',
          message: `Command with idempotency key '${keyName}' is currently processing`,
        },
        executedAt: existing.executedAt,
      }
    }

    if (existing.status === 'success') {
      return {
        commandId,
        type: envelope.type,
        status: 'success',
        data: (existing.result as Record<string, unknown> | null) ?? undefined,
        executedAt: existing.executedAt,
      }
    }

    if (existing.status === 'dry_run') {
      const storedResult = existing.result as Record<string, unknown> | null
      return {
        commandId,
        type: envelope.type,
        status: 'dry_run',
        diff: (storedResult?.diff as Record<string, unknown>[] | undefined) ?? [],
        previewReceipt: storedResult?.previewReceipt as string | undefined,
        executedAt: existing.executedAt,
      }
    }

    if (existing.status === 'failed') {
      const storedError = (existing.result as Record<string, unknown> | null)?.error as
        | { code: string; message: string }
        | undefined
      return {
        commandId,
        type: envelope.type,
        status: 'failed',
        error: storedError ?? {
          code: defaultFailureCode,
          message: 'Prior command execution failed',
        },
        executedAt: existing.executedAt,
      }
    }
  } catch {
    // In case db findById is not supported or fails, proceed to normal execution
  }
  return null
}

async function verifyReceiptSafely(
  envelope: CommandEnvelope,
  commandsToVerify: CommandEnvelope[],
  ctx: CommandContext,
  tenantScope: string | null
): Promise<{ valid: true } | { valid: false; message?: string }> {
  if (!envelope.previewReceipt || envelope.dryRun) return { valid: true }
  const verification = await verifyPreviewReceipt({
    receiptId: envelope.previewReceipt,
    userId: envelope.actor.userId,
    tenantId: tenantScope ?? undefined,
    kv: ctx.kv,
    commandsToVerify,
  })
  return verification.valid ? { valid: true } : { valid: false, message: verification.message }
}

async function consumeReceiptSafely(
  receiptId: string | undefined,
  kv: KVNamespace | undefined,
  tenantScope: string | null
): Promise<void> {
  if (!receiptId) return
  try {
    await markPreviewReceiptConsumed(receiptId, kv, tenantScope ?? undefined)
  } catch (receiptErr) {
    logger.warn('preview_receipt_consumption_failed', {
      receiptId,
      error: receiptErr instanceof Error ? receiptErr.message : String(receiptErr),
    })
  }
}

/**
 * Derive the webhook event for a successful command.
 *
 * Single source of truth shared by the transactional outbox write
 * (executeSingleCommand success path) and the live eventBus.emit
 * (handlePostExecution), so both carry identical type + metadata.
 * Returns null for commands that trigger no event.
 */
function deriveWebhookEvent(
  envelope: CommandEnvelope,
  commandId: string,
  handlerResult: CommandHandlerResult,
  syncChannel: string | undefined,
  cacheTags: string[],
  outboxEventId?: string
): {
  eventType: EventType
  metadata: Record<string, unknown>
  before: unknown
  after: unknown
} | null {
  const eventType = mapCommandToEvent(envelope.type)
  if (!eventType) return null

  const normalizedSyncChannel = syncChannel?.trim() || 'global'
  const entryData = (handlerResult.data ?? handlerResult.before ?? {}) as Record<string, unknown>
  const entrySlug = typeof entryData.slug === 'string' ? entryData.slug : undefined
  const entryId =
    typeof entryData.id === 'string'
      ? entryData.id
      : typeof envelope.payload.entryId === 'string'
        ? envelope.payload.entryId
        : undefined
  const collectionSlug =
    typeof entryData.collectionSlug === 'string' ? entryData.collectionSlug : undefined

  const revalidatePaths: string[] = []
  if (collectionSlug && entrySlug) {
    revalidatePaths.push(`/${collectionSlug}/${entrySlug}`)
    revalidatePaths.push(`/${collectionSlug}`)
  } else if (entrySlug) {
    revalidatePaths.push(`/${entrySlug}`)
  }

  const payloadRevalidate = envelope.payload.revalidate as
    | boolean
    | { paths?: string[]; tags?: string[] }
    | undefined

  let revalidateInfo:
    | {
        paths: string[]
        tags: string[]
        entryId?: string
        collectionSlug?: string
      }
    | undefined

  if (payloadRevalidate || revalidatePaths.length > 0) {
    const customPaths =
      typeof payloadRevalidate === 'object' && Array.isArray(payloadRevalidate.paths)
        ? payloadRevalidate.paths
        : revalidatePaths
    const customTags =
      typeof payloadRevalidate === 'object' && Array.isArray(payloadRevalidate.tags)
        ? payloadRevalidate.tags
        : cacheTags

    revalidateInfo = {
      paths: customPaths,
      tags: customTags,
      ...(entryId ? { entryId } : {}),
      ...(collectionSlug ? { collectionSlug } : {}),
    }
  }

  return {
    eventType,
    metadata: {
      commandId,
      actor: envelope.actor,
      syncChannel: normalizedSyncChannel,
      ...(outboxEventId ? { outboxEventId } : {}),
      ...(revalidateInfo ? { revalidate: revalidateInfo } : {}),
    },
    before: handlerResult.before ?? null,
    after: handlerResult.data,
  }
}

async function handlePostExecution(
  ctx: CommandContext,
  envelope: CommandEnvelope,
  commandId: string,
  handlerResult: CommandHandlerResult,
  tenantScope: string | null,
  opts?: { cacheTags?: string[]; outboxEventId?: string }
): Promise<void> {
  // 1. Consume preview receipt upon mutation success
  await consumeReceiptSafely(envelope.previewReceipt, ctx.kv, tenantScope)

  // 2. Record change log entries for sync
  if (handlerResult.auditEntries && handlerResult.auditEntries.length > 0) {
    try {
      await recordChangeLog(ctx.db, commandId, handlerResult.auditEntries, tenantScope)
      publishSyncEvent(
        {
          type: 'change',
          timestamp: new Date().toISOString(),
        },
        ctx.syncChannel
      )
    } catch (err) {
      logger.error('changelog_recording_failed', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // 3. Invalidate affected cache snapshots and edge caches
  let cacheTags: string[] = []
  if (opts?.cacheTags) {
    cacheTags = opts.cacheTags
  } else {
    try {
      cacheTags = await extractCacheTagsFromCommand(
        ctx.db,
        envelope.type,
        envelope.payload,
        tenantScope ?? undefined
      )
    } catch (err) {
      logger.error('cache_tag_extraction_failed', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  if (cacheTags.length > 0) {
    ctx.invalidatedCacheTags = cacheTags
    if (ctx.kv) {
      try {
        const { invalidatedKeys } = await invalidateByTags(ctx.db, ctx.kv, cacheTags)
        if (invalidatedKeys.length > 0) {
          logger.info('cache_invalidation_completed', {
            invalidatedKeys: invalidatedKeys.length,
            tags: cacheTags.join(', '),
          })
        }
      } catch (err) {
        logger.error('cache_invalidation_failed', {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
    // Deferred side effect: detached from the response via `waitUntil` when
    // available, otherwise fire-and-forget with caught rejections. Never
    // blocks or fails the committed mutation.
    scheduleDeferredWork(
      ctx,
      cdnPurgeService.purgeCloudflareCacheTags(ctx.env, cacheTags),
      'cdn_cache_purge'
    )
  }

  // 4. Emit webhook event (non-blocking) with revalidation metadata
  try {
    const derived = deriveWebhookEvent(
      envelope,
      commandId,
      handlerResult,
      ctx.syncChannel,
      cacheTags,
      opts?.outboxEventId
    )
    if (derived) {
      const revalidateInfo = (derived.metadata.revalidate as
        | {
            paths: string[]
            tags: string[]
            entryId?: string
            collectionSlug?: string
          }
        | undefined)

      await eventBus.emit(derived.eventType, {
        before: derived.before,
        after: derived.after,
        metadata: derived.metadata,
      })

      if (ctx.env?.FRONTEND_REVALIDATE_URL && revalidateInfo) {
        scheduleDeferredWork(
          ctx,
          cdnPurgeService.dispatchFrontendRevalidation(
            ctx.env.FRONTEND_REVALIDATE_URL,
            {
              event: derived.eventType,
              tags: revalidateInfo.tags,
              paths: revalidateInfo.paths,
              entryId: revalidateInfo.entryId,
              collectionSlug: revalidateInfo.collectionSlug,
            },
            ctx.env.FRONTEND_REVALIDATE_SECRET
          ),
          'frontend_revalidation'
        )
      }
    }
  } catch (err) {
    logger.error('webhook_event_emission_failed', {
      error: err instanceof Error ? err.message : String(err),
    })
  }

  // 5. Best-effort opportunistic outbox sweep: replay crash-orphaned rows
  // (created >60s ago, still pending). Fresh rows are excluded so this never
  // double-sends what the producer listener is about to deliver.
  // Deferred via `waitUntil` when available so the sweep never adds tail
  // latency to the mutation response; detached otherwise.
  scheduleDeferredWork(
    ctx,
    (async () => {
      try {
        const queue = ctx.env?.WEBHOOK_QUEUE as Queue<WebhookQueueMessage> | undefined
        if (queue) {
          await relayOutbox(ctx.db, queue, (event) => buildMessagesForEvent(ctx.db, event), {
            limit: 20,
            staleOnlyMs: 60_000,
          })
        }
      } catch {
        // Best-effort; orphans stay pending for the next sweep.
      }
    })(),
    'outbox_relay_sweep'
  )
}

/**
 * Execute a single (non-transaction) command.
 *
 * 1. Checks for dry-run mode and computes diff if enabled
 * 2. Otherwise looks up the handler by command type
 * 3. Invokes the handler with context and payload
 * 4. Records the command and audit entries in D1
 * 5. Returns a structured CommandResult
 */
async function executeSingleCommand(
  ctx: CommandContext,
  envelope: CommandEnvelope
): Promise<CommandResult> {
  const idempotencyKey = envelope.idempotencyKey || ctx.idempotencyKey
  const commandId = idempotencyKey ? `idem_${idempotencyKey}` : crypto.randomUUID()
  const tenantScope = ctx.syncChannel && ctx.syncChannel !== 'global' ? ctx.syncChannel : null
  const pluginHookContext = buildPluginHookContext(ctx, envelope)
  await runPluginHookSafely('beforeCommand', pluginHookContext)

  const finalize = async (result: CommandResult): Promise<CommandResult> => {
    await runPluginHookSafely('afterCommand', {
      ...pluginHookContext,
      commandStatus: result.status,
      commandId: result.commandId,
    })
    return result
  }

  // Idempotency check: if an idempotency key was supplied and this command was already processed,
  // return the cached outcome directly without re-executing mutations.
  // ATM-02: pre-reserve the idempotency slot with 'pending' status BEFORE
  // running handlers, so concurrent identical requests see the reservation
  // (CONCURRENT_REQUEST) instead of both passing the check and duplicating
  // mutations. D1 enforces this via the primary-key constraint on
  // processed_commands.id; collisions fall back to re-reading the winner.
  if (idempotencyKey) {
    const cached = await checkIdempotency(ctx.db, commandId, envelope, 'COMMAND_FAILED')
    if (cached) return finalize(cached)

    // Pre-reserve idempotency slot with 'pending' status
    try {
      await commandsRepository.insertProcessedCommand({
        db: ctx.db,
        commandId,
        envelope,
        status: 'pending',
        tenantScope,
        result: null,
        executedAt: new Date().toISOString(),
      })
    } catch {
      const concurrent = await checkIdempotency(ctx.db, commandId, envelope, 'COMMAND_FAILED')
      if (concurrent) return finalize(concurrent)
    }
  }

  const handler = handlers[envelope.type]

  if (!handler) {
    const errorResult: CommandResult = {
      commandId,
      type: envelope.type,
      status: 'failed',
      error: {
        code: 'UNKNOWN_COMMAND',
        message: `No handler registered for command type '${envelope.type}'`,
      },
      executedAt: new Date().toISOString(),
    }

    await recordCommand(ctx.db, commandId, envelope, 'failed', tenantScope, {
      error: errorResult.error,
    })
    incrementMetric('command_runs_total', { type: envelope.type, status: 'failed' })

    return finalize(errorResult)
  }

  // Verify preview receipt if supplied for execution
  const receiptCheck = await verifyReceiptSafely(envelope, [envelope], ctx, tenantScope)
  if (!receiptCheck.valid) {
    const errorResult: CommandResult = {
      commandId,
      type: envelope.type,
      status: 'failed',
      error: {
        code: 'INVALID_PREVIEW_RECEIPT',
        message: receiptCheck.message ?? 'Preview receipt verification failed',
      },
      executedAt: new Date().toISOString(),
    }
    await recordCommand(ctx.db, commandId, envelope, 'failed', tenantScope, {
      error: errorResult.error,
    })
    incrementMetric('command_runs_total', { type: envelope.type, status: 'failed' })
    return finalize(errorResult)
  }

  // Dry-run pathway: compute diff without executing mutations
  if (envelope.dryRun) {
    try {
      const diff = await computeDiff(ctx, envelope.type, envelope.payload)

      // Generate immutable preview receipt for dry-run commands
      let previewReceiptId: string | undefined
      try {
        const receipt = await createPreviewReceipt({
          commands: [envelope],
          userId: envelope.actor.userId,
          tenantId: tenantScope ?? undefined,
          kv: ctx.kv,
        })
        previewReceiptId = receipt.receiptId
      } catch {
        // Non-blocking for diff calculation
      }

      // Record the dry-run command
      await recordCommand(ctx.db, commandId, envelope, 'dry_run', tenantScope, {
        diff: diff as unknown as Record<string, unknown>,
        previewReceipt: previewReceiptId,
      })
      incrementMetric('command_runs_total', { type: envelope.type, status: 'dry_run' })

      return finalize({
        commandId,
        type: envelope.type,
        status: 'dry_run',
        diff: diff as unknown as Record<string, unknown>[],
        previewReceipt: previewReceiptId,
        executedAt: new Date().toISOString(),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      incrementMetric('command_runs_total', { type: envelope.type, status: 'failed' })
      return finalize({
        commandId,
        type: envelope.type,
        status: 'failed',
        error: { code: 'DRY_RUN_ERROR', message },
        executedAt: new Date().toISOString(),
      })
    }
  }

  // Normal execution pathway
  try {
    const handlerResult = await handler(ctx, envelope.payload, envelope.optimisticVersion)

    if (handlerResult.success) {
      // ATM-03: persist the mutation outcome (success + audit entries)
      // BEFORE triggering any post-execution side effects (receipt
      // consumption, change-log, cache invalidation, webhooks). Post hooks
      // are best-effort and internally catch their own errors, so a failing
      // side effect can never rewrite a committed mutation as 'failed'.
      //
      // H1: the webhook outbox row lands in the SAME batch as the commit,
      // so a crash between DB commit and queue.sendBatch never loses the
      // webhook — the relay replays the pending row.
      const outboxEventId = crypto.randomUUID()
      let outboxEntries: OutboxEntry[] = []
      let precomputedCacheTags: string[] | undefined
      try {
        const tags = await extractCacheTagsFromCommand(
          ctx.db,
          envelope.type,
          envelope.payload,
          tenantScope ?? undefined
        )
        precomputedCacheTags = tags
        const derived = deriveWebhookEvent(
          envelope,
          commandId,
          handlerResult,
          ctx.syncChannel,
          tags,
          outboxEventId
        )
        if (derived) {
          outboxEntries = [
            {
              eventId: outboxEventId,
              eventType: derived.eventType,
              payload: {
                event: derived.eventType,
                metadata: derived.metadata,
                after: derived.after ?? null,
                before: derived.before ?? null,
              },
              tenantScope: tenantScope ?? 'global',
              commandId,
            },
          ]
        }
      } catch (err) {
        logger.error('webhook_outbox_build_failed', {
          error: err instanceof Error ? err.message : String(err),
        })
      }

      await recordCommand(
        ctx.db,
        commandId,
        envelope,
        'success',
        tenantScope,
        handlerResult.data,
        handlerResult.auditEntries,
        outboxEntries
      )

      await handlePostExecution(ctx, envelope, commandId, handlerResult, tenantScope, {
        cacheTags: precomputedCacheTags,
        outboxEventId: outboxEntries.length > 0 ? outboxEventId : undefined,
      })

      incrementMetric('command_runs_total', { type: envelope.type, status: 'success' })
      return finalize({
        commandId,
        type: envelope.type,
        status: 'success',
        data: handlerResult.data,
        executedAt: new Date().toISOString(),
      })
    }

    // Handler returned failure
    await recordCommand(ctx.db, commandId, envelope, 'failed', tenantScope, {
      error: handlerResult.error,
    })
    incrementMetric('command_runs_total', { type: envelope.type, status: 'failed' })

    return finalize({
      commandId,
      type: envelope.type,
      status: 'failed',
      error: handlerResult.error,
      executedAt: new Date().toISOString(),
    })
  } catch (err) {
    if (idempotencyKey) {
      const cached = await checkIdempotency(ctx.db, commandId, envelope, 'COMMAND_FAILED')
      if (cached) return finalize(cached)
    }

    const message = err instanceof Error ? err.message : 'Unknown error'
    const errorResult: CommandResult = {
      commandId,
      type: envelope.type,
      status: 'failed',
      error: { code: 'INTERNAL_ERROR', message },
      executedAt: new Date().toISOString(),
    }

    try {
      await recordCommand(ctx.db, commandId, envelope, 'failed', tenantScope, {
        error: errorResult.error,
      })
    } catch {
      // If recording fails (e.g. DB issue), still return the error to the caller
    }
    incrementMetric('command_runs_total', { type: envelope.type, status: 'failed' })

    return finalize(errorResult)
  }
}

/**
 * Handle a transaction command — executes sub-commands sequentially as a saga.
 *
 * NON-ATOMIC SAGA (D1 limitation): Cloudflare D1 has no interactive
 * multi-statement transactions with rollback. Sub-commands execute
 * sequentially; on first failure the remaining commands are skipped and
 * already-completed sub-commands are NOT rolled back. Compensating actions
 * (if any) are the responsibility of the caller — e.g. issue inverse
 * commands (delete created entries, unlink created relations) using the
 * returned subResults. Prefer repository-level db.batch() for true atomicity
 * of a fixed set of writes.
 */
async function handleTransaction(
  ctx: CommandContext,
  envelope: CommandEnvelope
): Promise<CommandResult> {
  const idempotencyKey = envelope.idempotencyKey || ctx.idempotencyKey
  const transactionId = idempotencyKey ? `idem_${idempotencyKey}` : crypto.randomUUID()
  const tenantScope = ctx.syncChannel && ctx.syncChannel !== 'global' ? ctx.syncChannel : null
  const pluginHookContext = buildPluginHookContext(ctx, envelope)
  await runPluginHookSafely('beforeCommand', pluginHookContext)

  const finalize = async (result: CommandResult): Promise<CommandResult> => {
    await runPluginHookSafely('afterCommand', {
      ...pluginHookContext,
      commandStatus: result.status,
      commandId: result.commandId,
    })
    return result
  }

  // Idempotency pre-reserve for transactions (mirrors executeSingleCommand:562):
  // reserve the transactionId as 'pending' before running sub-commands so
  // concurrent identical transactions see CONCURRENT_REQUEST instead of
  // double-executing. PK constraint arbitrates the race.
  if (idempotencyKey) {
    const cached = await checkIdempotency(ctx.db, transactionId, envelope, 'TRANSACTION_FAILED')
    if (cached) return finalize(cached)
    try {
      await commandsRepository.insertProcessedCommand({
        db: ctx.db,
        commandId: transactionId,
        envelope,
        status: 'pending',
        tenantScope,
        result: null,
        executedAt: new Date().toISOString(),
      })
    } catch {
      const concurrent = await checkIdempotency(ctx.db, transactionId, envelope, 'TRANSACTION_FAILED')
      if (concurrent) return finalize(concurrent)
    }
  }

  const payload = envelope.payload as { commands?: CommandEnvelope[] }

  if (!payload.commands || !Array.isArray(payload.commands) || payload.commands.length === 0) {
    return finalize({
      commandId: transactionId,
      type: 'transaction',
      status: 'failed',
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Transaction payload must contain a non-empty "commands" array',
      },
      executedAt: new Date().toISOString(),
    })
  }

  for (const [index, subEnvelope] of payload.commands.entries()) {
    if (subEnvelope.type === 'transaction') {
      return finalize({
        commandId: transactionId,
        type: 'transaction',
        status: 'failed',
        error: {
          code: 'VALIDATION_ERROR',
          message: `Nested transaction at index ${index} is not supported`,
        },
        executedAt: new Date().toISOString(),
      })
    }
    if (!handlers[subEnvelope.type]) {
      return finalize({
        commandId: transactionId,
        type: 'transaction',
        status: 'failed',
        error: {
          code: 'VALIDATION_ERROR',
          message: `Unknown command type '${subEnvelope.type}' at index ${index}`,
        },
        executedAt: new Date().toISOString(),
      })
    }
  }

  // Verify preview receipt if supplied for transaction
  const receiptCheck = await verifyReceiptSafely(envelope, payload.commands, ctx, tenantScope)
  if (!receiptCheck.valid) {
    const errorResult: CommandResult = {
      commandId: transactionId,
      type: 'transaction',
      status: 'failed',
      error: {
        code: 'INVALID_PREVIEW_RECEIPT',
        message: receiptCheck.message ?? 'Preview receipt verification failed',
      },
      executedAt: new Date().toISOString(),
    }
    await recordCommand(ctx.db, transactionId, envelope, 'failed', tenantScope, {
      error: errorResult.error,
    })
    incrementMetric('command_runs_total', { type: envelope.type, status: 'failed' })
    return finalize(errorResult)
  }

  const subResults: CommandResult[] = []
  let allSucceeded = true

  for (const subEnvelope of payload.commands) {
    // Attach the transaction ID to each sub-command and clear previewReceipt
    // so individual commands do not prematurely consume the transaction receipt
    const enrichedEnvelope: CommandEnvelope = {
      ...subEnvelope,
      transactionId,
      previewReceipt: undefined,
    }

    const result = await executeSingleCommand(ctx, enrichedEnvelope)
    subResults.push(result)

    if (result.status === 'failed') {
      allSucceeded = false
      break // Stop executing remaining commands on first failure
    }
  }

  const status = allSucceeded ? 'success' : 'failed'

  // Record the transaction itself as a processed command
  // (compensating action note: sub-command effects persist; see saga comment above)
  try {
    await recordCommand(
      ctx.db,
      transactionId,
      envelope,
      status as 'success' | 'failed',
      tenantScope,
      {
        subResults: subResults as unknown as Record<string, unknown>[],
        totalCommands: payload.commands.length,
        completedCommands: subResults.filter((r) => r.status === 'success').length,
        failedCommands: subResults.filter((r) => r.status === 'failed').length,
      }
    )
  } catch (err) {
    if (idempotencyKey) {
      const cached = await checkIdempotency(ctx.db, transactionId, envelope, 'TRANSACTION_FAILED')
      if (cached) return finalize(cached)
    }
    logger.error('transaction_saga_record_failed', {
      transactionId,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  // Consume transaction preview receipt upon overall success
  if (allSucceeded) {
    await consumeReceiptSafely(envelope.previewReceipt, ctx.kv, tenantScope)
  }

  return finalize({
    commandId: transactionId,
    type: 'transaction',
    status: status as 'success' | 'failed',
    data: {
      subResults: subResults as unknown as Record<string, unknown>[],
      totalCommands: payload.commands.length,
      completedCommands: subResults.filter((r) => r.status === 'success').length,
      failedCommands: subResults.filter((r) => r.status === 'failed').length,
    },
    error: allSucceeded
      ? undefined
      : {
          code: 'TRANSACTION_FAILED',
          message: `Transaction failed: ${subResults.filter((r) => r.status === 'failed').length} command(s) failed. Note: D1 does not support rollback — completed sub-commands were persisted.`,
        },
    executedAt: new Date().toISOString(),
  })
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Execute a command through the command engine.
 *
 * This is the main entry point for all CMS mutations. It:
 * 1. Routes transaction commands to the transaction handler
 * 2. Routes all other commands to their registered handlers
 * 3. Records execution results and audit entries in D1
 * 4. Returns a structured CommandResult
 *
 * @param ctx - Database connection and actor identity
 * @param envelope - The validated command envelope
 * @returns A CommandResult describing the outcome
 */
export async function executeCommand(
  ctx: CommandContext,
  envelope: CommandEnvelope
): Promise<CommandResult> {
  const result =
    envelope.type === 'transaction'
      ? await handleTransaction(ctx, envelope)
      : await executeSingleCommand(ctx, envelope)

  // HS-12: hash-chained audit event per executed command (never throws).
  await recordCommandAuditEvent({
    db: ctx.db,
    env: ctx.env,
    tenantScope:
      ctx.tenantScope ?? (ctx.syncChannel && ctx.syncChannel !== 'global' ? ctx.syncChannel : null),
    envelope,
    result,
  })
  return result
}
