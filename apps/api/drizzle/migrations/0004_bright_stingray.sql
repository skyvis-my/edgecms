CREATE TABLE `cache_tags` (
	`id` text PRIMARY KEY NOT NULL,
	`tag` text NOT NULL,
	`snapshotKey` text NOT NULL,
	`createdAt` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cache_tags_tag_idx` ON `cache_tags` (`tag`);--> statement-breakpoint
CREATE INDEX `cache_tags_snapshot_key_idx` ON `cache_tags` (`snapshotKey`);