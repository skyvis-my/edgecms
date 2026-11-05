import { Elysia, t } from 'elysia'
import { bumpAuthRevision } from '@/auth/auth-revision'
import { betterAuthPlugin } from '@/auth/auth.middleware'
import { isSuperAdminUser, parseSuperAdminEmails } from '@/auth/super-admin'
import { AUDIT_GLOBAL_SCOPE } from '@/audit/audit-chain'
import { auditService, resolveAuditRetentionDays } from '@/audit/audit.service'
import { createDb } from '@/database/db'
import { createErrorEnvelope, toServiceResponse } from '@/shared/utils/service-response'
import { withTenantBindings } from '@/tenants/with-tenant-bindings'
import { assignMemberRole } from './member-role.service'
import { usersService } from './users.service'

export const usersController = new Elysia({ prefix: '/api/admin/users' })
  .use(betterAuthPlugin)
  .use(withTenantBindings)
  .get('/', { auth: true }, async ({ db, tenantCtx, workerEnv }) => {
    const superAdminEmails = parseSuperAdminEmails(workerEnv.SUPER_ADMIN_EMAILS)

    const users = await usersService.findAdminUsers(db, {
      tenantId: tenantCtx?.tenant.id,
      superAdminEmails,
    })

    return {
      success: true as const,
      data: users,
    }
  })

  /**
   * PUT /:userId/role — set a tenant member's role (PL-03).
   *
   * Tenant routes only. The guard requires `manage TenantAdminRoles` (owner,
   * admin or an explicit grant); the service re-checks the caller and applies
   * the escalation and last-owner rules. Memberships and roles live in the
   * control-plane D1, like the guard's own membership reads.
   */
  .put(
    '/:userId/role',
    {
      auth: true,
      params: t.Object({ userId: t.String({ minLength: 1 }) }),
      body: t.Object({ role: t.String({ minLength: 1, maxLength: 50 }) }),
    },
    async ({ params, body, set, tenantCtx, workerEnv, user }) => {
      set.headers['cache-control'] = 'no-store'
      if (!tenantCtx?.tenant) {
        set.status = 400
        return createErrorEnvelope('BAD_REQUEST', 'Tenant context required')
      }
      const tenantId = tenantCtx.tenant.id
      const controlDb = createDb(workerEnv.DB)
      const result = await assignMemberRole(controlDb, {
        tenantId,
        caller: {
          userId: user.id,
          isSuperAdmin: isSuperAdminUser(
            user as { email: string; emailVerified?: boolean; role?: unknown },
            workerEnv
          ),
        },
        targetUserId: params.userId,
        role: body.role,
      })

      if (result.success && result.data.changed) {
        // Tokens minted before this change go stale (see auth-revision.ts).
        await bumpAuthRevision(workerEnv.CACHE, params.userId, tenantId)
        await auditService.recordSafely(
          controlDb,
          {
            scope: tenantId || AUDIT_GLOBAL_SCOPE,
            category: 'rbac',
            action: 'rbac.member_role.changed',
            outcome: 'success',
            actorId: user.id,
            actorSource: 'user',
            targetType: 'user',
            targetId: params.userId,
            metadata: {
              previousRole: result.data.previousRole,
              role: result.data.role,
              roleKind: result.data.roleKind,
            },
          },
          { retentionDays: resolveAuditRetentionDays(workerEnv.AUDIT_RETENTION_DAYS) }
        )
      }

      return toServiceResponse(set, result, { errorStatusMap: { LAST_OWNER: 409 } })
    }
  )
