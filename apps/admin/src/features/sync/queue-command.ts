import type { CommandEnvelope } from '@/features/commands/command-builder'
import { getCurrentTenantSlug } from '@/lib/tenant-storage'
import { db } from './local-db'
import { useSyncStore } from './sync-store'
import { logger } from '@/lib/logger'
import type { ConflictBase } from './field-merge'

/**
 * OF-04: the entry state an updateEntry command was built from, keyed by envelope object.
 * Set by callers that know it (the entry editor) so a later version conflict can be
 * merged three-way. Never sent to the server.
 */
const conflictBases = new WeakMap<object, ConflictBase>()

export function attachConflictBase(envelope: CommandEnvelope, base: ConflictBase): void {
  conflictBases.set(envelope, base)
}

async function resolveConflictBase(envelope: CommandEnvelope): Promise<ConflictBase | undefined> {
  if (envelope.type !== 'updateEntry' || typeof envelope.optimisticVersion !== 'number') {
    return undefined
  }
  const attached = conflictBases.get(envelope)
  if (attached && attached.version === envelope.optimisticVersion) return attached

  // Fallback: the local entry mirror, only when it is exactly the version the command expects.
  const entryId = (envelope.payload as Record<string, unknown> | undefined)?.entryId
  if (typeof entryId !== 'string') return undefined
  try {
    const local = await db.entries?.get(entryId)
    if (local && local.version === envelope.optimisticVersion && local.data) {
      return { version: local.version, slug: local.slug, data: local.data }
    }
  } catch (error) {
    logger.warn('Could not read local entry for conflict base:', error)
  }
  return undefined
}

/**
 * Add a command to the local Dexie command queue.
 *
 * Used when the app is offline or to ensure commands are persisted
 * before being sent to the server. The sync engine will pick up
 * pending commands and push them during the next sync cycle.
 *
 * @param envelope - The command envelope to queue
 * @returns Promise that resolves when the command is queued
 *
 * @example
 * ```typescript
 * import { queueCommand } from '@/features/sync/queue-command'
 * import { buildCreateEntryCommand } from '@/features/commands/command-builder'
 *
 * const command = buildCreateEntryCommand(
 *   'collection-id',
 *   { title: 'New Entry' },
 *   'new-entry'
 * )
 *
 * await queueCommand(command)
 * ```
 */
export async function queueCommand(envelope: CommandEnvelope): Promise<void> {
  const tenantSlug = getCurrentTenantSlug()

  try {
    const base = await resolveConflictBase(envelope)
    await db.commandQueue.add({
      envelope: envelope as unknown as Record<string, unknown>,
      tenantSlug,
      status: 'pending',
      createdAt: new Date().toISOString(),
      ...(base && { base }),
    })

    // Refresh pending count in the sync store
    const store = useSyncStore.getState()
    await store.refreshCounts()

    logger.info('Command queued:', envelope.type)
  } catch (error) {
    logger.error('Failed to queue command:', error)
    throw error
  }
}
