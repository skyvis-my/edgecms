import { extractCacheTagsFromCommand, invalidateByTags } from '@/cache/invalidation.service'
import { logger } from '@/observability/logger'
import type { Database } from '@/database/db'
import type { Env } from '@/env'
import { incrementMetric } from '@/observability/metrics'
import type { PluginHookContext } from '@/plugins/plugin-hooks'
import { pluginRegistry } from '@/plugins/plugin-registry'
import type { CommandEnvelope, CommandResult } from '@edgecms/schemas/commands'
import { publishSyncEvent } from '@/sync/sync-events'
import { type EventType, eventBus } from '@/webhooks/event-bus'
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
  syncChannel?: string
  idempotencyKey?: string
  requestMeta?: {
    requestId?: string
    pathname?: string
    method?: string
  }
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
 * Inserts the command record into processed_commands and each audit entry
 * into the audit_log table.
 */
async function recordCommand(
  db: Database,
  commandId: string,
  envelope: CommandEnvelope,
  status: 'success' | 'failed' | 'dry_run',
  tenantScope: string | null,
  result?: Record<string, unknown> | null,
  auditEntries?: AuditEntry[]
): Promise<void> {
  const now = new Date().toISOString()

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
  if (idempotencyKey) {
    try {
      const existing = await commandsRepository.findById(ctx.db, commandId)
      if (existing) {
        if (existing.commandType !== envelope.type) {
          return finalize({
            commandId,
            type: envelope.type,
            status: 'failed',
            error: {
              code: 'IDEMPOTENCY_CONFLICT',
              message: `Idempotency key '${idempotencyKey}' was already used for command type '${existing.commandType}'`,
            },
            executedAt: existing.executedAt,
          })
        }

        if (JSON.stringify(existing.payload ?? {}) !== JSON.stringify(envelope.payload ?? {})) {
          return finalize({
            commandId,
            type: envelope.type,
            status: 'failed',
            error: {
              code: 'IDEMPOTENCY_CONFLICT',
              message: `Idempotency key '${idempotencyKey}' was already used with a different payload`,
            },
            executedAt: existing.executedAt,
          })
        }

        if (existing.status === 'success') {
          return finalize({
            commandId,
            type: envelope.type,
            status: 'success',
            data: (existing.result as Record<string, unknown> | null) ?? undefined,
            executedAt: existing.executedAt,
          })
        }

        if (existing.status === 'failed') {
          const storedError = (existing.result as Record<string, unknown> | null)?.error as
            | { code: string; message: string }
            | undefined
          return finalize({
            commandId,
            type: envelope.type,
            status: 'failed',
            error: storedError ?? {
              code: 'COMMAND_FAILED',
              message: 'Prior command execution failed',
            },
            executedAt: existing.executedAt,
          })
        }
      }
    } catch {
      // In case db findById is not supported or fails, proceed to normal execution
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
  if (envelope.previewReceipt && !envelope.dryRun) {
    const verification = await verifyPreviewReceipt({
      receiptId: envelope.previewReceipt,
      userId: envelope.actor.userId,
      tenantId: tenantScope ?? undefined,
      kv: ctx.kv,
      commandsToVerify: [envelope],
    })
    if (!verification.valid) {
      const errorResult: CommandResult = {
        commandId,
        type: envelope.type,
        status: 'failed',
        error: {
          code: 'INVALID_PREVIEW_RECEIPT',
          message: verification.message ?? 'Preview receipt verification failed',
        },
        executedAt: new Date().toISOString(),
      }
      await recordCommand(ctx.db, commandId, envelope, 'failed', tenantScope, {
        error: errorResult.error,
      })
      incrementMetric('command_runs_total', { type: envelope.type, status: 'failed' })
      return finalize(errorResult)
    }
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
      await recordCommand(
        ctx.db,
        commandId,
        envelope,
        'success',
        tenantScope,
        handlerResult.data,
        handlerResult.auditEntries
      )

      // Post-execution: Consume preview receipt upon mutation success
      if (envelope.previewReceipt) {
        try {
          await markPreviewReceiptConsumed(
            envelope.previewReceipt,
            ctx.kv,
            tenantScope ?? undefined
          )
        } catch (receiptErr) {
          logger.warn('preview_receipt_consumption_failed', {
            receiptId: envelope.previewReceipt,
            error: receiptErr instanceof Error ? receiptErr.message : String(receiptErr),
          })
        }
      }

      // Post-execution: Record change log entries for sync
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
          // Change log recording failures should not block command success
          logger.error('changelog_recording_failed', { error: err instanceof Error ? err.message : String(err) })
        }
      }

      // Post-execution: Invalidate affected cache snapshots (if KV is available)
      if (ctx.kv) {
        try {
          const cacheTags = await extractCacheTagsFromCommand(
            ctx.db,
            envelope.type,
            envelope.payload,
            tenantScope ?? undefined
          )
          if (cacheTags.length > 0) {
            const { invalidatedKeys } = await invalidateByTags(ctx.db, ctx.kv, cacheTags)
            if (invalidatedKeys.length > 0) {
              logger.info('cache_invalidation_completed', { invalidatedKeys: invalidatedKeys.length, tags: cacheTags.join(', ') })
            }
          }
        } catch (err) {
          // Cache invalidation failures should not block command success
          logger.error('cache_invalidation_failed', { error: err instanceof Error ? err.message : String(err) })
        }
      }

      // Post-execution: Emit webhook event (non-blocking)
      try {
        const eventType = mapCommandToEvent(envelope.type)
        if (eventType) {
          // Webhook scope contract:
          // - tenant command events must carry tenant id in metadata.syncChannel
          // - global events must carry metadata.syncChannel = 'global'
          const normalizedSyncChannel = ctx.syncChannel?.trim() || 'global'
          const eventMetadata: {
            commandId: string
            actor: typeof envelope.actor
            syncChannel: string
          } = {
            commandId,
            actor: envelope.actor,
            syncChannel: normalizedSyncChannel,
          }
          await eventBus.emit(eventType, {
            before: handlerResult.before ?? null,
            after: handlerResult.data,
            metadata: eventMetadata,
          })
        }
      } catch (err) {
        // Event emission failures should not block command success
        logger.error('webhook_event_emission_failed', { error: err instanceof Error ? err.message : String(err) })
      }

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
 * Handle a transaction command — executes multiple commands sequentially.
 *
 * **D1 limitation:** Cloudflare D1 does not support traditional SQL transactions
 * with full rollback. Commands execute sequentially and their results are recorded
 * individually. If any command fails, subsequent commands are skipped and the
 * transaction is marked as failed. Completed sub-commands are NOT rolled back.
 *
 * For use cases requiring true atomicity, consider using D1 batch operations
 * at the repository level instead.
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

  // Idempotency check for transactions
  if (idempotencyKey) {
    try {
      const existing = await commandsRepository.findById(ctx.db, transactionId)
      if (existing) {
        if (existing.commandType !== envelope.type) {
          return finalize({
            commandId: transactionId,
            type: envelope.type,
            status: 'failed',
            error: {
              code: 'IDEMPOTENCY_CONFLICT',
              message: `Idempotency key '${idempotencyKey}' was already used for command type '${existing.commandType}'`,
            },
            executedAt: existing.executedAt,
          })
        }

        if (JSON.stringify(existing.payload ?? {}) !== JSON.stringify(envelope.payload ?? {})) {
          return finalize({
            commandId: transactionId,
            type: envelope.type,
            status: 'failed',
            error: {
              code: 'IDEMPOTENCY_CONFLICT',
              message: `Idempotency key '${idempotencyKey}' was already used with a different payload`,
            },
            executedAt: existing.executedAt,
          })
        }

        if (existing.status === 'success') {
          return finalize({
            commandId: transactionId,
            type: envelope.type,
            status: 'success',
            data: (existing.result as Record<string, unknown> | null) ?? undefined,
            executedAt: existing.executedAt,
          })
        }

        if (existing.status === 'failed') {
          const storedError = (existing.result as Record<string, unknown> | null)?.error as
            | { code: string; message: string }
            | undefined
          return finalize({
            commandId: transactionId,
            type: envelope.type,
            status: 'failed',
            error: storedError ?? {
              code: 'TRANSACTION_FAILED',
              message: 'Prior transaction execution failed',
            },
            executedAt: existing.executedAt,
          })
        }
      }
    } catch {
      // In case db findById is not supported or fails, proceed to normal execution
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
  if (envelope.previewReceipt && !envelope.dryRun) {
    const verification = await verifyPreviewReceipt({
      receiptId: envelope.previewReceipt,
      userId: envelope.actor.userId,
      tenantId: tenantScope ?? undefined,
      kv: ctx.kv,
      commandsToVerify: payload.commands,
    })
    if (!verification.valid) {
      const errorResult: CommandResult = {
        commandId: transactionId,
        type: 'transaction',
        status: 'failed',
        error: {
          code: 'INVALID_PREVIEW_RECEIPT',
          message: verification.message ?? 'Preview receipt verification failed',
        },
        executedAt: new Date().toISOString(),
      }
      await recordCommand(ctx.db, transactionId, envelope, 'failed', tenantScope, {
        error: errorResult.error,
      })
      incrementMetric('command_runs_total', { type: envelope.type, status: 'failed' })
      return finalize(errorResult)
    }
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

  // Consume transaction preview receipt upon overall success
  if (allSucceeded && envelope.previewReceipt) {
    try {
      await markPreviewReceiptConsumed(
        envelope.previewReceipt,
        ctx.kv,
        tenantScope ?? undefined
      )
    } catch (receiptErr) {
      logger.warn('preview_receipt_consumption_failed', {
        receiptId: envelope.previewReceipt,
        error: receiptErr instanceof Error ? receiptErr.message : String(receiptErr),
      })
    }
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
  if (envelope.type === 'transaction') {
    return handleTransaction(ctx, envelope)
  }

  return executeSingleCommand(ctx, envelope)
}
