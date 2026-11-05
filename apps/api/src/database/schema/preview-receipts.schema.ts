import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * Preview receipt redemptions (AI-05) — one row per executed preview receipt.
 *
 * Receipts themselves live in KV with a TTL. KV is eventually consistent and
 * has no compare-and-set, so single use is enforced here: redemption inserts
 * the receipt id and the primary key rejects any second redemption.
 */
export const previewReceiptRedemptions = sqliteTable(
  'preview_receipt_redemptions',
  {
    receiptId: text('receipt_id').primaryKey(),
    /** Tenant the receipt was bound to (null for global scope). */
    tenantScope: text('tenant_scope'),
    /** Actor that redeemed (and minted) the receipt. */
    userId: text('user_id').notNull(),
    /** SHA-256 of the canonical command envelopes that were executed. */
    commandsHash: text('commands_hash').notNull(),
    redeemedAt: text('redeemed_at').notNull(),
  },
  (table) => [index('preview_receipt_redemptions_redeemed_at_idx').on(table.redeemedAt)]
)
