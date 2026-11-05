import { and, asc, eq, inArray } from 'drizzle-orm'
import type { CommandEnvelope, CommandResult } from '@edgecms/schemas/commands'
import {
  createPreviewReceipt,
  previewReceiptErrorStatus,
  redeemPreviewReceipt,
  sha256Hex,
  type PreviewReceiptErrorCode,
} from '@/ai/preview-receipt.service'
import { canAccessCollectionSlug, type ContentAccess, type ContentAction } from '@/auth/content-access'
import { executeCommand, type CommandContext, type CommandHostHooks } from '@/commands/engine'
import type { Database } from '@/database/db'
import { entries, relations } from '@/database/schema'
import { entriesRepository, type EntryRow } from '@/entries/entries.repository'
import { validateEntryFieldData, validateLocalizedFields } from '@/entries/entries.service'
import type { Env } from '@/env'
import { entryStatuses, isEntryStatus } from '@/shared/schemas/entry'
import { slugify } from '@/shared/utils/slugify'
import { collectionsRepository, type CollectionRow } from './collections.repository'

/**
 * OP-06: per-collection export and non-destructive import.
 *
 * Export writes one JSON document per collection: the schema (with a hash),
 * every entry (localized values stay inside `data`) and its relations, keyed
 * by collection and entry slug so the file is portable between tenants.
 *
 * Import is two calls. Preview builds a per-entry plan, dry-runs the
 * concrete commands through the command engine and mints a preview receipt
 * (AI-05) bound to the actor, the tenant and the hash of the whole plan.
 * Nothing is written. Execute rebuilds the plan from the same file and
 * current state, redeems the receipt only if the plan hashes the same, and
 * runs the plan as two command transactions: entry creates and updates,
 * then relation links and publishes (which need the new entry ids).
 */

export const COLLECTION_EXPORT_FORMAT = 'edgecms.collection-export'
export const COLLECTION_EXPORT_FORMAT_VERSION = 1

export const MAX_EXPORT_ENTRIES = 1000
export const MAX_IMPORT_ENTRIES = 500
export const MAX_IMPORT_RELATIONS = 2000

/** Placeholder for an entry this import creates; never a valid entry id. */
const NEW_ENTRY_REF = '$import:'
const ID_CHUNK = 100
const RELATION_TYPES = new Set(['one-to-one', 'one-to-many', 'many-to-many'])

// ============================================================================
// Types
// ============================================================================

export type CollectionExportEntry = {
  slug: string
  status: string
  data: Record<string, unknown>
}

export type CollectionExportRelation = {
  sourceSlug: string
  fieldName: string
  relationType: string
  sortOrder: number
  target: { collectionSlug: string; slug: string }
}

export type CollectionExportField = {
  name: string
  type: string
  required: boolean
  localizable: boolean
  options?: Record<string, unknown>
}

export type CollectionExportDocument = {
  format: typeof COLLECTION_EXPORT_FORMAT
  formatVersion: typeof COLLECTION_EXPORT_FORMAT_VERSION
  exportedAt: string
  collection: {
    slug: string
    name: string
    singleton: boolean
    defaultLocale: string
    supportedLocales: string[]
    fields: CollectionExportField[]
    /** SHA-256 of the canonical schema; compared on import. */
    schemaHash: string
  }
  entries: CollectionExportEntry[]
  relations: CollectionExportRelation[]
  /** Present when relations were left out because the caller cannot read their target collection. */
  omitted?: { relations: number }
}

export type ImportStrategy = 'skip' | 'update'

export type EntryPlanAction = 'create' | 'update' | 'skip' | 'conflict' | 'invalid'

export type EntryPlanItem = {
  index: number
  slug: string
  action: EntryPlanAction
  reason: string
  entryId?: string
  /** Status the entry is created with (published entries are created as drafts, then published). */
  status?: string
  publish?: boolean
  changedFields?: string[]
  validationErrors?: string[]
  warnings?: string[]
}

export type RelationPlanItem = {
  index: number
  sourceSlug: string
  fieldName: string
  target: { collectionSlug: string; slug: string }
  action: 'link' | 'skip' | 'conflict'
  reason: string
}

export type ImportSummary = Record<EntryPlanAction, number>

export type ImportPreview = {
  collection: { id: string; slug: string }
  strategy: ImportStrategy
  summary: ImportSummary
  entries: EntryPlanItem[]
  relations: RelationPlanItem[]
  warnings: string[]
  commandCount: number
  /** Combined dry-run diff from the command engine for commands that need no new ids. */
  diff: Array<Record<string, unknown>>
  /** Absent when the plan has nothing to run. */
  previewReceipt?: string
  expiresAt?: string
}

export type ImportOutcome = 'success' | 'failed' | 'not_run'

export type ImportExecution = {
  status: 'applied' | 'partial_failure' | 'nothing_to_do'
  collection: { id: string; slug: string }
  entries: Array<EntryPlanItem & { outcome?: ImportOutcome; publishOutcome?: ImportOutcome; error?: string }>
  relations: Array<RelationPlanItem & { outcome?: ImportOutcome; error?: string }>
  warnings: string[]
  commandIds: string[]
}

export type TransferError = {
  code: string
  message: string
  /** Typed preview receipt rejection, e.g. `HASH_MISMATCH`. */
  reason?: string
  /** Suggested HTTP status. */
  status?: number
}

export type TransferResult<T> = { success: true; data: T } | { success: false; error: TransferError }

export type TransferContext = {
  db: Database
  tenantId: string
  actor: { userId: string }
  kv?: KVNamespace
  env?: Env
  /** PL-03 per-collection access; absent for callers the request guard did not scope. */
  contentAccess?: ContentAccess
  hostHooks?: CommandHostHooks
  executionCtx?: CommandContext['executionCtx']
  requestMeta?: CommandContext['requestMeta']
}

export type ImportInput = {
  document: unknown
  strategy?: ImportStrategy
}

// ============================================================================
// Helpers
// ============================================================================

function fail<T>(code: string, message: string, extra: Partial<TransferError> = {}): TransferResult<T> {
  return { success: false, error: { code, message, ...extra } }
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(',')}}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function chunks<T>(items: T[], size = ID_CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function denied(access: ContentAccess | undefined, action: ContentAction, slug: string): boolean {
  return access !== undefined && !canAccessCollectionSlug(access, action, slug)
}

function relationFieldNames(collection: CollectionRow): Set<string> {
  return new Set(collection.fields.filter((f) => f.type === 'relation').map((f) => f.name))
}

function exportFields(collection: CollectionRow): CollectionExportField[] {
  return collection.fields.map((f) => ({
    name: f.name,
    type: f.type,
    required: Boolean(f.required),
    localizable: Boolean(f.localizable),
    ...(f.options ? { options: f.options } : {}),
  }))
}

async function schemaHash(collection: CollectionRow): Promise<string> {
  return sha256Hex(
    canonical({
      fields: exportFields(collection),
      defaultLocale: collection.defaultLocale,
      supportedLocales: collection.supportedLocales,
      singleton: Boolean(collection.singleton),
    })
  )
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

async function entriesBySlug(
  db: Database,
  collectionId: string,
  slugs: string[]
): Promise<Map<string, EntryRow>> {
  const found = new Map<string, EntryRow>()
  for (const chunk of chunks([...new Set(slugs)])) {
    const rows = await db
      .select()
      .from(entries)
      .where(and(eq(entries.collectionId, collectionId), inArray(entries.slug, chunk)))
    for (const row of rows) found.set(row.slug, row)
  }
  return found
}

// ============================================================================
// Export
// ============================================================================

async function exportCollection(
  ctx: TransferContext,
  collectionSlug: string
): Promise<TransferResult<CollectionExportDocument>> {
  if (denied(ctx.contentAccess, 'read', collectionSlug)) {
    return fail('FORBIDDEN', 'Your role cannot read entries in this collection')
  }
  const collection = await collectionsRepository.findBySlug(ctx.db, collectionSlug, ctx.tenantId)
  if (!collection) return fail('NOT_FOUND', `Collection '${collectionSlug}' not found`)

  // The collection was resolved in this tenant, so its entries are too.
  const rows = await ctx.db
    .select()
    .from(entries)
    .where(eq(entries.collectionId, collection.id))
    .orderBy(asc(entries.slug))
    .limit(MAX_EXPORT_ENTRIES + 1)
  if (rows.length > MAX_EXPORT_ENTRIES) {
    return fail(
      'EXPORT_TOO_LARGE',
      `Collection has more than ${MAX_EXPORT_ENTRIES} entries; export is limited to ${MAX_EXPORT_ENTRIES}`,
      { status: 413 }
    )
  }

  const relationFields = relationFieldNames(collection)
  const exportedEntries: CollectionExportEntry[] = rows.map((row) => ({
    slug: row.slug,
    status: row.status,
    // Relation values hold this tenant's entry ids; they travel as slugs in `relations`.
    data: Object.fromEntries(Object.entries(row.data ?? {}).filter(([key]) => !relationFields.has(key))),
  }))

  const slugById = new Map(rows.map((row) => [row.id, row.slug]))
  const relationRows = await ctx.db
    .select()
    .from(relations)
    .where(and(eq(relations.sourceCollectionId, collection.id), eq(relations.tenantId, ctx.tenantId)))

  const targetIds = [...new Set(relationRows.map((r) => r.targetEntryId))]
  const targets = new Map<string, EntryRow>()
  for (const chunk of chunks(targetIds)) {
    for (const row of await entriesRepository.findByIds(ctx.db, chunk, ctx.tenantId)) targets.set(row.id, row)
  }
  const targetCollectionIds = [...new Set([...targets.values()].map((row) => row.collectionId))]
  const collectionSlugs = new Map<string, string>()
  for (const chunk of chunks(targetCollectionIds)) {
    for (const row of await collectionsRepository.findByIds(ctx.db, chunk, ctx.tenantId)) {
      collectionSlugs.set(row.id, row.slug)
    }
  }

  let omitted = 0
  const exportedRelations: CollectionExportRelation[] = []
  for (const relation of relationRows) {
    const sourceSlug = slugById.get(relation.sourceEntryId)
    const target = targets.get(relation.targetEntryId)
    const targetCollectionSlug = target ? collectionSlugs.get(target.collectionId) : undefined
    if (!sourceSlug || !target || !targetCollectionSlug) continue
    if (denied(ctx.contentAccess, 'read', targetCollectionSlug)) {
      omitted++
      continue
    }
    exportedRelations.push({
      sourceSlug,
      fieldName: relation.fieldName,
      relationType: relation.relationType,
      sortOrder: relation.sortOrder,
      target: { collectionSlug: targetCollectionSlug, slug: target.slug },
    })
  }
  exportedRelations.sort(
    (a, b) =>
      compareStrings(a.sourceSlug, b.sourceSlug) ||
      compareStrings(a.fieldName, b.fieldName) ||
      a.sortOrder - b.sortOrder ||
      compareStrings(a.target.collectionSlug, b.target.collectionSlug) ||
      compareStrings(a.target.slug, b.target.slug)
  )

  return {
    success: true,
    data: {
      format: COLLECTION_EXPORT_FORMAT,
      formatVersion: COLLECTION_EXPORT_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      collection: {
        slug: collection.slug,
        name: collection.name,
        singleton: Boolean(collection.singleton),
        defaultLocale: collection.defaultLocale,
        supportedLocales: collection.supportedLocales,
        fields: exportFields(collection),
        schemaHash: await schemaHash(collection),
      },
      entries: exportedEntries,
      relations: exportedRelations,
      ...(omitted > 0 ? { omitted: { relations: omitted } } : {}),
    },
  }
}

// ============================================================================
// Document validation
// ============================================================================

function parseDocument(input: unknown): TransferResult<CollectionExportDocument> {
  const invalid = (message: string) => fail<CollectionExportDocument>('INVALID_EXPORT', message)
  if (!isRecord(input)) return invalid('Import document must be a JSON object')
  if (input.format !== COLLECTION_EXPORT_FORMAT) {
    return invalid(`Import document format must be '${COLLECTION_EXPORT_FORMAT}'`)
  }
  if (input.formatVersion !== COLLECTION_EXPORT_FORMAT_VERSION) {
    return invalid(`Unsupported formatVersion; expected ${COLLECTION_EXPORT_FORMAT_VERSION}`)
  }
  const collection = input.collection
  if (!isRecord(collection) || typeof collection.slug !== 'string' || !Array.isArray(collection.fields)) {
    return invalid('collection must have a slug and fields')
  }
  if (!Array.isArray(input.entries)) return invalid('entries must be an array')
  if (input.entries.length > MAX_IMPORT_ENTRIES) {
    return invalid(`An import may contain at most ${MAX_IMPORT_ENTRIES} entries`)
  }
  for (const [i, entry] of input.entries.entries()) {
    if (!isRecord(entry) || typeof entry.slug !== 'string' || typeof entry.status !== 'string' || !isRecord(entry.data)) {
      return invalid(`entries[${i}] must have a string slug, a string status and a data object`)
    }
  }
  const relationList = input.relations ?? []
  if (!Array.isArray(relationList)) return invalid('relations must be an array')
  if (relationList.length > MAX_IMPORT_RELATIONS) {
    return invalid(`An import may contain at most ${MAX_IMPORT_RELATIONS} relations`)
  }
  for (const [i, relation] of relationList.entries()) {
    if (
      !isRecord(relation) ||
      typeof relation.sourceSlug !== 'string' ||
      typeof relation.fieldName !== 'string' ||
      typeof relation.relationType !== 'string' ||
      (relation.sortOrder !== undefined && typeof relation.sortOrder !== 'number') ||
      !isRecord(relation.target) ||
      typeof relation.target.collectionSlug !== 'string' ||
      typeof relation.target.slug !== 'string'
    ) {
      return invalid(`relations[${i}] must have sourceSlug, fieldName, relationType and target {collectionSlug, slug}`)
    }
  }
  return {
    success: true,
    data: { ...(input as unknown as CollectionExportDocument), relations: relationList as CollectionExportRelation[] },
  }
}

// ============================================================================
// Planning
// ============================================================================

type PlannedCommand = {
  phase: 1 | 2
  kind: 'entry' | 'relation' | 'publish'
  itemIndex: number
  type: CommandEnvelope['type']
  payload: Record<string, unknown>
  optimisticVersion?: number
}

type ImportPlan = {
  collection: CollectionRow
  strategy: ImportStrategy
  entries: EntryPlanItem[]
  relations: RelationPlanItem[]
  warnings: string[]
  commands: PlannedCommand[]
}

function validateEntryData(
  data: Record<string, unknown>,
  collection: CollectionRow,
  isCreate: boolean
): string[] {
  const errors: string[] = []
  const fieldNames = new Set(collection.fields.map((f) => f.name))
  const relationFields = relationFieldNames(collection)
  for (const key of Object.keys(data)) {
    if (!fieldNames.has(key)) errors.push(`Field '${key}' is not defined on the target collection`)
    else if (relationFields.has(key)) {
      errors.push(`Relation field '${key}' must be given in relations, not in data`)
    }
  }
  const localized = validateLocalizedFields(data, collection.fields, collection.supportedLocales)
  if (!localized.valid) errors.push(localized.error)
  const fields = validateEntryFieldData(data, collection.fields, isCreate)
  if (!fields.valid && !errors.includes(fields.error)) errors.push(fields.error)
  return errors
}

async function buildPlan(
  ctx: TransferContext,
  collectionSlug: string,
  input: ImportInput
): Promise<TransferResult<ImportPlan>> {
  const strategy: ImportStrategy = input.strategy ?? 'skip'
  if (strategy !== 'skip' && strategy !== 'update') {
    return fail('VALIDATION_ERROR', "strategy must be 'skip' or 'update'")
  }
  const parsed = parseDocument(input.document)
  if (!parsed.success) return parsed
  const doc = parsed.data

  // Matching by slug reveals which entries exist, so preview needs read access.
  if (denied(ctx.contentAccess, 'read', collectionSlug)) {
    return fail('FORBIDDEN', 'Your role cannot read entries in this collection')
  }
  const collection = await collectionsRepository.findBySlug(ctx.db, collectionSlug, ctx.tenantId)
  if (!collection) return fail('NOT_FOUND', `Collection '${collectionSlug}' not found`)

  const warnings: string[] = []
  if (doc.collection.slug !== collection.slug) {
    warnings.push(`File was exported from collection '${doc.collection.slug}'; importing into '${collection.slug}'`)
  }
  if (typeof doc.collection.schemaHash === 'string' && doc.collection.schemaHash !== (await schemaHash(collection))) {
    warnings.push('SCHEMA_HASH_MISMATCH: the target collection schema differs from the exported schema')
  }
  const targetFields = new Map(collection.fields.map((f) => [f.name, f]))
  for (const field of doc.collection.fields as CollectionExportField[]) {
    const target = targetFields.get(field?.name)
    if (!target) warnings.push(`Field '${field?.name}' is not defined on the target collection`)
    else if (target.type !== field.type) {
      warnings.push(`Field '${field.name}' is '${field.type}' in the file and '${target.type}' in the target`)
    }
  }

  const relationTargetSlugs = doc.relations
    .filter((r) => r.target.collectionSlug === doc.collection.slug)
    .map((r) => r.target.slug)
  const existing = await entriesBySlug(ctx.db, collection.id, [
    ...doc.entries.map((e) => e.slug),
    ...relationTargetSlugs,
  ])

  // ---- Entries ------------------------------------------------------------
  const entryItems: EntryPlanItem[] = []
  const commands: PlannedCommand[] = []
  const firstBySlug = new Map<string, EntryPlanItem>()

  for (const [index, entry] of doc.entries.entries()) {
    const item: EntryPlanItem = { index, slug: entry.slug, action: 'invalid', reason: 'VALIDATION_FAILED' }
    entryItems.push(item)

    if (entry.slug.length === 0 || slugify(entry.slug) !== entry.slug) {
      item.reason = 'INVALID_SLUG'
      item.validationErrors = [`Slug '${entry.slug}' is not a normalized slug`]
      continue
    }
    if (firstBySlug.has(entry.slug)) {
      item.action = 'conflict'
      item.reason = 'DUPLICATE_SLUG_IN_FILE'
      continue
    }
    firstBySlug.set(entry.slug, item)
    if (!isEntryStatus(entry.status)) {
      item.validationErrors = [`Invalid status '${entry.status}'. Valid values: ${entryStatuses.join(', ')}`]
      continue
    }

    const current = existing.get(entry.slug)
    const errors = validateEntryData(entry.data, collection, !current)
    if (errors.length > 0) {
      item.validationErrors = errors
      continue
    }

    if (current) {
      item.entryId = current.id
      const currentData = current.data ?? {}
      const changedFields = Object.keys(entry.data)
        .filter((key) => canonical(currentData[key]) !== canonical(entry.data[key]))
        .sort()
      if (changedFields.length === 0) {
        item.action = 'skip'
        item.reason = 'UNCHANGED'
        if (current.status !== entry.status) {
          item.warnings = [`Status is '${current.status}' here and '${entry.status}' in the file; status is not changed`]
        }
        continue
      }
      item.changedFields = changedFields
      if (strategy === 'skip') {
        item.action = 'conflict'
        item.reason = 'EXISTS_WITH_DIFFERENT_CONTENT'
        continue
      }
      item.action = 'update'
      item.reason = 'UPDATE_REQUESTED'
      // Non-destructive: fields the file does not mention are kept.
      commands.push({
        phase: 1,
        kind: 'entry',
        itemIndex: index,
        type: 'updateEntry',
        payload: { entryId: current.id, data: { ...currentData, ...entry.data } },
        optimisticVersion: current.version,
      })
      continue
    }

    item.action = 'create'
    item.reason = 'NEW_ENTRY'
    item.status = entry.status === 'archived' ? 'archived' : 'draft'
    item.publish = entry.status === 'published'
    if (entry.status === 'scheduled') {
      item.warnings = ['Scheduled entries are imported as drafts; schedules are not imported']
    }
    commands.push({
      phase: 1,
      kind: 'entry',
      itemIndex: index,
      type: 'createEntry',
      payload: { collectionId: collection.id, slug: entry.slug, status: item.status, data: entry.data },
    })
  }

  // ---- Relations ----------------------------------------------------------
  const refForSlug = (slug: string): string | undefined => {
    const item = firstBySlug.get(slug)
    if (item?.action === 'create') return `${NEW_ENTRY_REF}${slug}`
    return existing.get(slug)?.id
  }

  const otherCollections = new Map<string, CollectionRow | null>()
  const otherSlugs = new Map<string, Set<string>>()
  for (const relation of doc.relations) {
    const slug = relation.target.collectionSlug
    if (slug === doc.collection.slug || denied(ctx.contentAccess, 'read', slug)) continue
    if (!otherSlugs.has(slug)) otherSlugs.set(slug, new Set())
    otherSlugs.get(slug)?.add(relation.target.slug)
  }
  const otherEntries = new Map<string, Map<string, EntryRow>>()
  for (const [slug, targetSlugs] of otherSlugs) {
    const row = (await collectionsRepository.findBySlug(ctx.db, slug, ctx.tenantId)) ?? null
    otherCollections.set(slug, row)
    if (row) otherEntries.set(slug, await entriesBySlug(ctx.db, row.id, [...targetSlugs]))
  }

  const existingSourceIds = [...firstBySlug.values()]
    .filter((item) => item.action === 'update' || item.action === 'skip')
    .map((item) => item.entryId as string)
  const existingLinks = new Set<string>()
  const linkedOneToOne = new Set<string>()
  for (const chunk of chunks(existingSourceIds)) {
    const rows = await ctx.db
      .select()
      .from(relations)
      .where(and(inArray(relations.sourceEntryId, chunk), eq(relations.tenantId, ctx.tenantId)))
    for (const row of rows) {
      existingLinks.add(`${row.sourceEntryId}|${row.fieldName}|${row.targetEntryId}`)
      linkedOneToOne.add(`${row.sourceEntryId}|${row.fieldName}`)
    }
  }

  const relationItems: RelationPlanItem[] = []
  const plannedLinks = new Set<string>()
  for (const [index, relation] of doc.relations.entries()) {
    const item: RelationPlanItem = {
      index,
      sourceSlug: relation.sourceSlug,
      fieldName: relation.fieldName,
      target: { collectionSlug: relation.target.collectionSlug, slug: relation.target.slug },
      action: 'conflict',
      reason: '',
    }
    relationItems.push(item)

    const source = firstBySlug.get(relation.sourceSlug)
    if (!source || !['create', 'update', 'skip'].includes(source.action)) {
      item.action = 'skip'
      item.reason = 'SOURCE_NOT_IMPORTED'
      continue
    }
    const field = targetFields.get(relation.fieldName)
    if (!field || field.type !== 'relation') {
      item.reason = 'FIELD_NOT_RELATION'
      continue
    }
    if (!RELATION_TYPES.has(relation.relationType)) {
      item.reason = 'INVALID_RELATION_TYPE'
      continue
    }

    let targetCollectionId: string
    let targetRef: string | undefined
    if (relation.target.collectionSlug === doc.collection.slug) {
      targetCollectionId = collection.id
      targetRef = refForSlug(relation.target.slug)
    } else if (denied(ctx.contentAccess, 'read', relation.target.collectionSlug)) {
      item.reason = 'TARGET_NOT_READABLE'
      continue
    } else {
      const targetCollection = otherCollections.get(relation.target.collectionSlug)
      if (!targetCollection) {
        item.reason = 'TARGET_COLLECTION_NOT_FOUND'
        continue
      }
      targetCollectionId = targetCollection.id
      targetRef = otherEntries.get(relation.target.collectionSlug)?.get(relation.target.slug)?.id
    }
    if (!targetRef) {
      item.reason = 'TARGET_NOT_FOUND'
      continue
    }

    const sourceRef = source.action === 'create' ? `${NEW_ENTRY_REF}${source.slug}` : (source.entryId as string)
    const linkKey = `${sourceRef}|${relation.fieldName}|${targetRef}`
    if (existingLinks.has(linkKey)) {
      item.action = 'skip'
      item.reason = 'ALREADY_LINKED'
      continue
    }
    if (plannedLinks.has(linkKey)) {
      item.action = 'skip'
      item.reason = 'DUPLICATE_IN_FILE'
      continue
    }
    const fieldKey = `${sourceRef}|${relation.fieldName}`
    if (relation.relationType === 'one-to-one' && linkedOneToOne.has(fieldKey)) {
      item.reason = 'ONE_TO_ONE_TAKEN'
      continue
    }

    plannedLinks.add(linkKey)
    linkedOneToOne.add(fieldKey)
    item.action = 'link'
    item.reason = 'NEW_RELATION'
    commands.push({
      phase: 2,
      kind: 'relation',
      itemIndex: index,
      type: 'linkRelation',
      payload: {
        sourceEntryId: sourceRef,
        targetEntryId: targetRef,
        sourceCollectionId: collection.id,
        targetCollectionId,
        relationType: relation.relationType,
        fieldName: relation.fieldName,
        sortOrder: relation.sortOrder ?? 0,
      },
    })
  }

  for (const item of entryItems) {
    if (item.action === 'create' && item.publish) {
      commands.push({
        phase: 2,
        kind: 'publish',
        itemIndex: item.index,
        type: 'publishNow',
        payload: { entryId: `${NEW_ENTRY_REF}${item.slug}` },
      })
    }
  }

  // PL-03: the caller needs every content action the plan uses.
  const needed = new Set<ContentAction>()
  for (const command of commands) {
    if (command.type === 'createEntry') needed.add('create')
    if (command.type === 'updateEntry' || command.type === 'linkRelation') needed.add('update')
    if (command.type === 'publishNow') needed.add('publish')
  }
  for (const action of needed) {
    if (denied(ctx.contentAccess, action, collection.slug)) {
      return fail('FORBIDDEN', `This import needs '${action}' access to entries in '${collection.slug}'`)
    }
  }

  return {
    success: true,
    data: { collection, strategy, entries: entryItems, relations: relationItems, warnings, commands },
  }
}

function summarize(items: EntryPlanItem[]): ImportSummary {
  const summary: ImportSummary = { create: 0, update: 0, skip: 0, conflict: 0, invalid: 0 }
  for (const item of items) summary[item.action]++
  return summary
}

function hasNewEntryRef(value: unknown): boolean {
  if (typeof value === 'string') return value.startsWith(NEW_ENTRY_REF)
  if (Array.isArray(value)) return value.some(hasNewEntryRef)
  if (isRecord(value)) return Object.values(value).some(hasNewEntryRef)
  return false
}

function resolveNewEntryRefs(payload: Record<string, unknown>, ids: Map<string, string>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(payload).map(([key, value]) => [
      key,
      typeof value === 'string' && value.startsWith(NEW_ENTRY_REF) ? (ids.get(value) ?? value) : value,
    ])
  )
}

function envelope(
  command: Pick<PlannedCommand, 'type' | 'payload' | 'optimisticVersion'>,
  userId: string,
  dryRun = false
): CommandEnvelope {
  return {
    type: command.type,
    payload: command.payload,
    actor: { userId, source: 'admin' },
    ...(command.optimisticVersion !== undefined ? { optimisticVersion: command.optimisticVersion } : {}),
    ...(dryRun ? { dryRun: true } : {}),
    timestamp: new Date().toISOString(),
  }
}

/**
 * The single envelope the preview receipt covers: the whole plan, in order,
 * without timestamps. Its hash changes whenever the file, the strategy, the
 * actor or the relevant tenant state changes the plan.
 */
function receiptEnvelope(plan: ImportPlan, userId: string): CommandEnvelope {
  return {
    type: 'transaction',
    payload: {
      kind: 'collection-import',
      collectionId: plan.collection.id,
      strategy: plan.strategy,
      commands: plan.commands.map((c) => ({
        phase: c.phase,
        type: c.type,
        payload: c.payload,
        ...(c.optimisticVersion !== undefined ? { optimisticVersion: c.optimisticVersion } : {}),
      })),
    },
    actor: { userId, source: 'admin' },
    timestamp: new Date(0).toISOString(),
  }
}

function commandContext(ctx: TransferContext, withHostHooks: boolean): CommandContext {
  return {
    db: ctx.db,
    kv: ctx.kv,
    env: ctx.env,
    actor: { userId: ctx.actor.userId, source: 'admin' },
    tenantScope: ctx.tenantId,
    syncChannel: ctx.tenantId,
    contentAccess: ctx.contentAccess,
    executionCtx: ctx.executionCtx,
    requestMeta: ctx.requestMeta,
    ...(withHostHooks && ctx.hostHooks ? { hostHooks: ctx.hostHooks } : {}),
  }
}

function transactionOf(commands: CommandEnvelope[], userId: string, dryRun = false): CommandEnvelope {
  return {
    type: 'transaction',
    payload: { commands },
    actor: { userId, source: 'admin' },
    ...(dryRun ? { dryRun: true } : {}),
    timestamp: new Date().toISOString(),
  }
}

function engineFailure(result: CommandResult): TransferError {
  const sub = ((result.data?.subResults ?? []) as CommandResult[]).find((r) => r.status === 'failed')
  const error = sub?.error ?? result.error
  return {
    code: error?.code === 'FORBIDDEN' ? 'FORBIDDEN' : 'DRY_RUN_FAILED',
    message: error?.message ?? 'Import dry run failed',
  }
}

// ============================================================================
// Preview
// ============================================================================

async function previewImport(
  ctx: TransferContext,
  collectionSlug: string,
  input: ImportInput
): Promise<TransferResult<ImportPreview>> {
  const planned = await buildPlan(ctx, collectionSlug, input)
  if (!planned.success) return planned
  const plan = planned.data

  // P3: dry-run the commands that need no new ids through the engine; it
  // checks PL-03 per command and writes no content.
  const concrete = plan.commands.filter((c) => !hasNewEntryRef(c.payload))
  let diff: Array<Record<string, unknown>> = []
  if (concrete.length > 0) {
    const result = await executeCommand(
      commandContext(ctx, false),
      transactionOf(
        concrete.map((c) => envelope(c, ctx.actor.userId, true)),
        ctx.actor.userId,
        true
      )
    )
    if (result.status !== 'dry_run') return { success: false, error: engineFailure(result) }
    diff = (result.diff ?? []).map((entry) => {
      const command = concrete[Number(entry.commandIndex)]
      const slug =
        command?.kind === 'relation'
          ? plan.relations[command.itemIndex]?.sourceSlug
          : plan.entries[command?.itemIndex ?? -1]?.slug
      return { ...entry, ...(slug ? { slug } : {}) }
    })
  }

  let previewReceipt: string | undefined
  let expiresAt: string | undefined
  if (plan.commands.length > 0) {
    const receipt = await createPreviewReceipt({
      commands: [receiptEnvelope(plan, ctx.actor.userId)],
      userId: ctx.actor.userId,
      tenantId: ctx.tenantId,
      kv: ctx.kv,
      explanation: `Import into collection '${plan.collection.slug}'`,
    })
    previewReceipt = receipt.receiptId
    expiresAt = receipt.expiresAt
  }

  return {
    success: true,
    data: {
      collection: { id: plan.collection.id, slug: plan.collection.slug },
      strategy: plan.strategy,
      summary: summarize(plan.entries),
      entries: plan.entries,
      relations: plan.relations,
      warnings: plan.warnings,
      commandCount: plan.commands.length,
      diff,
      ...(previewReceipt ? { previewReceipt, expiresAt } : {}),
    },
  }
}

// ============================================================================
// Execute
// ============================================================================

async function executeImport(
  ctx: TransferContext,
  collectionSlug: string,
  input: ImportInput & { previewReceipt: string }
): Promise<TransferResult<ImportExecution>> {
  if (typeof input.previewReceipt !== 'string' || input.previewReceipt.length === 0) {
    return fail('RECEIPT_REQUIRED', 'Run an import preview first and pass its previewReceipt')
  }
  const planned = await buildPlan(ctx, collectionSlug, input)
  if (!planned.success) return planned
  const plan = planned.data

  // AI-05: the receipt must cover exactly this plan; it is claimed for single
  // use before anything runs. A changed plan does not spend the receipt.
  const verification = await redeemPreviewReceipt({
    receiptId: input.previewReceipt,
    userId: ctx.actor.userId,
    tenantId: ctx.tenantId,
    kv: ctx.kv,
    db: ctx.db,
    commandsToVerify: [receiptEnvelope(plan, ctx.actor.userId)],
  })
  if (!verification.valid) {
    const reason = verification.error as PreviewReceiptErrorCode
    if (reason === 'HASH_MISMATCH') {
      return fail(
        'IMPORT_PLAN_CHANGED',
        'The import plan no longer matches the preview (file, strategy or content changed). Preview again.',
        { reason, status: 409 }
      )
    }
    return fail('INVALID_PREVIEW_RECEIPT', verification.message ?? 'Preview receipt verification failed', {
      reason,
      status: previewReceiptErrorStatus(reason),
    })
  }

  const entryResults = new Map<number, { outcome: ImportOutcome; error?: string }>()
  const publishResults = new Map<number, { outcome: ImportOutcome; error?: string }>()
  const relationResults = new Map<number, { outcome: ImportOutcome; error?: string }>()
  const record = (command: PlannedCommand, outcome: ImportOutcome, error?: string) => {
    const target =
      command.kind === 'entry' ? entryResults : command.kind === 'publish' ? publishResults : relationResults
    target.set(command.itemIndex, { outcome, ...(error ? { error } : {}) })
  }

  const warnings = [...plan.warnings]
  const commandIds: string[] = []
  const createdIds = new Map<string, string>()
  let failed = false

  for (const phase of [1, 2] as const) {
    const phaseCommands = plan.commands.filter((c) => c.phase === phase)
    if (phaseCommands.length === 0) continue
    if (failed) {
      for (const command of phaseCommands) record(command, 'not_run')
      continue
    }
    const envelopes = phaseCommands.map((c) =>
      envelope({ ...c, payload: resolveNewEntryRefs(c.payload, createdIds) }, ctx.actor.userId)
    )
    const result = await executeCommand(commandContext(ctx, true), transactionOf(envelopes, ctx.actor.userId))
    commandIds.push(result.commandId)
    const subResults = (result.data?.subResults ?? []) as CommandResult[]
    if (result.status !== 'success' && subResults.length === 0) {
      failed = true
      for (const command of phaseCommands) record(command, 'not_run', result.error?.message)
      continue
    }
    for (const [i, command] of phaseCommands.entries()) {
      const sub = subResults[i]
      if (!sub) {
        record(command, 'not_run')
        continue
      }
      if (sub.status !== 'success') {
        failed = true
        record(command, 'failed', sub.error?.message)
        continue
      }
      record(command, 'success')
      if (command.type === 'createEntry') {
        const slug = String(command.payload.slug)
        const created = sub.data as { id?: string; slug?: string } | undefined
        if (created?.id) createdIds.set(`${NEW_ENTRY_REF}${slug}`, created.id)
        if (created?.slug && created.slug !== slug) {
          warnings.push(`Entry '${slug}' was created as '${created.slug}' because the slug was taken`)
        }
      }
    }
    if (result.status !== 'success') failed = true
  }

  return {
    success: true,
    data: {
      status: plan.commands.length === 0 ? 'nothing_to_do' : failed ? 'partial_failure' : 'applied',
      collection: { id: plan.collection.id, slug: plan.collection.slug },
      entries: plan.entries.map((item) => {
        const result = entryResults.get(item.index)
        const published = publishResults.get(item.index)
        return {
          ...item,
          ...(result ? { outcome: result.outcome, ...(result.error ? { error: result.error } : {}) } : {}),
          ...(published ? { publishOutcome: published.outcome } : {}),
        }
      }),
      relations: plan.relations.map((item) => {
        const result = relationResults.get(item.index)
        return { ...item, ...(result ? { outcome: result.outcome, ...(result.error ? { error: result.error } : {}) } : {}) }
      }),
      warnings: failed
        ? [...warnings, 'Import stopped at the first failed command. Completed commands were kept (D1 has no rollback).']
        : warnings,
      commandIds,
    },
  }
}

export const collectionTransferService = {
  exportCollection,
  previewImport,
  executeImport,
}
