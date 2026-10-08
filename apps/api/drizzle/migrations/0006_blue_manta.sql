CREATE TABLE `asset_variants` (
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
CREATE INDEX `asset_variants_asset_id_idx` ON `asset_variants` (`asset_id`);--> statement-breakpoint
CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`original_key` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `assets_created_at_idx` ON `assets` (`created_at`);--> statement-breakpoint
ALTER TABLE `processed_commands` ADD `tenantScope` text;--> statement-breakpoint
ALTER TABLE `change_log` ADD `tenantScope` text;