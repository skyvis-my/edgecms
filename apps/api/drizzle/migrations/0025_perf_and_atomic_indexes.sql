-- Drop redundant and suboptimal indexes
DROP INDEX IF EXISTS "collections_tenantId_idx";
DROP INDEX IF EXISTS "entries_collectionId_idx";
DROP INDEX IF EXISTS "entry_versions_entryId_idx";
DROP INDEX IF EXISTS "user_email_idx";
DROP INDEX IF EXISTS "roles_tenant_id_idx";
DROP INDEX IF EXISTS "roles_tenant_name_idx";
DROP INDEX IF EXISTS "change_log_tenant_scope_idx";
DROP INDEX IF EXISTS "assets_tenant_id_idx";
DROP INDEX IF EXISTS "webhooks_tenant_id_idx";
DROP INDEX IF EXISTS "schema_snapshots_tenant_created_at_idx";
DROP INDEX IF EXISTS "webhook_deliveries_webhook_id_idx";
DROP INDEX IF EXISTS "relations_source_field_idx";
DROP INDEX IF EXISTS "cache_tags_tag_idx";
DROP INDEX IF EXISTS "ai_import_sources_tenant_batch_idx";
DROP INDEX IF EXISTS "ai_suggestion_sets_tenant_batch_idx";
DROP INDEX IF EXISTS "ai_suggestions_tenant_set_idx";
DROP INDEX IF EXISTS "ai_tool_invocations_tenant_batch_idx";

-- Create new optimized composite, foreign key, and unique indexes
CREATE INDEX IF NOT EXISTS "relations_source_field_idx" ON "relations" ("sourceEntryId", "fieldName", "sortOrder");
CREATE INDEX IF NOT EXISTS "relations_source_collection_idx" ON "relations" ("sourceCollectionId");
CREATE INDEX IF NOT EXISTS "relations_target_collection_idx" ON "relations" ("targetCollectionId");
CREATE INDEX IF NOT EXISTS "entries_collection_status_created_idx" ON "entries" ("collectionId", "status", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "account_provider_account_unique" ON "account" ("providerId", "accountId");
CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "verification" ("identifier");
CREATE INDEX IF NOT EXISTS "ai_import_sources_batch_tenant_idx" ON "ai_import_sources" ("batch_id", "tenant_id", "created_at");
CREATE INDEX IF NOT EXISTS "ai_suggestion_sets_batch_tenant_idx" ON "ai_suggestion_sets" ("batch_id", "tenant_id", "created_at");
CREATE INDEX IF NOT EXISTS "ai_suggestions_set_tenant_idx" ON "ai_suggestions" ("suggestion_set_id", "tenant_id", "created_at");
CREATE INDEX IF NOT EXISTS "ai_tool_invocations_batch_tenant_idx" ON "ai_tool_invocations" ("batch_id", "tenant_id");
CREATE UNIQUE INDEX IF NOT EXISTS "schema_snapshots_tenant_version_unique" ON "schema_snapshots" ("tenant_id", "schema_version");
CREATE INDEX IF NOT EXISTS "change_log_command_id_idx" ON "change_log" ("commandId");
CREATE UNIQUE INDEX IF NOT EXISTS "roles_tenant_name_unique" ON "roles" ("tenant_id", "name");
CREATE INDEX IF NOT EXISTS "cache_tags_tag_snapshot_idx" ON "cache_tags" ("tag", "snapshotKey");
CREATE INDEX IF NOT EXISTS "webhook_deliveries_webhook_created_idx" ON "webhook_deliveries" ("webhook_id", "created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "relations_one_to_one_unique" ON "relations" ("sourceEntryId", "fieldName") WHERE "relationType" = 'one-to-one';
