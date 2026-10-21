import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/**
 * Audit events ledger (HS-12) — a hash-chained, append-only record of
 * security-relevant actions per audit scope.
 *
 * Each scope (a tenant id, or `global` for sign-ins and super-admin actions)
 * is its own chain: `seq` increases by one per event and `hash` covers the
 * previous event's hash plus this event's canonical fields. Personal
 * identifiers (`actorId`, `targetId`) are committed to the hash through their
 * digests, so pseudonymizing them for a data-deletion request (HS-13) keeps
 * the chain verifiable.
 */
export const auditEvents = sqliteTable(
  'audit_events',
  {
    id: text('id').primaryKey(),
    /** Chain scope: tenant id, or `global`. */
    scope: text('scope').notNull(),
    /** 1-based position in the scope's chain. */
    seq: integer('seq').notNull(),
    /** Event family: `command`, `auth`, `rbac`, `super_admin`, `privacy`, `audit`, `settings`. */
    category: text('category').notNull(),
    /** Dot-notation action, e.g. `command.executed`, `auth.sign_in`. */
    action: text('action').notNull(),
    /** `success` or `failure`. */
    outcome: text('outcome').notNull(),
    /** Acting user id (pseudonymized on account deletion). Null for anonymous events. */
    actorId: text('actorId'),
    /** SHA-256 of the actor id at write time; the hash commits to this, not `actorId`. */
    actorDigest: text('actorDigest'),
    /** Actor source: `user`, `ai`, `system`, `api_key`. */
    actorSource: text('actorSource').notNull(),
    /** Target entity type (e.g. `user`, `role`, `tenant`, `entry`). */
    targetType: text('targetType'),
    /** Target entity id (pseudonymized when it is a deleted user). */
    targetId: text('targetId'),
    /** SHA-256 of the target id at write time. */
    targetDigest: text('targetDigest'),
    /** Redacted JSON details. Never holds emails, tokens or secrets. */
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    /** ISO 8601 timestamp. */
    occurredAt: text('occurredAt').notNull(),
    /** Hash of the previous event in this scope (genesis value for seq 1). */
    prevHash: text('prevHash').notNull(),
    /** SHA-256 over prevHash + canonical event fields. */
    hash: text('hash').notNull(),
  },
  (table) => [
    uniqueIndex('audit_events_scope_seq_unique').on(table.scope, table.seq),
    index('audit_events_scope_occurred_idx').on(table.scope, table.occurredAt),
    index('audit_events_actor_idx').on(table.actorId),
    index('audit_events_target_idx').on(table.targetId),
  ]
)

export type AuditEventRow = typeof auditEvents.$inferSelect
