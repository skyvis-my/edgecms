CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`commandId` text NOT NULL,
	`entityType` text NOT NULL,
	`entityId` text NOT NULL,
	`action` text NOT NULL,
	`changes` text,
	`timestamp` text NOT NULL,
	FOREIGN KEY (`commandId`) REFERENCES `processed_commands`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `audit_log_entity_idx` ON `audit_log` (`entityType`,`entityId`);--> statement-breakpoint
CREATE INDEX `audit_log_commandId_idx` ON `audit_log` (`commandId`);--> statement-breakpoint
CREATE TABLE `processed_commands` (
	`id` text PRIMARY KEY NOT NULL,
	`commandType` text NOT NULL,
	`payload` text,
	`actor` text,
	`result` text,
	`status` text NOT NULL,
	`executedAt` text NOT NULL
);
