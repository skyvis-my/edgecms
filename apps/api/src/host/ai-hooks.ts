import type { HostRuntime } from './host-context'
import { type LimitExceeded, type LimitTenant, toLimitTenant } from './limits'

export type AiHostHooks = {
  /** HS-06: `ai_tokens` budget check before a model call. */
  checkQuota: () => Promise<LimitExceeded | null>
  /** HS-05: records `ai_tokens` for one model call, by tier. */
  onUsage: (usage: { tier: string; inputTokens: number; outputTokens: number }) => void
}

/** AI hooks for one tenant request; undefined on global routes (nothing to bill). */
export function createAiHostHooks(
  runtime: HostRuntime,
  options: { source: unknown; tenant: LimitTenant | undefined; actorId?: string }
): AiHostHooks | undefined {
  if (!options.tenant) return undefined
  const tenant = toLimitTenant(options.tenant)
  return {
    checkQuota: () =>
      runtime.limits.check(options.source, {
        dimension: 'ai_tokens',
        amount: 0,
        tenant,
        ...(options.actorId && { actor: { userId: options.actorId } }),
      }),
    onUsage: (usage) =>
      runtime.usage.record(options.source, {
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        metric: 'ai_tokens',
        quantity: Math.max(0, usage.inputTokens) + Math.max(0, usage.outputTokens),
        detail: usage.tier,
      }),
  }
}
