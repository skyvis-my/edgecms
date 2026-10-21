-- HS-12: hash-chained audit events ledger (one chain per tenant scope plus 'global')
CREATE TABLE IF NOT EXISTS "audit_events" (
  "id" TEXT PRIMARY KEY,
  "scope" TEXT NOT NULL,
  "seq" INTEGER NOT NULL,
  "category" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "actorId" TEXT,
  "actorDigest" TEXT,
  "actorSource" TEXT NOT NULL,
  "targetType" TEXT,
  "targetId" TEXT,
  "targetDigest" TEXT,
  "metadata" TEXT NOT NULL,
  "occurredAt" TEXT NOT NULL,
  "prevHash" TEXT NOT NULL,
  "hash" TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "audit_events_scope_seq_unique" ON "audit_events" ("scope", "seq");
CREATE INDEX IF NOT EXISTS "audit_events_scope_occurred_idx" ON "audit_events" ("scope", "occurredAt");
CREATE INDEX IF NOT EXISTS "audit_events_actor_idx" ON "audit_events" ("actorId");
CREATE INDEX IF NOT EXISTS "audit_events_target_idx" ON "audit_events" ("targetId");
