CREATE TABLE `relations` (
	`id` text PRIMARY KEY NOT NULL,
	`sourceEntryId` text NOT NULL,
	`targetEntryId` text NOT NULL,
	`sourceCollectionId` text NOT NULL,
	`targetCollectionId` text NOT NULL,
	`relationType` text NOT NULL,
	`fieldName` text NOT NULL,
	`sortOrder` integer DEFAULT 0 NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`sourceEntryId`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`targetEntryId`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sourceCollectionId`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`targetCollectionId`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `relations_source_field_idx` ON `relations` (`sourceEntryId`,`fieldName`);--> statement-breakpoint
CREATE INDEX `relations_target_idx` ON `relations` (`targetEntryId`);--> statement-breakpoint
CREATE UNIQUE INDEX `relations_source_target_field_unique` ON `relations` (`sourceEntryId`,`targetEntryId`,`fieldName`);