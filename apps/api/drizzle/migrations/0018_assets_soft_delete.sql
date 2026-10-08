ALTER TABLE `assets` ADD COLUMN `deleted_at` text;
--> statement-breakpoint
CREATE INDEX `assets_tenant_deleted_created_at_idx` ON `assets` (`tenant_id`,`deleted_at`,`created_at`);
