CREATE TABLE `change_log` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`entityType` text NOT NULL,
	`entityId` text NOT NULL,
	`commandId` text,
	`changeType` text NOT NULL,
	`payload` text,
	`timestamp` text NOT NULL,
	FOREIGN KEY (`commandId`) REFERENCES `processed_commands`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `change_log_id_unique` ON `change_log` (`id`);--> statement-breakpoint
CREATE INDEX `change_log_entity_idx` ON `change_log` (`entityType`,`entityId`);