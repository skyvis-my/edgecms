-- AI-05: single-use ledger for preview receipts. A receipt is redeemed by
-- inserting its id; the primary key makes a second (replayed or concurrent)
-- redemption fail atomically, even when the KV copy of the receipt is stale.
CREATE TABLE IF NOT EXISTS "preview_receipt_redemptions" (
  "receipt_id" TEXT PRIMARY KEY NOT NULL,
  "tenant_scope" TEXT,
  "user_id" TEXT NOT NULL,
  "commands_hash" TEXT NOT NULL,
  "redeemed_at" TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "preview_receipt_redemptions_redeemed_at_idx"
  ON "preview_receipt_redemptions" ("redeemed_at");
