import { isSuperAdminUser } from '@/audit/audit-access'
import { auditService } from '@/audit/audit.service'
import type { Database } from '@/database/db'
import type { Env } from '@/env'
import type { ServiceResult } from '@/shared/utils/service-response'
import { verifyTenantMembership } from '@/tenants/tenant-context'
import { AI_CONTENT_PROVIDERS, aiAccessRepository } from './ai-access'

const MANAGER_ROLES = new Set(['owner', 'admin'])

type SettingsUser = { id: string; email?: string | null; role?: unknown }
type SettingsError = { code: 'FORBIDDEN'; message: string }

function forbidden(message: string): ServiceResult<never, SettingsError> {
  return { success: false, error: { code: 'FORBIDDEN', message } }
}

async function resolveAccess(
  db: Database,
  user: SettingsUser,
  tenantId: string,
  workerEnv: Partial<Env>
) {
  const role = await verifyTenantMembership(db, user.id, tenantId)
  const superAdmin = isSuperAdminUser(user, workerEnv)
  return {
    isMember: superAdmin || role !== null,
    canManage: superAdmin || (role !== null && MANAGER_ROLES.has(role)),
  }
}

/** HS-14 tenant AI switch. `db` is the main D1 (tenants, memberships, audit). */
export const aiSettingsService = {
  async get(db: Database, user: SettingsUser, tenantId: string, workerEnv: Partial<Env>) {
    const access = await resolveAccess(db, user, tenantId, workerEnv)
    if (!access.isMember) return forbidden('Tenant membership required')
    const aiEnabled = await aiAccessRepository.findAiEnabled(db, tenantId)
    return {
      success: true as const,
      data: {
        aiEnabled: aiEnabled === true,
        canManage: access.canManage,
        providers: AI_CONTENT_PROVIDERS,
      },
    }
  },

  async set(
    db: Database,
    user: SettingsUser,
    tenantId: string,
    aiEnabled: boolean,
    workerEnv: Partial<Env>,
    options: { retentionDays?: number } = {}
  ) {
    const access = await resolveAccess(db, user, tenantId, workerEnv)
    if (!access.canManage) return forbidden('Tenant owner or admin access required')
    const previous = await aiAccessRepository.findAiEnabled(db, tenantId)
    await aiAccessRepository.setAiEnabled(db, tenantId, aiEnabled, new Date().toISOString())
    await auditService.recordSafely(
      db,
      {
        scope: tenantId,
        category: 'settings',
        action: aiEnabled ? 'settings.ai_enabled' : 'settings.ai_disabled',
        outcome: 'success',
        actorId: user.id,
        actorSource: 'user',
        targetType: 'tenant',
        targetId: tenantId,
        metadata: {
          previous: previous === true,
          providers: AI_CONTENT_PROVIDERS.map((provider) => provider.id),
        },
      },
      options
    )
    return {
      success: true as const,
      data: { aiEnabled, canManage: true, providers: AI_CONTENT_PROVIDERS },
    }
  },
}
