ALTER TABLE `collections` ADD `tenantId` text NOT NULL DEFAULT 'global';
--> statement-breakpoint
DROP INDEX `collections_slug_unique`;
--> statement-breakpoint
CREATE UNIQUE INDEX `collections_tenant_slug_unique` ON `collections` (`tenantId`,`slug`);
--> statement-breakpoint
CREATE INDEX `collections_tenantId_idx` ON `collections` (`tenantId`);
