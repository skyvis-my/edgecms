-- HS-14: per-tenant AI switch. Existing tenants keep AI on (DEFAULT 1) so an
-- upgrade does not change behavior; the application inserts new tenants with 0.
ALTER TABLE "tenants" ADD COLUMN "aiEnabled" INTEGER NOT NULL DEFAULT 1;
