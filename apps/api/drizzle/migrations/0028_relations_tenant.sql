-- Relations tenant scope (TENANT ISOLATION R1-R3)
-- Add tenantId denormalized from the source entry's collection, backfill
-- pre-existing rows from the source entry -> collection join, then index.
ALTER TABLE "relations" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'global';
UPDATE "relations" SET "tenantId" = COALESCE((SELECT "c"."tenantId" FROM "entries" "e" JOIN "collections" "c" ON "c"."id" = "e"."collectionId" WHERE "e"."id" = "relations"."sourceEntryId"), 'global');
CREATE INDEX IF NOT EXISTS "relations_tenant_source_idx" ON "relations" ("tenantId", "sourceEntryId");
