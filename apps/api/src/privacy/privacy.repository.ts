import { and, asc, eq, inArray, or, sql } from 'drizzle-orm'
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

type BatchableDb = { batch: (queries: unknown[]) => Promise<unknown[]> }

/** Run named statements, atomically through D1 `batch()` when the driver has it. */
async function runStatements(
  db: Database,
  statements: Record<string, PromiseLike<unknown>>
): Promise<Record<string, number>> {
  const entries = Object.entries(statements)
  const batch = (db as unknown as Partial<BatchableDb>).batch
  const results =
    typeof batch === 'function'
      ? await batch.call(db, entries.map(([, statement]) => statement))
      : await entries.reduce<Promise<unknown[]>>(
          async (done, [, statement]) => [...(await done), await statement],
          Promise.resolve([])
        )
  return Object.fromEntries(entries.map(([key], index) => [key, changesOf(results[index])]))
}

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
    const ownedByUser = db
      .select({ tenantId: tenantUsers.tenantId })
      .from(tenantUsers)
      .where(and(eq(tenantUsers.userId, userId), eq(tenantUsers.role, 'owner')))
    const rows = await db
      .select({ tenantId: tenantUsers.tenantId })
      .from(tenantUsers)
      .where(and(eq(tenantUsers.role, 'owner'), inArray(tenantUsers.tenantId, ownedByUser)))
      .groupBy(tenantUsers.tenantId)
      .having(sql`count(*) = 1`)
    return rows.map((row) => row.tenantId)
  },

  /**
   * Replace the user id with a pseudonym in authored-by references (content
   * metadata, command log, audit ledger). Content fields are never touched.
   */
  pseudonymizeStatements(db: Database, userId: string, pseudonym: string) {
    return {
      entryVersions: db
        .update(entryVersions)
        .set({ createdBy: pseudonym })
        .where(eq(entryVersions.createdBy, userId)),
      assets: db.update(assets).set({ createdBy: pseudonym }).where(eq(assets.createdBy, userId)),
      aiImportBatches: db
        .update(aiImportBatches)
        .set({ createdByUserId: pseudonym })
        .where(eq(aiImportBatches.createdByUserId, userId)),
      commands: db
        .update(processedCommands)
        .set({ actor: sql`json_set(${processedCommands.actor}, '$.userId', ${pseudonym})` })
        .where(eq(actorUserId, userId)),
      auditActor: db
        .update(auditEvents)
        .set({ actorId: pseudonym })
        .where(eq(auditEvents.actorId, userId)),
      auditTarget: db
        .update(auditEvents)
        .set({ targetId: pseudonym })
        .where(eq(auditEvents.targetId, userId)),
    }
  },

  /** Account rows to delete. The user row goes last. */
  deleteStatements(db: Database, userId: string, email: string) {
    return {
      sessions: db.delete(session).where(eq(session.userId, userId)),
      accounts: db.delete(account).where(eq(account.userId, userId)),
      memberships: db.delete(tenantUsers).where(eq(tenantUsers.userId, userId)),
      // Email verification rows are keyed by email; password-reset rows hold the user id.
      verifications: db
        .delete(verification)
        .where(or(eq(verification.identifier, email), eq(verification.value, userId))),
      user: db.delete(user).where(eq(user.id, userId)),
    }
  },

  async pseudonymizeReferences(
    db: Database,
    userId: string,
    pseudonym: string
  ): Promise<PseudonymizationCounts> {
    const statements = this.pseudonymizeStatements(db, userId, pseudonym)
    return (await runStatements(db, statements)) as PseudonymizationCounts
  },

  /** Pseudonymize and delete in one D1 batch (atomic); sequential on drivers without batch. */
  async pseudonymizeAndDelete(
    db: Database,
    userId: string,
    pseudonym: string,
    email: string
  ): Promise<{ pseudonymized: PseudonymizationCounts; deleted: DeletionCounts }> {
    const pseudonymize = this.pseudonymizeStatements(db, userId, pseudonym)
    const remove = this.deleteStatements(db, userId, email)
    const counts = await runStatements(db, { ...pseudonymize, ...remove })
    const pick = <K extends string>(keys: K[]) =>
      Object.fromEntries(keys.map((key) => [key, counts[key] ?? 0])) as Record<K, number>
    return {
      pseudonymized: pick(Object.keys(pseudonymize) as (keyof PseudonymizationCounts)[]),
      deleted: pick(Object.keys(remove) as (keyof DeletionCounts)[]),
    }
  },
}
