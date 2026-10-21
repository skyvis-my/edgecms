import { and, desc, eq, gt, isNull } from 'drizzle-orm'
import type { Database } from '@/database/db'
import { signupInvites } from '@/database/schema'

export type SignupInviteRow = typeof signupInvites.$inferSelect
export type SignupInviteInsert = typeof signupInvites.$inferInsert

/** Data access for single-use sign-up invites. */
export const invitesRepository = {
  async create(db: Database, data: SignupInviteInsert): Promise<SignupInviteRow> {
    const rows = await db.insert(signupInvites).values(data).returning()
    const row = rows[0]
    if (!row) throw new Error('Failed to create invite: insert returned no rows')
    return row
  },

  async findByTokenHash(db: Database, tokenHash: string): Promise<SignupInviteRow | undefined> {
    const rows = await db
      .select()
      .from(signupInvites)
      .where(eq(signupInvites.tokenHash, tokenHash))
      .limit(1)
    return rows[0]
  },

  async findById(db: Database, id: string): Promise<SignupInviteRow | undefined> {
    const rows = await db.select().from(signupInvites).where(eq(signupInvites.id, id)).limit(1)
    return rows[0]
  },

  async list(db: Database, limit = 100): Promise<SignupInviteRow[]> {
    return db
      .select()
      .from(signupInvites)
      .orderBy(desc(signupInvites.createdAt))
      .limit(Math.min(200, Math.max(1, limit)))
      .all()
  },

  /**
   * Atomically marks a usable invite as used. Returns the row only for the one
   * caller that wins; a reused, revoked, expired or foreign-email invite returns
   * undefined.
   */
  async consume(
    db: Database,
    input: { tokenHash: string; email: string; now: number }
  ): Promise<SignupInviteRow | undefined> {
    const rows = await db
      .update(signupInvites)
      .set({ usedAt: input.now })
      .where(
        and(
          eq(signupInvites.tokenHash, input.tokenHash),
          eq(signupInvites.email, input.email),
          isNull(signupInvites.usedAt),
          eq(signupInvites.revoked, false),
          gt(signupInvites.expiresAt, input.now)
        )
      )
      .returning()
    return rows[0]
  },

  async setUsedBy(db: Database, id: string, userId: string): Promise<void> {
    await db
      .update(signupInvites)
      .set({ usedBy: userId })
      .where(and(eq(signupInvites.id, id), isNull(signupInvites.usedBy)))
  },

  /** Revokes an unused invite. Returns false when it was already used or revoked. */
  async revoke(db: Database, id: string, now: number): Promise<boolean> {
    const rows = await db
      .update(signupInvites)
      .set({ revoked: true, usedAt: now })
      .where(
        and(
          eq(signupInvites.id, id),
          isNull(signupInvites.usedAt),
          eq(signupInvites.revoked, false)
        )
      )
      .returning({ id: signupInvites.id })
    return rows.length > 0
  },
}
