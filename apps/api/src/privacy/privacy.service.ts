import { AUDIT_GLOBAL_SCOPE, AUDIT_PSEUDONYM_PREFIX } from '@/audit/audit-chain'
import { auditService } from '@/audit/audit.service'
import { bumpAuthRevision } from '@/auth/auth-revision'
import type { Database } from '@/database/db'
import type { ServiceResult } from '@/shared/utils/service-response'
import { privacyRepository } from './privacy.repository'

/** Per-category cap so one export stays inside Worker memory and time limits. */
export const PRIVACY_EXPORT_LIMIT = 5000

export type PrivacyRequester = { kind: 'self' | 'super_admin'; actorId: string }

type PrivacyError = { code: 'NOT_FOUND' | 'CONFLICT'; message: string }

function newPseudonym(): string {
  return `${AUDIT_PSEUDONYM_PREFIX}${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
}

function fail(code: PrivacyError['code'], message: string): ServiceResult<never, PrivacyError> {
  return { success: false, error: { code, message } }
}

function capped<T>(rows: T[]) {
  return { items: rows, truncated: rows.length >= PRIVACY_EXPORT_LIMIT }
}

export const privacyService = {
  /**
   * HS-13 export: everything EdgeCMS stores about one user, without secrets
   * (no password hashes, OAuth tokens or session tokens). Authored content is
   * listed by reference; the content itself belongs to the tenant.
   */
  async exportUserData(
    db: Database,
    userId: string,
    requester: PrivacyRequester,
    options: { retentionDays?: number } = {}
  ) {
    const found = await privacyRepository.findUser(db, userId)
    if (!found) {
      return fail('NOT_FOUND', 'User not found')
    }

    const limit = PRIVACY_EXPORT_LIMIT
    const [accounts, sessions, memberships, entryVersions, assets, aiImportBatches, commands, auditEvents] =
      await Promise.all([
        privacyRepository.listAccounts(db, userId),
        privacyRepository.listSessions(db, userId),
        privacyRepository.listMemberships(db, userId),
        privacyRepository.listEntryVersions(db, userId, limit),
        privacyRepository.listAssets(db, userId, limit),
        privacyRepository.listAiImportBatches(db, userId, limit),
        privacyRepository.listCommands(db, userId, limit),
        privacyRepository.listAuditEvents(db, userId, limit),
      ])

    await auditService.recordSafely(
      db,
      {
        scope: AUDIT_GLOBAL_SCOPE,
        category: 'privacy',
        action: 'privacy.data_exported',
        outcome: 'success',
        actorId: requester.actorId,
        actorSource: 'user',
        targetType: 'user',
        targetId: userId,
        metadata: { requestedBy: requester.kind },
      },
      { retentionDays: options.retentionDays }
    )

    return {
      success: true as const,
      data: {
        exportedAt: new Date().toISOString(),
        user: {
          id: found.id,
          name: found.name,
          email: found.email,
          emailVerified: found.emailVerified,
          image: found.image,
          role: found.role,
          createdAt: found.createdAt,
          updatedAt: found.updatedAt,
        },
        accounts,
        sessions,
        memberships,
        authoredReferences: {
          entryVersions: capped(entryVersions),
          assets: capped(assets),
          aiImportBatches: capped(aiImportBatches),
          commands: capped(commands),
        },
        auditEvents: capped(auditEvents),
      },
    }
  },

  /**
   * HS-13 deletion: pseudonymize authored-by references, then delete the
   * account, sessions, linked accounts, memberships and verification rows.
   * Tenant content is never deleted. Ends with a receipt in the global audit
   * chain that names only the pseudonym.
   */
  async deleteUserData(
    db: Database,
    userId: string,
    requester: PrivacyRequester,
    options: { kv?: KVNamespace; retentionDays?: number } = {}
  ) {
    const found = await privacyRepository.findUser(db, userId)
    if (!found) {
      return fail('NOT_FOUND', 'User not found')
    }

    const soleOwned = await privacyRepository.findSoleOwnedTenants(db, userId)
    if (soleOwned.length > 0) {
      return fail(
        'CONFLICT',
        `User is the only owner of ${soleOwned.length} tenant(s); transfer ownership first`
      )
    }

    const memberships = await privacyRepository.listMemberships(db, userId)
    const pseudonym = newPseudonym()
    const first = await privacyRepository.pseudonymizeReferences(db, userId, pseudonym)
    const deleted = await privacyRepository.deleteAccountData(db, userId, found.email)
    // Second pass catches references written while the account was being deleted.
    const second = await privacyRepository.pseudonymizeReferences(db, userId, pseudonym)
    const pseudonymized = Object.fromEntries(
      Object.entries(first).map(([key, count]) => [key, count + second[key as keyof typeof second]])
    ) as typeof first

    // Invalidate cached tenant tokens; existing access tokens and the
    // 5-minute session cookie cache expire on their own.
    await Promise.all(
      memberships.map((m) => bumpAuthRevision(options.kv, userId, m.tenantId).catch(() => 0))
    )

    const completedAt = new Date().toISOString()
    const receipt = await auditService.recordSafely(
      db,
      {
        scope: AUDIT_GLOBAL_SCOPE,
        category: 'privacy',
        action: 'privacy.user_deleted',
        outcome: 'success',
        actorId: requester.kind === 'self' ? pseudonym : requester.actorId,
        actorSource: 'user',
        targetType: 'user',
        targetId: pseudonym,
        metadata: {
          requestedBy: requester.kind,
          pseudonymized,
          deleted,
          tenantCount: memberships.length,
        },
      },
      { retentionDays: options.retentionDays }
    )

    return {
      success: true as const,
      data: {
        pseudonym,
        completedAt,
        pseudonymized,
        deleted,
        receipt: receipt
          ? { auditEventId: receipt.id, scope: receipt.scope, seq: receipt.seq, hash: receipt.hash }
          : null,
      },
    }
  },
}
