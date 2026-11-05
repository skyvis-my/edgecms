-- AI-05: mirrors ../migrations/0038_preview_receipt_redemptions.sql
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
