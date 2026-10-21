import { eq } from 'drizzle-orm'
import { createDb, type Database } from '@/database/db'
import { tenants } from '@/database/schema'
import type { Env } from '@/env'

/**
 * HS-14: where tenant content goes when AI features are enabled. Shown in the
 * admin next to the switch; keep in sync with `ai/providers` and `rag.service`.
 */
export const AI_CONTENT_PROVIDERS = [
  {
    id: 'qwen',
    name: 'Qwen',
    operator: 'Alibaba Cloud',
    route: 'Cloudflare AI Gateway',
    purpose: 'Primary model for AI commands, workflows and import analysis',
  },
  {
    id: 'gemini',
    name: 'Gemini',
    operator: 'Google',
    route: 'Cloudflare AI Gateway',
    purpose: 'Fallback model when Qwen is unavailable',
  },
  {
    id: 'workers-ai',
    name: 'Workers AI embeddings',
    operator: 'Cloudflare',
    route: 'Workers AI binding',
    purpose: 'Embeddings for semantic search (published entries, asset file names)',
  },
] as const

export const AI_DISABLED_CODE = 'AI_DISABLED'
export const AI_DISABLED_MESSAGE =
  'AI features are turned off for this tenant. A tenant owner or admin can enable them in Settings → AI.'

/**
 * Tenant flag lookup. The tenants table lives in the main D1, so callers pass
 * the Worker env when they hold a tenant-dedicated database handle.
 */
export const aiAccessRepository = {
  async findAiEnabled(db: Database, tenantId: string): Promise<boolean | null> {
    const rows = await db
      .select({ aiEnabled: tenants.aiEnabled })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1)
    return rows[0] ? Boolean(rows[0].aiEnabled) : null
  },

  async setAiEnabled(db: Database, tenantId: string, enabled: boolean, now: string) {
    await db
      .update(tenants)
      .set({ aiEnabled: enabled, updatedAt: now })
      .where(eq(tenants.id, tenantId))
  },
}

/**
 * Whether AI may process this tenant's content. Requests without a tenant
 * (single-tenant deployments on global routes) have no switch to read and
 * keep their behavior. An unknown tenant fails closed.
 */
export async function isTenantAiEnabled(input: {
  db?: Database
  workerEnv?: Partial<Pick<Env, 'DB'>>
  tenantId?: string | null
}): Promise<boolean> {
  const { tenantId } = input
  if (!tenantId || tenantId === 'global') return true
  const db = input.workerEnv?.DB ? createDb(input.workerEnv.DB) : input.db
  if (!db) return false
  try {
    return (await aiAccessRepository.findAiEnabled(db, tenantId)) === true
  } catch (error) {
    // Database not migrated to 0033 yet: keep the pre-switch behavior.
    const message = error instanceof Error ? error.message.toLowerCase() : ''
    return message.includes('no such column') && message.includes('aienabled')
  }
}
