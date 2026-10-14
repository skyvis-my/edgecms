-- Audit fixes: global enabled sweep, asset search, published listing, user bootstrap, drift cleanup
CREATE INDEX IF NOT EXISTS "webhooks_enabled_idx" ON "webhooks" ("enabled");
CREATE INDEX IF NOT EXISTS "assets_tenant_deleted_filename_idx" ON "assets" ("tenant_id", "deleted_at", "filename");
CREATE INDEX IF NOT EXISTS "assets_tenant_deleted_mimetype_idx" ON "assets" ("tenant_id", "deleted_at", "mime_type");
DROP INDEX IF EXISTS "entries_published_idx";
CREATE INDEX IF NOT EXISTS "entries_collection_published_idx" ON "entries" ("collectionId", "createdAt") WHERE "status" = 'published';
CREATE INDEX IF NOT EXISTS "user_created_at_idx" ON "user" ("createdAt");
DROP INDEX IF EXISTS "assets_created_at_idx";
