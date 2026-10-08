import type { CommandEnvelope } from '@/features/commands/command-builder'
import { getCurrentTenantSlug } from '@/lib/tenant-storage'
import { db } from './local-db'
import { useSyncStore } from './sync-store'
import { logger } from '@/lib/logger'

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
    await db.commandQueue.add({
      envelope: envelope as unknown as Record<string, unknown>,
      tenantSlug,
      status: 'pending',
      createdAt: new Date().toISOString(),
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
