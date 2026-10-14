-- Schedule intents: durable intent log for scheduler DO notifications (see scheduleIntents schema)
CREATE TABLE IF NOT EXISTS "schedule_intents" (
  "id" TEXT PRIMARY KEY,
  "entry_id" TEXT NOT NULL,
  "transition_type" TEXT NOT NULL,
  "scheduled_at" TEXT,
  "tenant_scope" TEXT NOT NULL DEFAULT 'global',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "schedule_intents_entry_transition_unique" ON "schedule_intents" ("entry_id", "transition_type");
CREATE INDEX IF NOT EXISTS "schedule_intents_status_next_attempt_idx" ON "schedule_intents" ("status", "next_attempt_at");
