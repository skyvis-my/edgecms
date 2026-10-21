import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { user } from './auth.schema'
import { tenants } from './tenants.schema'

/**
 * Single-use sign-up invites for the `invite-only` signup policy (PRD HS-01).
 *
 * Only the SHA-256 hash of the invite token is stored. An invite is bound to
 * one email address and may grant membership of one tenant when consumed.
 */
export const signupInvites = sqliteTable(
  'signup_invites',
  {
    id: text('id').primaryKey(),
    tokenHash: text('tokenHash').notNull(),
    /** Lower-cased email the invite is bound to. */
    email: text('email').notNull(),
    tenantId: text('tenantId').references(() => tenants.id, { onDelete: 'cascade' }),
    tenantRole: text('tenantRole'),
    createdBy: text('createdBy').references(() => user.id, { onDelete: 'set null' }),
    /** Unix ms. */
    expiresAt: integer('expiresAt').notNull(),
    /** Unix ms; set when the invite is consumed or revoked. */
    usedAt: integer('usedAt'),
    usedBy: text('usedBy').references(() => user.id, { onDelete: 'set null' }),
    revoked: integer('revoked', { mode: 'boolean' }).notNull().default(false),
    /** Unix ms. */
    createdAt: integer('createdAt').notNull(),
  },
  (table) => [
    uniqueIndex('signup_invites_token_hash_unique').on(table.tokenHash),
    index('signup_invites_email_idx').on(table.email),
  ]
)
