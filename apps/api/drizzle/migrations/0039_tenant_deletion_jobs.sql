-- HS-09: tenant offboarding deletion jobs (see tenant-offboarding.schema.ts).
-- Control-plane record that outlives the tenant it deletes; never tenant-deleted.
CREATE TABLE IF NOT EXISTS "tenant_deletion_jobs" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "tenant_slug" TEXT NOT NULL,
  "tenant_name" TEXT NOT NULL,
  "previous_status" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'requested',
  "requested_by" TEXT NOT NULL,
  "requested_at" TEXT NOT NULL,
  "export_id" TEXT,
  "confirmed_by" TEXT,
  "confirmed_at" TEXT,
  "counts" TEXT NOT NULL DEFAULT '{}',
  "r2_objects_queued" INTEGER NOT NULL DEFAULT 0,
  "r2_queued_at" TEXT,
  "receipt_audit_event_id" TEXT,
  "event_emitted_at" TEXT,
  "lease_until" TEXT,
  "last_error" TEXT,
  "completed_at" TEXT,
  "updated_at" TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_deletion_jobs_tenant_idx" ON "tenant_deletion_jobs" ("tenant_id");
--> statement-breakpoint
-- At most one open (requested or confirmed) job per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_deletion_jobs_open_unique"
  ON "tenant_deletion_jobs" ("tenant_id")
  WHERE "status" IN ('requested', 'confirmed');
