-- CMD-06: mirrors ../migrations/0040_side_effect_intents.sql.
-- Durable post-commit side-effect intents (KV snapshot invalidation,
-- CDN tag purge, frontend revalidation, RAG indexing, FTS sync). The command
-- engine writes these rows in the same D1 batch as processed_commands, runs
-- them after the commit and marks them done; the intent relay retries rows
-- that are still pending. See src/commands/side-effect-intents.ts.
CREATE TABLE IF NOT EXISTS "side_effect_intents" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "command_id" TEXT,
  "tenant_scope" TEXT NOT NULL DEFAULT 'global',
  "kind" TEXT NOT NULL,
  "payload" TEXT NOT NULL DEFAULT '{}',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TEXT,
  "last_error" TEXT,
  "created_at" TEXT NOT NULL,
  "completed_at" TEXT
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "side_effect_intents_status_next_attempt_idx"
  ON "side_effect_intents" ("status", "next_attempt_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "side_effect_intents_tenant_idx" ON "side_effect_intents" ("tenant_scope");
