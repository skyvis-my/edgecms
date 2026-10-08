CREATE TABLE `ai_import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text DEFAULT 'global' NOT NULL,
	`created_by_user_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`intent` text NOT NULL,
	`target_collection_slug` text,
	`target_entry_id` text,
	`source_locale` text,
	`target_locales_json` text,
	`source_count` integer DEFAULT 0 NOT NULL,
	`accepted_suggestion_count` integer DEFAULT 0 NOT NULL,
	`applied_command_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
CREATE INDEX `ai_import_batches_tenant_created_idx` ON `ai_import_batches` (`tenant_id`,`created_at`);
CREATE INDEX `ai_import_batches_tenant_status_idx` ON `ai_import_batches` (`tenant_id`,`status`);

CREATE TABLE `ai_import_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`tenant_id` text DEFAULT 'global' NOT NULL,
	`kind` text NOT NULL,
	`filename` text,
	`content_type` text,
	`size_bytes` integer,
	`r2_object_key` text,
	`existing_asset_id` text,
	`expires_at` text NOT NULL,
	`purged_at` text,
	`purge_audit_json` text,
	`extraction_status` text DEFAULT 'pending' NOT NULL,
	`extracted_text` text,
	`media_summary_json` text,
	`hash` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `ai_import_batches`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `ai_import_sources_tenant_batch_idx` ON `ai_import_sources` (`tenant_id`,`batch_id`);
CREATE INDEX `ai_import_sources_tenant_hash_idx` ON `ai_import_sources` (`tenant_id`,`hash`);

CREATE TABLE `ai_suggestion_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`tenant_id` text DEFAULT 'global' NOT NULL,
	`status` text DEFAULT 'generating' NOT NULL,
	`model` text,
	`prompt_hash` text,
	`dry_run_hash` text,
	`dry_run_payload_json` text,
	`dry_run_result_json` text,
	`command_result_json` text,
	`warnings_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `ai_import_batches`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `ai_suggestion_sets_tenant_batch_idx` ON `ai_suggestion_sets` (`tenant_id`,`batch_id`);
CREATE INDEX `ai_suggestion_sets_tenant_status_idx` ON `ai_suggestion_sets` (`tenant_id`,`status`);

CREATE TABLE `ai_suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`suggestion_set_id` text NOT NULL,
	`tenant_id` text DEFAULT 'global' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`operation` text NOT NULL,
	`target_collection_id` text,
	`target_collection_slug` text,
	`target_entry_id` text,
	`field_path` text,
	`locale` text,
	`source_locale` text,
	`suggested_value_json` text,
	`edited_value_json` text,
	`confidence` integer DEFAULT 0 NOT NULL,
	`citations_json` text,
	`warning` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`suggestion_set_id`) REFERENCES `ai_suggestion_sets`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `ai_suggestions_tenant_set_idx` ON `ai_suggestions` (`tenant_id`,`suggestion_set_id`);
CREATE INDEX `ai_suggestions_tenant_status_idx` ON `ai_suggestions` (`tenant_id`,`status`);

CREATE TABLE `ai_tool_invocations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text DEFAULT 'global' NOT NULL,
	`batch_id` text,
	`suggestion_set_id` text,
	`tool_name` text NOT NULL,
	`input_json` text,
	`input_hash` text,
	`result_count` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
CREATE INDEX `ai_tool_invocations_tenant_batch_idx` ON `ai_tool_invocations` (`tenant_id`,`batch_id`);
CREATE INDEX `ai_tool_invocations_tenant_tool_idx` ON `ai_tool_invocations` (`tenant_id`,`tool_name`);
