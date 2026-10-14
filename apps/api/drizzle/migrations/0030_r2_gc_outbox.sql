-- R2 GC outbox: durable intent log for R2 object deletes (see r2GcOutbox schema)
CREATE TABLE IF NOT EXISTS "r2_gc_outbox" (
  "id" TEXT PRIMARY KEY,
  "tenant_id" TEXT NOT NULL DEFAULT 'global',
  "object_key" TEXT NOT NULL UNIQUE,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TEXT,
  "created_at" TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS "r2_gc_outbox_status_next_attempt_idx" ON "r2_gc_outbox" ("status", "next_attempt_at");
