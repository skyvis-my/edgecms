import { and, asc, eq, ne, or, sql } from 'drizzle-orm'
import type { Database } from '@/database/db'
import {
  account,
  aiImportBatches,
  assets,
  auditEvents,
  entryVersions,
  processedCommands,
  session,
  tenantUsers,
  tenants,
  user,
  verification,
} from '@/database/schema'

const actorUserId = sql`json_extract(${processedCommands.actor}, '$.userId')`

/** Rows-changed count across D1 (`meta.changes`) and bun:sqlite (`changes`) results. */
function changesOf(result: unknown): number {
  const value = result as { changes?: unknown; meta?: { changes?: unknown } } | undefined
  const changes = value?.meta?.changes ?? value?.changes
  return typeof changes === 'number' ? changes : 0
}

export type PseudonymizationCounts = {
  entryVersions: number
  assets: number
  aiImportBatches: number
  commands: number
  auditActor: number
  auditTarget: number
}

export type DeletionCounts = {
  sessions: number
  accounts: number
  memberships: number
  verifications: number
  user: number
}

export const privacyRepository = {
  async findUser(db: Database, userId: string) {
    const rows = await db.select().from(user).where(eq(user.id, userId)).limit(1)
    return rows[0] ?? null
  },

  /** Linked sign-in methods without tokens or password hashes. */
  listAccounts(db: Database, userId: string) {
    return db
      .select({
        providerId: account.providerId,
        accountId: account.accountId,
        scope: account.scope,
        createdAt: account.createdAt,
        updatedAt: account.updatedAt,
      })
      .from(account)
      .where(eq(account.userId, userId))
  },

  /** Sessions without their bearer token. */
  listSessions(db: Database, userId: string) {
    return db
      .select({
        id: session.id,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        expiresAt: session.expiresAt,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
      })
      .from(session)
      .where(eq(session.userId, userId))
  },

  listMemberships(db: Database, userId: string) {
    return db
      .select({
        tenantId: tenantUsers.tenantId,
        tenantSlug: tenants.slug,
        tenantName: tenants.name,
        role: tenantUsers.role,
        createdAt: tenantUsers.createdAt,
      })
      .from(tenantUsers)
      .innerJoin(tenants, eq(tenantUsers.tenantId, tenants.id))
      .where(eq(tenantUsers.userId, userId))
  },

  listEntryVersions(db: Database, userId: string, limit: number) {
    return db
      .select({
        entryId: entryVersions.entryId,
        version: entryVersions.version,
        createdAt: entryVersions.createdAt,
      })
      .from(entryVersions)
      .where(eq(entryVersions.createdBy, userId))
      .orderBy(asc(entryVersions.createdAt))
      .limit(limit)
  },

  listAssets(db: Database, userId: string, limit: number) {
    return db
      .select({
        id: assets.id,
        tenantId: assets.tenantId,
        filename: assets.filename,
        createdAt: assets.createdAt,
      })
      .from(assets)
      .where(eq(assets.createdBy, userId))
      .orderBy(asc(assets.createdAt))
      .limit(limit)
  },

  listAiImportBatches(db: Database, userId: string, limit: number) {
    return db
      .select({
        id: aiImportBatches.id,
        tenantId: aiImportBatches.tenantId,
        intent: aiImportBatches.intent,
        status: aiImportBatches.status,
        createdAt: aiImportBatches.createdAt,
      })
      .from(aiImportBatches)
      .where(eq(aiImportBatches.createdByUserId, userId))
      .orderBy(asc(aiImportBatches.createdAt))
      .limit(limit)
  },

  listCommands(db: Database, userId: string, limit: number) {
    return db
      .select({
        id: processedCommands.id,
        commandType: processedCommands.commandType,
        tenantScope: processedCommands.tenantScope,
        status: processedCommands.status,
        executedAt: processedCommands.executedAt,
      })
      .from(processedCommands)
      .where(eq(actorUserId, userId))
      .orderBy(asc(processedCommands.executedAt))
      .limit(limit)
  },

  listAuditEvents(db: Database, userId: string, limit: number) {
    return db
      .select({
        scope: auditEvents.scope,
        seq: auditEvents.seq,
        category: auditEvents.category,
        action: auditEvents.action,
        outcome: auditEvents.outcome,
        occurredAt: auditEvents.occurredAt,
      })
      .from(auditEvents)
      .where(or(eq(auditEvents.actorId, userId), eq(auditEvents.targetId, userId)))
      .orderBy(asc(auditEvents.occurredAt))
      .limit(limit)
  },

  /** Tenants where this user is the only owner (deleting them would orphan the tenant). */
  async findSoleOwnedTenants(db: Database, userId: string): Promise<string[]> {
    const owned = await db
      .select({ tenantId: tenantUsers.tenantId })
      .from(tenantUsers)
      .where(and(eq(tenantUsers.userId, userId), eq(tenantUsers.role, 'owner')))
    const sole: string[] = []
    for (const { tenantId } of owned) {
      const others = await db
        .select({ userId: tenantUsers.userId })
        .from(tenantUsers)
        .where(
          and(
            eq(tenantUsers.tenantId, tenantId),
            eq(tenantUsers.role, 'owner'),
            ne(tenantUsers.userId, userId)
          )
        )
        .limit(1)
      if (others.length === 0) sole.push(tenantId)
    }
    return sole
  },

  /**
   * Replace the user id with a pseudonym in authored-by references (content
   * metadata, command log, audit ledger). Content fields are never touched.
   */
  async pseudonymizeReferences(
    db: Database,
    userId: string,
    pseudonym: string
  ): Promise<PseudonymizationCounts> {
    const entryVersionsResult = await db
      .update(entryVersions)
      .set({ createdBy: pseudonym })
      .where(eq(entryVersions.createdBy, userId))
    const assetsResult = await db
      .update(assets)
      .set({ createdBy: pseudonym })
      .where(eq(assets.createdBy, userId))
    const batchesResult = await db
      .update(aiImportBatches)
      .set({ createdByUserId: pseudonym })
      .where(eq(aiImportBatches.createdByUserId, userId))
    const commandsResult = await db
      .update(processedCommands)
      .set({ actor: sql`json_set(${processedCommands.actor}, '$.userId', ${pseudonym})` })
      .where(eq(actorUserId, userId))
    const auditActorResult = await db
      .update(auditEvents)
      .set({ actorId: pseudonym })
      .where(eq(auditEvents.actorId, userId))
    const auditTargetResult = await db
      .update(auditEvents)
      .set({ targetId: pseudonym })
      .where(eq(auditEvents.targetId, userId))
    return {
      entryVersions: changesOf(entryVersionsResult),
      assets: changesOf(assetsResult),
      aiImportBatches: changesOf(batchesResult),
      commands: changesOf(commandsResult),
      auditActor: changesOf(auditActorResult),
      auditTarget: changesOf(auditTargetResult),
    }
  },

  /** Delete account data. The user row goes last so a partial failure can be retried. */
  async deleteAccountData(db: Database, userId: string, email: string): Promise<DeletionCounts> {
    const sessions = await db.delete(session).where(eq(session.userId, userId))
    const accounts = await db.delete(account).where(eq(account.userId, userId))
    const memberships = await db.delete(tenantUsers).where(eq(tenantUsers.userId, userId))
    const verifications = await db.delete(verification).where(eq(verification.identifier, email))
    const users = await db.delete(user).where(eq(user.id, userId))
    return {
      sessions: changesOf(sessions),
      accounts: changesOf(accounts),
      memberships: changesOf(memberships),
      verifications: changesOf(verifications),
      user: changesOf(users),
    }
  },
}
