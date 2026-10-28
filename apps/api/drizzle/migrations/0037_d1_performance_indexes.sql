-- D1 Performance Indexes & Schema Cleanup
CREATE INDEX IF NOT EXISTS "entries_collection_created_at_idx" ON "entries" ("collectionId", "createdAt");
CREATE INDEX IF NOT EXISTS "audit_log_timestamp_idx" ON "audit_log" ("timestamp");
CREATE INDEX IF NOT EXISTS "session_expires_at_idx" ON "session" ("expiresAt");
CREATE INDEX IF NOT EXISTS "processed_commands_tenant_executed_at_idx" ON "processed_commands" ("tenantScope", "executedAt");
