-- HS-05: daily usage rollups for the opt-in D1 usage sink (see usage.schema.ts)
CREATE TABLE IF NOT EXISTS "usage_daily" (
  "tenant_id" TEXT NOT NULL,
  "day" TEXT NOT NULL,
  "metric" TEXT NOT NULL,
  "detail" TEXT NOT NULL DEFAULT '',
  "value" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TEXT NOT NULL,
  PRIMARY KEY ("tenant_id", "day", "metric", "detail")
);
