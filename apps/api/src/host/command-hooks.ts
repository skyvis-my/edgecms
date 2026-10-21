import type { CommandEnvelope, CommandResult } from '@edgecms/schemas/commands'
import type { CommandHostHooks } from '@/commands/engine'
import type { HostRuntime } from './host-context'
import { type LimitExceeded, type LimitTenant, toLimitTenant } from './limits'
import type { UsageEventInput } from './usage'

export const LIMIT_ERROR_CODES = new Set(['QUOTA_EXCEEDED', 'RATE_LIMITED'])

type SubResult = { type?: unknown; status?: unknown }

function countCreates(envelope: CommandEnvelope): number {
  if (envelope.type === 'createEntry') return 1
  if (envelope.type !== 'transaction') return 0
  const commands = (envelope.payload as { commands?: unknown }).commands
  return Array.isArray(commands)
    ? commands.filter((c) => (c as { type?: unknown })?.type === 'createEntry').length
    : 0
}

/** Successful sub-results of a transaction, or the result itself. */
function succeeded(result: CommandResult): SubResult[] {
  if (result.type !== 'transaction') return result.status === 'success' ? [result] : []
  const subResults = (result.data as { subResults?: unknown } | undefined)?.subResults
  return Array.isArray(subResults)
    ? (subResults as SubResult[]).filter((r) => r?.status === 'success')
    : []
}

function limitRejection(envelope: CommandEnvelope, exceeded: LimitExceeded): CommandResult {
  return {
    commandId: crypto.randomUUID(),
    type: envelope.type,
    status: 'failed',
    error: { code: exceeded.code, message: exceeded.message },
    data: { limit: exceeded.details },
    executedAt: new Date().toISOString(),
  }
}

/** `{ status, details }` for a command rejected by a limit, else undefined. */
export function getCommandLimitError(
  result: Pick<CommandResult, 'error' | 'data'>
): { status: 402 | 429; details: LimitExceeded['details'] } | undefined {
  const code = result.error?.code
  if (!code || !LIMIT_ERROR_CODES.has(code)) return undefined
  const details = (result.data as { limit?: LimitExceeded['details'] } | undefined)?.limit
  if (!details) return undefined
  return { status: code === 'RATE_LIMITED' ? 429 : 402, details }
}

/**
 * Command hooks for one request (HS-05, HS-06). Global (non-tenant) routes
 * have no tenant to bill, so they are neither limited nor metered.
 */
export function createCommandHostHooks(
  runtime: HostRuntime,
  options: { source: unknown; tenant: LimitTenant | undefined; actorId?: string }
): CommandHostHooks | undefined {
  const tenant = options.tenant ? toLimitTenant(options.tenant) : undefined
  if (!tenant) return undefined
  const actor = options.actorId ? { userId: options.actorId } : undefined
  // When each envelope started. A result executed before that is an
  // idempotent replay of an earlier run and was already metered.
  const startedAt = new WeakMap<CommandEnvelope, number>()

  return {
    async beforeExecute(envelope) {
      startedAt.set(envelope, Date.now())
      const exceeded = await runtime.limits.check(options.source, {
        dimension: 'commands',
        amount: 1,
        tenant,
        actor,
      })
      if (exceeded) return limitRejection(envelope, exceeded)
      const creates = countCreates(envelope)
      if (creates > 0) {
        const entriesExceeded = await runtime.limits.check(options.source, {
          dimension: 'entries',
          amount: creates,
          tenant,
          actor,
        })
        if (entriesExceeded) return limitRejection(envelope, entriesExceeded)
      }
      return undefined
    },
    afterExecute(envelope, result) {
      const started = startedAt.get(envelope)
      if (started !== undefined && Date.parse(result.executedAt) < started) return
      const done = succeeded(result)
      if (done.length === 0) return
      const entryDelta = done.reduce(
        (sum, r) => sum + (r.type === 'createEntry' ? 1 : r.type === 'deleteEntry' ? -1 : 0),
        0
      )
      const events: UsageEventInput[] = [
        { tenantId: tenant.id, tenantSlug: tenant.slug, metric: 'admin_mutations', quantity: 1 },
      ]
      if (entryDelta !== 0) {
        events.push({
          tenantId: tenant.id,
          tenantSlug: tenant.slug,
          metric: 'entries',
          quantity: entryDelta,
        })
      }
      runtime.usage.record(options.source, events)
    },
  }
}
