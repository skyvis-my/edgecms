ALTER TABLE `assets` ADD COLUMN `width` integer;
--> statement-breakpoint
ALTER TABLE `assets` ADD COLUMN `height` integer;
--> statement-breakpoint
ALTER TABLE `assets` ADD COLUMN `blurhash` text;
--> statement-breakpoint
ALTER TABLE `asset_variants` ADD COLUMN `file_size` integer;
