import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const aiImportBatches = sqliteTable(
  'ai_import_batches',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().default('global'),
    createdByUserId: text('created_by_user_id').notNull(),
    status: text('status', {
      enum: ['draft', 'extracting', 'ready_for_review', 'failed', 'applied', 'cancelled'],
    })
      .notNull()
      .default('draft'),
    intent: text('intent').notNull(),
    targetCollectionSlug: text('target_collection_slug'),
    targetEntryId: text('target_entry_id'),
    sourceLocale: text('source_locale'),
    targetLocalesJson: text('target_locales_json', { mode: 'json' }).$type<string[]>(),
    sourceCount: integer('source_count').notNull().default(0),
    acceptedSuggestionCount: integer('accepted_suggestion_count').notNull().default(0),
    appliedCommandId: text('applied_command_id'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('ai_import_batches_tenant_created_idx').on(table.tenantId, table.createdAt),
    index('ai_import_batches_tenant_status_idx').on(table.tenantId, table.status),
  ]
)

export const aiImportSources = sqliteTable(
  'ai_import_sources',
  {
    id: text('id').primaryKey(),
    batchId: text('batch_id')
      .notNull()
      .references(() => aiImportBatches.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id').notNull().default('global'),
    kind: text('kind', { enum: ['text', 'file', 'asset'] }).notNull(),
    filename: text('filename'),
    contentType: text('content_type'),
    sizeBytes: integer('size_bytes'),
    r2ObjectKey: text('r2_object_key'),
    existingAssetId: text('existing_asset_id'),
    expiresAt: text('expires_at').notNull(),
    purgedAt: text('purged_at'),
    purgeAuditJson: text('purge_audit_json', { mode: 'json' }).$type<Record<string, unknown>>(),
    extractionStatus: text('extraction_status', {
      enum: ['pending', 'ready', 'failed', 'unsupported'],
    })
      .notNull()
      .default('pending'),
    extractedText: text('extracted_text'),
    mediaSummaryJson: text('media_summary_json', { mode: 'json' }).$type<Record<string, unknown>>(),
    hash: text('hash'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('ai_import_sources_tenant_batch_idx').on(table.tenantId, table.batchId),
    index('ai_import_sources_tenant_hash_idx').on(table.tenantId, table.hash),
  ]
)

export const aiSuggestionSets = sqliteTable(
  'ai_suggestion_sets',
  {
    id: text('id').primaryKey(),
    batchId: text('batch_id')
      .notNull()
      .references(() => aiImportBatches.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id').notNull().default('global'),
    status: text('status', { enum: ['generating', 'ready', 'failed', 'dry_run_ready', 'applied'] })
      .notNull()
      .default('generating'),
    model: text('model'),
    promptHash: text('prompt_hash'),
    dryRunHash: text('dry_run_hash'),
    dryRunPayloadJson: text('dry_run_payload_json', { mode: 'json' }).$type<unknown[]>(),
    dryRunResultJson: text('dry_run_result_json', { mode: 'json' }).$type<unknown[]>(),
    commandResultJson: text('command_result_json', { mode: 'json' }).$type<unknown[]>(),
    warningsJson: text('warnings_json', { mode: 'json' }).$type<string[]>(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('ai_suggestion_sets_tenant_batch_idx').on(table.tenantId, table.batchId),
    index('ai_suggestion_sets_tenant_status_idx').on(table.tenantId, table.status),
  ]
)

export const aiSuggestions = sqliteTable(
  'ai_suggestions',
  {
    id: text('id').primaryKey(),
    suggestionSetId: text('suggestion_set_id')
      .notNull()
      .references(() => aiSuggestionSets.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id').notNull().default('global'),
    status: text('status', { enum: ['pending', 'accepted', 'rejected', 'warning'] })
      .notNull()
      .default('pending'),
    operation: text('operation', { enum: ['create_entry', 'update_entry', 'manual'] }).notNull(),
    targetCollectionId: text('target_collection_id'),
    targetCollectionSlug: text('target_collection_slug'),
    targetEntryId: text('target_entry_id'),
    fieldPath: text('field_path'),
    locale: text('locale'),
    sourceLocale: text('source_locale'),
    suggestedValueJson: text('suggested_value_json', { mode: 'json' }).$type<unknown>(),
    editedValueJson: text('edited_value_json', { mode: 'json' }).$type<unknown>(),
    confidence: integer('confidence').notNull().default(0),
    citationsJson: text('citations_json', { mode: 'json' }).$type<unknown[]>(),
    warning: text('warning'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('ai_suggestions_tenant_set_idx').on(table.tenantId, table.suggestionSetId),
    index('ai_suggestions_tenant_status_idx').on(table.tenantId, table.status),
  ]
)

export const aiToolInvocations = sqliteTable(
  'ai_tool_invocations',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().default('global'),
    batchId: text('batch_id'),
    suggestionSetId: text('suggestion_set_id'),
    toolName: text('tool_name').notNull(),
    inputJson: text('input_json', { mode: 'json' }).$type<Record<string, unknown>>(),
    inputHash: text('input_hash'),
    resultCount: integer('result_count').notNull().default(0),
    status: text('status', { enum: ['success', 'failed', 'timeout'] }).notNull(),
    durationMs: integer('duration_ms').notNull().default(0),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('ai_tool_invocations_tenant_batch_idx').on(table.tenantId, table.batchId),
    index('ai_tool_invocations_tenant_tool_idx').on(table.tenantId, table.toolName),
  ]
)
