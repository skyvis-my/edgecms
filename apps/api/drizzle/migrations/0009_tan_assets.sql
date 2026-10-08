CREATE TABLE IF NOT EXISTS `assets` (
  `id` text PRIMARY KEY NOT NULL,
  `filename` text NOT NULL,
  `mime_type` text NOT NULL,
  `size` integer NOT NULL,
  `original_key` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `assets_created_at_idx` ON `assets` (`created_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `asset_variants` (
  `id` text PRIMARY KEY NOT NULL,
  `asset_id` text NOT NULL,
  `variant` text NOT NULL,
  `format` text NOT NULL,
  `width` integer,
  `height` integer,
  `object_key` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `asset_variants_asset_id_idx` ON `asset_variants` (`asset_id`);
