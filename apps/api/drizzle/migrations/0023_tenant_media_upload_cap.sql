ALTER TABLE `tenants` ADD `mediaUploadMaxBytes` integer NOT NULL DEFAULT 5242880;
ALTER TABLE `tenants` ADD `mediaUploadMaxDimension` integer NOT NULL DEFAULT 2048;
