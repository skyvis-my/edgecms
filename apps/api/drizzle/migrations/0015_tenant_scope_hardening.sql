ALTER TABLE `assets` ADD COLUMN `tenant_id` text NOT NULL DEFAULT 'global';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `assets_tenant_id_idx` ON `assets` (`tenant_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `assets_tenant_created_at_idx` ON `assets` (`tenant_id`,`created_at`);
--> statement-breakpoint
ALTER TABLE `webhooks` ADD COLUMN `tenant_id` text NOT NULL DEFAULT 'global';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `webhooks_tenant_id_idx` ON `webhooks` (`tenant_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `webhooks_tenant_enabled_events_idx` ON `webhooks` (`tenant_id`,`enabled`,`events`);
