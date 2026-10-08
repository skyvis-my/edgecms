import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { canQueueOfflineMutation } from '@/features/sync/offline-http-queue'
import { queueCommand } from '@/features/sync/queue-command'
import { triggerSync } from '@/features/sync/sync-scheduler'
import { ApiClientError } from '@/lib/api-error'
import { edenPost } from '@/lib/eden-client'
import type { CommandEnvelope } from './command-builder'
import { logger } from '@/lib/logger'

/**
 * Command execution response from the API
 */
export type CommandResult = {
  commandId: string
  type: string
  status: 'success' | 'failed' | 'dry_run' | 'queued'
  data?: unknown
  diff?: DiffEntry[]
  executedAt: string
}

/**
 * Diff entry structure from the backend
 */
export type DiffEntry = {
  field: string
  before: unknown
  after: unknown
  action: 'add' | 'update' | 'remove'
}

/**
 * Error response from a failed command
 */
export type CommandError = {
  code: string
  message: string
}

/**
 * Hook to execute a command via the commands endpoint
 *
 * Posts the command envelope to `/api/admin/commands` and handles:
 * - Success responses
 * - Version conflict errors (409)
 * - General errors
 */
export function useExecuteCommand() {
  return useMutation({
    mutationFn: async (envelope: CommandEnvelope): Promise<CommandResult> => {
      try {
        return await edenPost<CommandResult>('/admin/commands', envelope)
      } catch (error) {
        if (!canQueueOfflineMutation(error)) {
          throw error
        }

        await queueCommand(envelope)
        if (typeof navigator !== 'undefined' && navigator.onLine) {
          void triggerSync().catch((syncError) => {
            logger.error('Failed to trigger sync for queued command:', syncError)
          })
        }

        toast.success('Command queued for offline sync')
        return {
          commandId: envelope.transactionId ?? crypto.randomUUID(),
          type: envelope.type,
          status: 'queued',
          executedAt: new Date().toISOString(),
        }
      }
    },
    onSuccess: (result) => {
      if (result.status !== 'queued' && typeof navigator !== 'undefined' && navigator.onLine) {
        void triggerSync().catch((error) => {
          logger.error('Failed to trigger post-command sync:', error)
        })
      }
    },
    onError: (error: Error) => {
      // Check if this is a version conflict error
      if (error instanceof ApiClientError && error.status === 409) {
        toast.error('This entry was modified by someone else. Please refresh and try again.')
      } else {
        toast.error(`Command failed: ${error.message}`)
      }
    },
  })
}

/**
 * Hook to execute a dry-run command (preview changes without executing)
 *
 * Sets `dryRun: true` on the envelope and returns diff entries instead
 * of executing the command.
 */
export function useDryRunCommand() {
  return useMutation({
    mutationFn: async (envelope: CommandEnvelope): Promise<DiffEntry[]> => {
      const dryRunEnvelope: CommandEnvelope = {
        ...envelope,
        dryRun: true,
      }

      const response = await edenPost<CommandResult>('/admin/commands', dryRunEnvelope)
      return response.diff || []
    },
    onError: (error: Error) => {
      toast.error(`Preview failed: ${error.message}`)
    },
  })
}
