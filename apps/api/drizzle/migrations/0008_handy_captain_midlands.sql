CREATE TABLE `webhook_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`webhook_id` text NOT NULL,
	`event_id` text NOT NULL,
	`event_type` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_attempt_at` text,
	`next_retry_at` text,
	`response_status` integer,
	`response_body` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`webhook_id`) REFERENCES `webhooks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `webhook_deliveries_webhook_id_idx` ON `webhook_deliveries` (`webhook_id`);--> statement-breakpoint
CREATE INDEX `webhook_deliveries_status_idx` ON `webhook_deliveries` (`status`);--> statement-breakpoint
CREATE INDEX `webhook_deliveries_event_id_idx` ON `webhook_deliveries` (`event_id`);--> statement-breakpoint
CREATE INDEX `webhook_deliveries_next_retry_at_idx` ON `webhook_deliveries` (`next_retry_at`);--> statement-breakpoint
CREATE TABLE `webhooks` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`events` text NOT NULL,
	`secret` text NOT NULL,
	`headers` text,
	`enabled` integer DEFAULT true NOT NULL,
	`retry_max_retries` integer DEFAULT 5 NOT NULL,
	`retry_backoff` text DEFAULT 'exponential' NOT NULL,
	`retry_timeout` integer DEFAULT 30 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `webhooks_enabled_idx` ON `webhooks` (`enabled`);