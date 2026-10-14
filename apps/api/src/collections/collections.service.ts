import { commandsRepository } from '@/commands/commands.repository'
import type { Database } from '@/database/db'
import { logger } from '@/observability/logger'
import type { ServiceResult } from '@/shared/types/result'
import { slugify } from '@/shared/utils/slugify'
import { type CollectionRow, collectionsRepository } from './collections.repository'
import { clearGraphQLSchemaCache } from '@/graphql/graphql-schema.builder'
import { schemaSnapshotsRepository } from './schema-snapshots.repository'
import {
  computeSchemaHash,
  validateManagedSchemaMutation,
  type CollectionConfig,
  type ManagedCollectionManifest,
} from '@edgecms/schemas'

/**
 * Write a changelog entry for a collection mutation.
 *
 * Non-blocking: errors are logged but do not fail the mutation.
 * `commandId` is null because collection CRUD bypasses the command engine.
 */
async function writeCollectionChangeLog(
  db: Database,
  entityId: string,
  changeType: 'create' | 'update' | 'delete',
  tenantScope: string | null,
  payload: Record<string, unknown> | null
): Promise<void> {
  try {
    await commandsRepository.insertChangeLogEntries({
      db,
      commandId: null,
      entries: [
        {
          entityType: 'collection',
          entityId,
          action: changeType,
          changes: payload ?? undefined,
        },
      ],
      tenantScope,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    logger.error('collection_changelog_write_failed', { error: err instanceof Error ? err.message : String(err) })
  }
}

function toSchemaSnapshotPayload(collections: CollectionRow[]): Record<string, unknown> {
  return {
    collections: collections.map((collection) => ({
      id: collection.id,
      tenantId: collection.tenantId,
      name: collection.name,
      slug: collection.slug,
      singleton: collection.singleton,
      fields: collection.fields,
      defaultLocale: collection.defaultLocale,
      supportedLocales: collection.supportedLocales,
      createdAt: collection.createdAt,
      updatedAt: collection.updatedAt,
    })),
  }
}

async function writeSchemaSnapshot(db: Database, tenantScope: string | null): Promise<void> {
  try {
    const tenantId = tenantScope ?? 'global'
    const [latestSnapshot, collections] = await Promise.all([
      schemaSnapshotsRepository.findLatestSnapshot(db, tenantId),
      collectionsRepository.findAll(db, tenantScope ?? undefined),
    ])

    const nextSchemaVersion = (latestSnapshot?.schemaVersion ?? 0) + 1

    await schemaSnapshotsRepository.createSnapshot(db, {
      tenantId,
      schemaVersion: nextSchemaVersion,
      payload: toSchemaSnapshotPayload(collections),
    })
  } catch (err) {
    logger.error('schema_snapshot_write_failed', { error: err instanceof Error ? err.message : String(err) })
  }
}

const SEARCH_FIELD_PATH_REGEX = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/

/**
 * Validate a collection's searchFields allowlist: every entry must be a
 * well-formed field path that names a declared top-level field. Prevents
 * typos that would silently deny contains/sort on the public read path.
 */
function validateSearchFields(
  searchFields: string[] | undefined,
  fields: Array<{ name: string }> | undefined
): string | null {
  if (searchFields === undefined) return null
  const declared = new Set((fields ?? []).map((f) => f.name))
  for (const entry of searchFields) {
    if (typeof entry !== 'string' || !SEARCH_FIELD_PATH_REGEX.test(entry)) {
      return `searchFields entries must be field paths like "title" or "meta.author", got "${entry}"`
    }
    const root = entry.split('.')[0] as string
    if (declared.size > 0 && !declared.has(root)) {
      return `searchFields entry "${entry}" does not match any declared field`
    }
  }
  return null
}

/** Input for creating a collection. */
export interface CreateCollectionInput {
  name: string
  slug?: string
  singleton?: boolean
  fields: Array<{
    name: string
    type: string
    required: boolean
    localizable: boolean
    options?: Record<string, unknown>
  }>
  defaultLocale?: string
  supportedLocales?: string[]
  displayName?: string
  description?: string
  icon?: string
  color?: string
  listFields?: string[]
  searchFields?: string[]
  defaultSort?: string
  defaultSortOrder?: 'asc' | 'desc'
}

/** Input for updating a collection. */
export interface UpdateCollectionInput {
  name?: string
  singleton?: boolean
  fields?: Array<{
    name: string
    type: string
    required: boolean
    localizable: boolean
    options?: Record<string, unknown>
  }>
  defaultLocale?: string
  supportedLocales?: string[]
  displayName?: string
  description?: string
  icon?: string
  color?: string
  listFields?: string[]
  searchFields?: string[]
  defaultSort?: string
  defaultSortOrder?: 'asc' | 'desc'
  bypassManagedLock?: boolean
}

/**
 * Business logic layer for collections.
 *
 * Orchestrates repository calls with validation, slug generation,
 * and error handling.
 */
export const collectionsService = {
  /** List all collections. */
  async findAll(db: Database, tenantId?: string): Promise<ServiceResult<CollectionRow[]>> {
    const data = tenantId
      ? await collectionsRepository.findAll(db, tenantId)
      : await collectionsRepository.findAll(db)
    return { success: true, data }
  },

  /** Get a collection by ID or slug. */
  async findByIdOrSlug(
    db: Database,
    idOrSlug: string,
    tenantId?: string
  ): Promise<ServiceResult<CollectionRow>> {
    // UUID-shaped input is usually an ID, slug-shaped input a slug — one query
    // on the fast path, with a fallback on miss for legacy/non-UUID ids.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (UUID_RE.test(idOrSlug)) {
      const byId = tenantId
        ? await collectionsRepository.findById(db, idOrSlug, tenantId)
        : await collectionsRepository.findById(db, idOrSlug)
      if (byId) return { success: true, data: byId }
      const bySlug = tenantId
        ? await collectionsRepository.findBySlug(db, idOrSlug, tenantId)
        : await collectionsRepository.findBySlug(db, idOrSlug)
      if (bySlug) return { success: true, data: bySlug }
    } else {
      const bySlug = tenantId
        ? await collectionsRepository.findBySlug(db, idOrSlug, tenantId)
        : await collectionsRepository.findBySlug(db, idOrSlug)
      if (bySlug) return { success: true, data: bySlug }
      const byId = tenantId
        ? await collectionsRepository.findById(db, idOrSlug, tenantId)
        : await collectionsRepository.findById(db, idOrSlug)
      if (byId) return { success: true, data: byId }
    }

    return {
      success: false,
      error: { code: 'NOT_FOUND', message: `Collection '${idOrSlug}' not found` },
    }
  },

  /** Create a new collection with auto-generated slug and ID. */
  async create(
    db: Database,
    input: CreateCollectionInput,
    tenantId?: string
  ): Promise<ServiceResult<CollectionRow>> {
    // Generate slug from explicit slug (if provided) or from name.
    const baseSlug = slugify(input.slug ?? input.name)
    if (!baseSlug) {
      return {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Name or slug must produce a valid slug' },
      }
    }

    // Validate locale configuration
    const defaultLocale = input.defaultLocale ?? 'en'
    const supportedLocales = input.supportedLocales ?? ['en']

    if (!defaultLocale || defaultLocale.trim().length === 0) {
      return {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'defaultLocale must be a non-empty string' },
      }
    }

    if (!supportedLocales || supportedLocales.length === 0) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'supportedLocales must be a non-empty array',
        },
      }
    }

    if (!supportedLocales.includes(defaultLocale)) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: `defaultLocale '${defaultLocale}' must be included in supportedLocales`,
        },
      }
    }

    const searchFieldsError = validateSearchFields(input.searchFields, input.fields)
    if (searchFieldsError) {
      return {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: searchFieldsError },
      }
    }

    // Resolve slug conflict with one query instead of sequential lookups.
    const existingSlugs = new Set(await collectionsRepository.findSlugsByPrefix(db, baseSlug, tenantId))
    let slug = baseSlug
    if (existingSlugs.has(baseSlug)) {
      let suffix = 1
      while (existingSlugs.has(`${baseSlug}-${suffix}`)) {
        suffix++
      }
      slug = `${baseSlug}-${suffix}`
    }

    const now = new Date().toISOString()
    const id = crypto.randomUUID()

    let row: CollectionRow
    try {
      row = await collectionsRepository.create(db, {
        id,
        tenantId: tenantId ?? 'global',
        name: input.name,
        slug,
        singleton: input.singleton ?? false,
        fields: input.fields,
        defaultLocale,
        supportedLocales,
        displayName: input.displayName ?? null,
        description: input.description ?? null,
        icon: input.icon ?? null,
        color: input.color ?? null,
        listFields: input.listFields ?? null,
        searchFields: input.searchFields ?? null,
        defaultSort: input.defaultSort ?? null,
        defaultSortOrder: input.defaultSortOrder ?? null,
        createdAt: now,
        updatedAt: now,
      })
    } catch (err) {
      // UNIQUE race on slug (concurrent creates with same base slug).
      if (err instanceof Error && /unique|UNIQUE/i.test(err.message)) {
        return {
          success: false,
          error: { code: 'CONFLICT', message: `Collection with slug '${slug}' already exists` },
        }
      }
      throw err
    }

    await writeCollectionChangeLog(db, id, 'create', tenantId ?? null, {
      name: input.name,
      slug,
      fields: input.fields,
    })
    await writeSchemaSnapshot(db, tenantId ?? null)
    clearGraphQLSchemaCache(tenantId)

    return { success: true, data: row }
  },

  /** Update an existing collection by ID. */
  async update(
    db: Database,
    id: string,
    input: UpdateCollectionInput,
    tenantId?: string
  ): Promise<ServiceResult<CollectionRow>> {
    const existing = tenantId
      ? await collectionsRepository.findById(db, id, tenantId)
      : await collectionsRepository.findById(db, id)
    if (!existing) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: `Collection '${id}' not found` },
      }
    }

    // Enforce Managed-Schema Mode: lock Git-managed collections against ad-hoc field modifications
    if (existing.description?.includes('@managed:git') && input.fields !== undefined && !input.bypassManagedLock) {
      const currentConfig: CollectionConfig = {
        name: existing.name,
        slug: existing.slug,
        singleton: existing.singleton,
        fields: existing.fields as CollectionConfig['fields'],
        defaultLocale: existing.defaultLocale,
        supportedLocales: existing.supportedLocales,
      }
      const manifest: ManagedCollectionManifest = {
        schema: currentConfig,
        schemaHash: computeSchemaHash(currentConfig),
        managedBy: 'git',
        version: 1,
        updatedAt: existing.updatedAt,
      }

      const incomingConfig: CollectionConfig = {
        name: input.name ?? existing.name,
        slug: existing.slug,
        singleton: input.singleton ?? existing.singleton,
        fields: input.fields as CollectionConfig['fields'],
        defaultLocale: input.defaultLocale ?? existing.defaultLocale,
        supportedLocales: input.supportedLocales ?? existing.supportedLocales,
      }

      const validation = validateManagedSchemaMutation(manifest, incomingConfig, false)
      if (!validation.allowed) {
        return {
          success: false,
          error: {
            code: 'MANAGED_SCHEMA_IMMUTABLE',
            message: validation.reason ?? 'Collection schema is Git-managed and locked against runtime changes',
          },
        }
      }
    }

    // Validate locale configuration if being updated
    const defaultLocale = input.defaultLocale ?? existing.defaultLocale
    const supportedLocales = input.supportedLocales ?? existing.supportedLocales

    if (input.defaultLocale !== undefined) {
      if (!input.defaultLocale || input.defaultLocale.trim().length === 0) {
        return {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'defaultLocale must be a non-empty string' },
        }
      }
    }

    if (input.supportedLocales !== undefined) {
      if (!input.supportedLocales || input.supportedLocales.length === 0) {
        return {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'supportedLocales must be a non-empty array',
          },
        }
      }
    }

    if (!supportedLocales.includes(defaultLocale)) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: `defaultLocale '${defaultLocale}' must be included in supportedLocales`,
        },
      }
    }

    if (input.searchFields !== undefined) {
      const searchFieldsError = validateSearchFields(
        input.searchFields,
        input.fields ?? existing.fields
      )
      if (searchFieldsError) {
        return {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: searchFieldsError },
        }
      }
    }

    const now = new Date().toISOString()
    const updated = tenantId
      ? await collectionsRepository.update(
          db,
          id,
          {
            ...input,
            updatedAt: now,
          },
          tenantId
        )
      : await collectionsRepository.update(db, id, {
          ...input,
          updatedAt: now,
        })

    if (!updated) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: `Collection '${id}' not found` },
      }
    }

    await writeCollectionChangeLog(db, id, 'update', tenantId ?? null, {
      ...input,
    })
    await writeSchemaSnapshot(db, tenantId ?? null)
    clearGraphQLSchemaCache(tenantId)

    return { success: true, data: updated }
  },

  /** Delete a collection by ID. */
  async deleteById(
    db: Database,
    id: string,
    tenantId?: string
  ): Promise<ServiceResult<{ id: string }>> {
    const deleted = tenantId
      ? await collectionsRepository.deleteById(db, id, tenantId)
      : await collectionsRepository.deleteById(db, id)
    if (!deleted) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: `Collection '${id}' not found` },
      }
    }

    await writeCollectionChangeLog(db, id, 'delete', tenantId ?? null, null)
    await writeSchemaSnapshot(db, tenantId ?? null)
    clearGraphQLSchemaCache(tenantId)

    return { success: true, data: { id } }
  },
}
