CREATE TABLE IF NOT EXISTS `schema_snapshots` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL DEFAULT 'global',
  `schema_version` integer NOT NULL,
  `payload` text,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `schema_snapshots_tenant_created_at_idx`
  ON `schema_snapshots` (`tenant_id`, `created_at`);
