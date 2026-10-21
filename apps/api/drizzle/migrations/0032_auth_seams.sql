-- Auth seams (PRD HS-01, HS-11): two-factor auth, MFA-verified sessions,
-- per-tenant MFA requirement and single-use sign-up invites. Additive only.
ALTER TABLE `user` ADD COLUMN `twoFactorEnabled` integer DEFAULT false;
--> statement-breakpoint
ALTER TABLE `session` ADD COLUMN `mfaVerified` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `tenants` ADD COLUMN `requireMfa` integer DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `twoFactor` (
  `id` text PRIMARY KEY NOT NULL,
  `secret` text NOT NULL,
  `backupCodes` text NOT NULL,
  `userId` text NOT NULL,
  `verified` integer DEFAULT true,
  `failedVerificationCount` integer DEFAULT 0,
  `lockedUntil` integer,
  FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `two_factor_secret_idx` ON `twoFactor` (`secret`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `two_factor_user_id_idx` ON `twoFactor` (`userId`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `signup_invites` (
  `id` text PRIMARY KEY NOT NULL,
  `tokenHash` text NOT NULL,
  `email` text NOT NULL,
  `tenantId` text,
  `tenantRole` text,
  `createdBy` text,
  `expiresAt` integer NOT NULL,
  `usedAt` integer,
  `usedBy` text,
  `revoked` integer DEFAULT false NOT NULL,
  `createdAt` integer NOT NULL,
  FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`createdBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`usedBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `signup_invites_token_hash_unique` ON `signup_invites` (`tokenHash`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `signup_invites_email_idx` ON `signup_invites` (`email`);
