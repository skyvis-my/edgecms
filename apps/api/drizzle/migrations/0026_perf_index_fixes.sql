-- Perf index fixes (INDEX AUDIT M1-M6, R1-R5)
-- Entries: drop full status idx, add partial published idx + publish/unpublish/updated
DROP INDEX IF EXISTS "entries_status_idx";
CREATE INDEX IF NOT EXISTS "entries_collection_publish_idx" ON "entries" ("collectionId", "publish_at");
CREATE INDEX IF NOT EXISTS "entries_collection_unpublish_idx" ON "entries" ("collectionId", "unpublish_at");
CREATE INDEX IF NOT EXISTS "entries_collection_updated_idx" ON "entries" ("collectionId", "updatedAt");
CREATE INDEX IF NOT EXISTS "entries_published_idx" ON "entries" ("id") WHERE "status" = 'published';

-- Webhooks: drop redundant enabled / tenant-enabled-events, add tenant-enabled + tenant-created
DROP INDEX IF EXISTS "webhooks_enabled_idx";
DROP INDEX IF EXISTS "webhooks_tenant_enabled_events_idx";
CREATE INDEX IF NOT EXISTS "webhooks_tenant_enabled_idx" ON "webhooks" ("tenant_id", "enabled");
CREATE INDEX IF NOT EXISTS "webhooks_tenant_created_idx" ON "webhooks" ("tenant_id", "created_at");

-- Assets: drop redundant 2-col, keep 3-col
DROP INDEX IF EXISTS "assets_tenant_created_at_idx";

-- Asset variants: dedupe guard
CREATE UNIQUE INDEX IF NOT EXISTS "asset_variants_asset_variant_format_unique" ON "asset_variants" ("asset_id", "variant", "format");

-- Verification: identifier-only -> identifier+value
DROP INDEX IF EXISTS "verification_identifier_idx";
CREATE INDEX IF NOT EXISTS "verification_identifier_value_idx" ON "verification" ("identifier", "value");

-- AI suggestions: extend set_tenant idx with status
DROP INDEX IF EXISTS "ai_suggestions_set_tenant_idx";
CREATE INDEX IF NOT EXISTS "ai_suggestions_set_tenant_idx" ON "ai_suggestions" ("suggestion_set_id", "tenant_id", "status", "created_at");

-- Webhook deliveries: merge status + next_retry into composite
DROP INDEX IF EXISTS "webhook_deliveries_status_idx";
DROP INDEX IF EXISTS "webhook_deliveries_next_retry_at_idx";
CREATE INDEX IF NOT EXISTS "webhook_deliveries_status_retry_idx" ON "webhook_deliveries" ("status", "next_retry_at");
