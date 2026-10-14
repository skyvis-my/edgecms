-- Transactional webhook outbox (H1: crash between DB commit and queue.sendBatch)
-- + consumer dedup guard (H2: queue at-least-once redelivery double-inserts)
CREATE TABLE `webhook_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL UNIQUE,
	`event_type` text NOT NULL,
	`payload` text NOT NULL,
	`tenant_scope` text DEFAULT 'global' NOT NULL,
	`command_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text,
	`created_at` text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS `webhook_outbox_event_id_unique` ON `webhook_outbox` (`event_id`);
CREATE INDEX IF NOT EXISTS `webhook_outbox_status_next_attempt_idx` ON `webhook_outbox` (`status`,`next_attempt_at`);

-- Consumer dedup: one delivery row per (event, webhook).
-- Drop pre-existing duplicates (keep earliest row) so the UNIQUE index applies cleanly.
DELETE FROM `webhook_deliveries` WHERE `id` NOT IN (SELECT MIN(`id`) FROM `webhook_deliveries` GROUP BY `event_id`, `webhook_id`);
CREATE UNIQUE INDEX IF NOT EXISTS `webhook_deliveries_event_webhook_unique` ON `webhook_deliveries` (`event_id`,`webhook_id`);
