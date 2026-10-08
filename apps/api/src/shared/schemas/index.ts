/**
 * Barrel export for all shared EdgeCMS schemas.
 *
 * Usage:
 *   import { entry, type Entry, successResponse } from "@/shared/schemas";
 */

export type {
  ApiError,
  ApiResponse,
  ErrorResponse,
  ResponseMeta,
  SuccessResponse,
} from './api-response'
// API response envelope
export {
  apiError,
  apiResponse,
  errorResponse,
  responseMeta,
  successResponse,
} from './api-response'
export type {
  CollectionDefinition,
  FieldDefinition,
} from './collection-definition'
// Collection definitions
export { collectionDefinition, fieldDefinition } from './collection-definition'
export type {
  BulkUpdatePayload,
  CancelSchedulePayload,
  CommandEnvelope,
  CommandResult,
  CommandType,
  CreateEntryPayload,
  DeleteEntryPayload,
  LinkRelationPayload,
  PublishNowPayload,
  SchedulePublishPayload,
  ScheduleUnpublishPayload,
  TransactionPayload,
  UnlinkRelationPayload,
  UnpublishNowPayload,
  UpdateEntryPayload,
  UpdateSingletonPayload,
} from './commands'
// Commands
export {
  bulkUpdatePayload,
  cancelSchedulePayload,
  commandEnvelope,
  commandResult,
  commandType,
  createEntryPayload,
  deleteEntryPayload,
  linkRelationPayload,
  publishNowPayload,
  schedulePublishPayload,
  scheduleUnpublishPayload,
  transactionPayload,
  unlinkRelationPayload,
  unpublishNowPayload,
  updateEntryPayload,
  updateSingletonPayload,
} from './commands'
export type { Id, Slug, Timestamp } from './common'
// Common primitives
export { id, slug, timestamp } from './common'
export type { Entry, EntryStatus } from './entry'
// Content entries
export { entry, entryStatus } from './entry'
export type { FieldType } from './field-types'
// Field types
export { FIELD_TYPES, fieldType } from './field-types'
export type {
  ArrayFieldOptions,
  ColorFieldOptions,
  MediaFieldOptions,
  NumberFieldOptions,
  ReferenceFieldOptions,
  SlugFieldOptions,
  EmailFieldOptions,
  UrlFieldOptions,
  MarkdownFieldOptions,
  SelectFieldOptions,
  ShowWhenCondition,
  TextFieldOptions,
} from './field-options'
// Field options
export {
  arrayFieldOptions,
  colorFieldOptions,
  baseFieldOptions,
  mediaFieldOptions,
  numberFieldOptions,
  slugFieldOptions,
  emailFieldOptions,
  urlFieldOptions,
  markdownFieldOptions,
  referenceFieldOptions,
  selectFieldOptions,
  showWhenCondition,
  textFieldOptions,
} from './field-options'
export type { Locale, LocaleQueryParam, LocalizedValue } from './locale'
// Locales
export { locale, localeQueryParam, localizedValue } from './locale'
export type {
  CursorPaginationParams,
  OffsetPaginationParams,
  PaginationMeta,
} from './pagination'
// Pagination
export {
  cursorPaginationParams,
  offsetPaginationParams,
  paginationMeta,
} from './pagination'
export type { LinkRelationInput, Relation, RelationType, UnlinkRelationInput } from './relation'
// Relations
export { linkRelationInput, relation, relationType, unlinkRelationInput } from './relation'
export type {
  AddUserToTenantInput,
  CreateTenantInput,
  Tenant,
  TenantResources,
  TenantRole,
  TenantStatus,
  TenantUser,
  UpdateTenantInput,
} from './tenant'
// Tenants
export {
  addUserToTenantInput,
  createTenantInput,
  tenant,
  tenantResources,
  tenantRole,
  tenantStatus,
  tenantUser,
  updateTenantInput,
} from './tenant'
export type {
  DiffAction,
  EntryVersion,
  RollbackResponse,
  VersionDiffEntry,
  VersionListResponse,
} from './version'
// Versions
export {
  diffAction,
  entryVersion,
  rollbackResponse,
  versionDiffEntry,
  versionListResponse,
} from './version'
export type {
  CreateWebhookPayload,
  DeliveryStatus,
  RetryBackoff,
  RetryConfig,
  UpdateWebhookPayload,
  WebhookDelivery,
  WebhookEventPayload,
  WebhookEventType,
} from './webhook'
// Webhooks
export {
  createWebhookPayload,
  deliveryStatus,
  retryBackoff,
  retryConfig,
  updateWebhookPayload,
  webhookDelivery,
  webhookEventPayload,
  webhookEventType,
} from './webhook'
