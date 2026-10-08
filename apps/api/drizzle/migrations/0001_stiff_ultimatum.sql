CREATE TABLE `collections` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`singleton` integer DEFAULT false NOT NULL,
	`fields` text NOT NULL,
	`defaultLocale` text DEFAULT 'en' NOT NULL,
	`supportedLocales` text NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collections_slug_unique` ON `collections` (`slug`);--> statement-breakpoint
CREATE TABLE `entries` (
	`id` text PRIMARY KEY NOT NULL,
	`collectionId` text NOT NULL,
	`slug` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`data` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`collectionId`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entries_collection_slug_unique` ON `entries` (`collectionId`,`slug`);--> statement-breakpoint
CREATE INDEX `entries_collectionId_idx` ON `entries` (`collectionId`);--> statement-breakpoint
CREATE INDEX `entries_status_idx` ON `entries` (`status`);--> statement-breakpoint
CREATE TABLE `entry_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`entryId` text NOT NULL,
	`version` integer NOT NULL,
	`data` text,
	`createdBy` text,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`entryId`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entry_versions_entry_version_unique` ON `entry_versions` (`entryId`,`version`);--> statement-breakpoint
CREATE INDEX `entry_versions_entryId_idx` ON `entry_versions` (`entryId`);