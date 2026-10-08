import { collectionsRepository } from '@/collections/collections.repository'
import type { Database } from '@/database/db'
import { relationsResolver } from '@/relations/relations.resolver'
import { flattenLocaleFields } from '@/shared/locale'
import type { ServiceResult } from '@/shared/types/result'
import { entryStatuses, isEntryStatus } from '@/shared/schemas/entry'
import { slugify } from '@/shared/utils/slugify'
import { type EntryFilters, type EntryRow, entriesRepository } from './entries.repository'

/** Valid entry status values. */
const VALID_STATUSES = entryStatuses

/** Input for creating an entry. */
export interface CreateEntryInput {
  collectionId: string
  slug?: string
  status?: string
  data: Record<string, unknown>
}

/** Input for updating an entry. */
export interface UpdateEntryInput {
  slug?: string
  status?: string
  data?: Record<string, unknown>
  publishAt?: string | null
  unpublishAt?: string | null
}

/**
 * Try to derive a slug from entry data fields.
 * Looks for a "title" or "name" field to auto-generate from.
 * If the field is localized, uses the default locale value.
 */
function deriveSlugFromData(data: Record<string, unknown>, defaultLocale?: string): string | null {
  const candidate = data.title ?? data.name

  // If the field is a string, use it directly
  if (typeof candidate === 'string' && candidate.length > 0) {
    return slugify(candidate)
  }

  // If the field is an object (localized), extract the default locale value
  if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
    const localeValue = (candidate as Record<string, unknown>)[defaultLocale ?? 'en']
    if (typeof localeValue === 'string' && localeValue.length > 0) {
      return slugify(localeValue)
    }
  }

  return null
}

/**
 * Validate that localized field data matches the collection's field definitions.
 * Ensures localizable fields store values as locale objects with valid locale keys.
 */
function validateLocalizedFields(
  data: Record<string, unknown>,
  fields: Array<{ name: string; localizable: boolean }>,
  supportedLocales: string[]
): { valid: true } | { valid: false; error: string } {
  for (const field of fields) {
    const value = data[field.name]

    // Skip if field is not present (required validation happens elsewhere)
    if (value === undefined) continue

    if (field.localizable) {
      // Localizable fields must be objects
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {
          valid: false,
          error: `Field '${field.name}' is localizable and must be an object with locale keys (e.g., { en: "value", fr: "valeur" })`,
        }
      }

      // Validate that all locale keys are in supportedLocales
      const localeObj = value as Record<string, unknown>
      const localeKeys = Object.keys(localeObj)

      if (localeKeys.length === 0) {
        return {
          valid: false,
          error: `Field '${field.name}' is localizable but has no locale values`,
        }
      }

      for (const localeKey of localeKeys) {
        if (!supportedLocales.includes(localeKey)) {
          return {
            valid: false,
            error: `Field '${field.name}' contains unsupported locale '${localeKey}'. Supported locales: ${supportedLocales.join(', ')}`,
          }
        }
      }
    }
    // Non-localizable fields should not be objects with locale keys
    // (unless they're intentionally storing structured data like JSON field type)
    // We don't enforce this strictly as JSON fields can store arbitrary objects
  }

  return { valid: true }
}

type FieldDefinitionValidation = {
  name: string
  type: string
  required: boolean
  localizable: boolean
  options?: Record<string, unknown>
}

function normalizeRelationType(field: FieldDefinitionValidation): string {
  return (field.options?.relationType as string | undefined) ?? 'one-to-many'
}

function isMissingFieldValue(field: FieldDefinitionValidation, value: unknown): boolean {
  if (value === undefined || value === null) return true

  switch (field.type) {
    case 'text':
    case 'richtext':
    case 'date':
      return typeof value === 'string' && value.trim().length === 0
    case 'media':
      return typeof value === 'string' && value.trim().length === 0
    case 'relation': {
      const relationType = normalizeRelationType(field)
      if (relationType === 'one-to-one') {
        return typeof value === 'string' && value.trim().length === 0
      }
      return Array.isArray(value) && value.length === 0
    }
    case 'number':
    case 'boolean':
      return false
    case 'json':
      return false
    default:
      return false
  }
}

function validateFieldValueType(
  field: FieldDefinitionValidation,
  value: unknown
): { valid: true } | { valid: false; error: string } {
  switch (field.type) {
    case 'text':
    case 'richtext':
      if (typeof value !== 'string') {
        return { valid: false, error: `Field '${field.name}' must be a string` }
      }
      return { valid: true }

    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return { valid: false, error: `Field '${field.name}' must be a finite number` }
      }
      return { valid: true }

    case 'boolean':
      if (typeof value !== 'boolean') {
        return { valid: false, error: `Field '${field.name}' must be a boolean` }
      }
      return { valid: true }

    case 'date':
      if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
        return { valid: false, error: `Field '${field.name}' must be a valid ISO date string` }
      }
      return { valid: true }

    case 'media':
      if (typeof value === 'string' && value.trim().length > 0) {
        return { valid: true }
      }
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {
          valid: false,
          error: `Field '${field.name}' must be a media URL string or object with assetId`,
        }
      }
      const assetId = (value as Record<string, unknown>).assetId
      if (typeof assetId !== 'string' || assetId.trim().length === 0) {
        return { valid: false, error: `Field '${field.name}' media object must include assetId` }
      }
      if (
        (value as Record<string, unknown>).variant !== undefined &&
        typeof (value as Record<string, unknown>).variant !== 'string'
      ) {
        return { valid: false, error: `Field '${field.name}' media variant must be a string` }
      }
      return { valid: true }

    case 'relation': {
      const relationType = normalizeRelationType(field)
      if (relationType === 'one-to-one') {
        if (typeof value !== 'string') {
          return { valid: false, error: `Field '${field.name}' must be an entry id string` }
        }
        return { valid: true }
      }
      if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
        return {
          valid: false,
          error: `Field '${field.name}' must be an array of entry id strings`,
        }
      }
      return { valid: true }
    }

    case 'json':
      try {
        JSON.stringify(value)
        return { valid: true }
      } catch {
        return { valid: false, error: `Field '${field.name}' must be JSON-serializable` }
      }

    default:
      return { valid: true }
  }
}

function validateEntryFieldData(
  data: Record<string, unknown>,
  fields: FieldDefinitionValidation[],
  requireRequiredFields: boolean
): { valid: true } | { valid: false; error: string } {
  for (const field of fields) {
    const value = data[field.name]
    const hasFieldValue = value !== undefined

    if (!hasFieldValue) {
      if (requireRequiredFields && field.required) {
        return { valid: false, error: `Missing required field '${field.name}'` }
      }
      continue
    }

    if (field.localizable) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {
          valid: false,
          error: `Field '${field.name}' is localizable and must be an object with locale keys`,
        }
      }

      const localeMap = value as Record<string, unknown>
      if (field.required) {
        const hasAnyMeaningfulLocaleValue = Object.values(localeMap).some(
          (localeValue) => !isMissingFieldValue(field, localeValue)
        )
        if (!hasAnyMeaningfulLocaleValue) {
          return { valid: false, error: `Field '${field.name}' is required` }
        }
      }

      for (const [localeKey, localeValue] of Object.entries(localeMap)) {
        if (isMissingFieldValue(field, localeValue)) {
          continue
        }
        const validation = validateFieldValueType(field, localeValue)
        if (!validation.valid) {
          return {
            valid: false,
            error: `${validation.error} (locale '${localeKey}')`,
          }
        }
      }

      continue
    }

    if (field.required && isMissingFieldValue(field, value)) {
      return { valid: false, error: `Field '${field.name}' is required` }
    }

    if (!field.required && isMissingFieldValue(field, value)) {
      continue
    }

    const validation = validateFieldValueType(field, value)
    if (!validation.valid) {
      return validation
    }
  }

  return { valid: true }
}

function parsePopulateQuery(populate?: string, depth?: string): {
  fieldNames: string[] | null
  maxDepth: number
} {
  if (!populate) {
    return { fieldNames: null, maxDepth: 1 }
  }
  const fieldNames = populate
    .split(',')
    .map((field) => field.trim())
    .filter((field) => field.length > 0)
  const parsedDepth = depth ? Number(depth) : 1
  const maxDepth = Math.min(Math.max(Number.isFinite(parsedDepth) ? parsedDepth : 1, 1), 3)
  return { fieldNames, maxDepth }
}

/**
 * Business logic layer for entries.
 *
 * Orchestrates repository calls with collection validation,
 * version management, slug generation, and error handling.
 */
export const entriesService = {
  /** List entries with optional filtering and pagination. */
  async findAll(
    db: Database,
    filters: EntryFilters = {},
    tenantId?: string
  ): Promise<ServiceResult<{ entries: EntryRow[]; total: number; page: number; perPage: number }>> {
    let effectiveCollectionId = filters.collectionId
    let validatedCollectionId: string | undefined
    if (!effectiveCollectionId && filters.collectionSlug) {
      const collectionBySlug = await collectionsRepository.findBySlug(db, filters.collectionSlug, tenantId)
      if (!collectionBySlug) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: `Collection '${filters.collectionSlug}' not found` },
        }
      }
      effectiveCollectionId = collectionBySlug.id
      validatedCollectionId = collectionBySlug.id
    }

    // If collectionId is specified, validate it exists
    if (effectiveCollectionId && validatedCollectionId !== effectiveCollectionId) {
      const collection = await collectionsRepository.findById(db, effectiveCollectionId, tenantId)
      if (!collection) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: `Collection '${effectiveCollectionId}' not found` },
        }
      }
    }

    // Validate status filter if provided
    if (filters.status && !isEntryStatus(filters.status)) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: `Invalid status '${filters.status}'. Valid values: ${VALID_STATUSES.join(', ')}`,
        },
      }
    }

    const page = filters.page ?? 1
    const perPage = filters.perPage ?? 20
    const { rows, total } = await entriesRepository.findAll(db, {
      collectionId: effectiveCollectionId,
      tenantId,
      status: filters.status,
      page,
      perPage,
      extraConditions: filters.extraConditions,
      orderByClause: filters.orderByClause,
    })

    return {
      success: true,
      data: { entries: rows, total, page, perPage },
    }
  },

  /** Get multiple entries by ID in a single query. */
  async findByIds(
    db: Database,
    ids: string[],
    tenantId?: string
  ): Promise<ServiceResult<EntryRow[]>> {
    if (ids.length === 0) return { success: true, data: [] }
    if (ids.length > 50) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Maximum 50 IDs per batch request',
        },
      }
    }
    const data = await entriesRepository.findByIds(db, ids, tenantId)
    return { success: true, data }
  },

  /** Get an entry by ID. */
  async findById(db: Database, id: string, tenantId?: string): Promise<ServiceResult<EntryRow>> {
    const entry = await entriesRepository.findById(db, id, tenantId)
    if (!entry) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: `Entry '${id}' not found` },
      }
    }
    return { success: true, data: entry }
  },

  /**
   * Get an entry by ID with optional locale flattening.
   * If locale is provided, localizable fields are flattened to show only that locale's values.
   */
  async findByIdWithLocale(
    db: Database,
    id: string,
    locale?: string,
    tenantId?: string
  ): Promise<ServiceResult<EntryRow>> {
    const entry = await entriesRepository.findById(db, id, tenantId)
    if (!entry) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: `Entry '${id}' not found` },
      }
    }

    // If no locale specified, return as-is
    if (!locale) {
      return { success: true, data: entry }
    }

    // Fetch collection to get field definitions and default locale
    const collection = await collectionsRepository.findById(db, entry.collectionId, tenantId)
    if (!collection) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: `Collection '${entry.collectionId}' not found` },
      }
    }

    // Flatten localized fields
    const flattenedData = flattenLocaleFields(
      entry.data,
      collection.fields,
      locale,
      collection.defaultLocale
    )

    return {
      success: true,
      data: {
        ...entry,
        data: flattenedData,
      },
    }
  },

  async findByIdWithLocaleAndPopulate(
    db: Database,
    id: string,
    options: { locale?: string; populate?: string; depth?: string } = {},
    tenantId?: string
  ): Promise<ServiceResult<EntryRow>> {
    const baseResult = await entriesService.findByIdWithLocale(db, id, options.locale, tenantId)
    if (!baseResult.success) {
      return baseResult
    }
    const { fieldNames, maxDepth } = parsePopulateQuery(options.populate, options.depth)
    if (!fieldNames || fieldNames.length === 0) {
      return baseResult
    }
    const populatedEntry = await relationsResolver.populate(
      db, baseResult.data, fieldNames, 1, maxDepth, new Set(), tenantId
    )
    return { success: true, data: populatedEntry }
  },

  /**
   * List entries with optional locale flattening.
   * If locale is provided, localizable fields are flattened to show only that locale's values.
   */
  async findAllWithLocale(
    db: Database,
    filters: EntryFilters & { locale?: string } = {},
    tenantId?: string
  ): Promise<ServiceResult<{ entries: EntryRow[]; total: number; page: number; perPage: number }>> {
    // Extract locale from filters
    const { locale, ...entryFilters } = filters

    // Get entries using existing findAll logic
    const result = await entriesService.findAll(db, entryFilters, tenantId)
    if (!result.success) {
      return result
    }

    // If no locale specified, return as-is
    if (!locale) {
      return result
    }

    // Flatten entries by locale
    // Group entries by collection to avoid repeated D1 collection lookups.
    const uniqueCollectionIds = Array.from(
      new Set(result.data.entries.map((entry) => entry.collectionId))
    )
    const collectionPairs = await Promise.all(
      uniqueCollectionIds.map(async (collectionId) => [
        collectionId,
        await collectionsRepository.findById(db, collectionId, tenantId),
      ] as const)
    )
    const collectionCache = new Map(collectionPairs)

    const flattenedEntries = result.data.entries.map((entry) => {
      const collection = collectionCache.get(entry.collectionId)
      if (!collection) {
        // Return entry as-is if collection not found
        return entry
      }

      // Flatten localized fields
      const flattenedData = flattenLocaleFields(
        entry.data,
        collection.fields,
        locale,
        collection.defaultLocale
      )

      return {
        ...entry,
        data: flattenedData,
      }
    })

    return {
      success: true,
      data: {
        entries: flattenedEntries,
        total: result.data.total,
        page: result.data.page,
        perPage: result.data.perPage,
      },
    }
  },

  async findAllWithLocaleAndPopulate(
    db: Database,
    filters: EntryFilters & { locale?: string; populate?: string; depth?: string } = {},
    tenantId?: string
  ): Promise<ServiceResult<{ entries: EntryRow[]; total: number; page: number; perPage: number }>> {
    const { populate, depth, ...localeFilters } = filters
    const baseResult = await entriesService.findAllWithLocale(db, localeFilters, tenantId)
    if (!baseResult.success) {
      return baseResult
    }
    const { fieldNames, maxDepth } = parsePopulateQuery(populate, depth)
    if (!fieldNames || fieldNames.length === 0) {
      return baseResult
    }
    const populatedEntries = await Promise.all(
      baseResult.data.entries.map((entry) =>
        relationsResolver.populate(db, entry, fieldNames, 1, maxDepth, new Set(), tenantId)
      )
    )
    return {
      success: true,
      data: {
        ...baseResult.data,
        entries: populatedEntries,
      },
    }
  },

  /** Create a new entry with auto-generated slug and ID. */
  async create(
    db: Database,
    input: CreateEntryInput,
    _userId?: string,
    tenantId?: string
  ): Promise<ServiceResult<EntryRow>> {
    // Validate collection exists
    const collection = await collectionsRepository.findById(db, input.collectionId, tenantId)
    if (!collection) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: `Collection '${input.collectionId}' not found` },
      }
    }

    // Validate localized fields
    const localeValidation = validateLocalizedFields(
      input.data,
      collection.fields,
      collection.supportedLocales
    )
    if (!localeValidation.valid) {
      return {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: localeValidation.error },
      }
    }

    const fieldValidation = validateEntryFieldData(input.data, collection.fields, true)
    if (!fieldValidation.valid) {
      return {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: fieldValidation.error },
      }
    }

    // Validate status if provided
    const status = input.status ?? 'draft'
    if (!isEntryStatus(status)) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: `Invalid status '${status}'. Valid values: ${VALID_STATUSES.join(', ')}`,
        },
      }
    }

    // Generate slug: if explicitly provided, normalize only that value.
    // Otherwise, derive from data.title/data.name.
    let slug: string | null
    if (typeof input.slug === 'string') {
      slug = slugify(input.slug)
    } else {
      slug = deriveSlugFromData(input.data, collection.defaultLocale)
    }
    if (!slug) {
      slug = crypto.randomUUID().slice(0, 8)
    }

    // Check for slug conflicts within the collection and append a number if needed
    let finalSlug = slug
    let suffix = 1
    while (
      await entriesRepository.findByCollectionAndSlug(db, input.collectionId, finalSlug, tenantId)
    ) {
      finalSlug = `${slug}-${suffix}`
      suffix++
    }

    const now = new Date().toISOString()
    const id = crypto.randomUUID()

    const row = await entriesRepository.create(db, {
      id,
      collectionId: input.collectionId,
      slug: finalSlug,
      status,
      data: input.data,
      version: 1,
      createdAt: now,
      updatedAt: now,
    })

    return { success: true, data: row }
  },

  /** Update an existing entry by ID. Increments version and creates a snapshot. */
  async update(
    db: Database,
    id: string,
    input: UpdateEntryInput,
    userId?: string,
    optimisticVersion?: number,
    tenantId?: string
  ): Promise<ServiceResult<EntryRow>> {
    const existing = await entriesRepository.findById(db, id, tenantId)
    if (!existing) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: `Entry '${id}' not found` },
      }
    }

    // Fetch collection to validate localized fields
    const collection = await collectionsRepository.findById(db, existing.collectionId, tenantId)
    if (!collection) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: `Collection '${existing.collectionId}' not found` },
      }
    }

    // Validate localized fields if data is being updated
    if (input.data) {
      const localeValidation = validateLocalizedFields(
        input.data,
        collection.fields,
        collection.supportedLocales
      )
      if (!localeValidation.valid) {
        return {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: localeValidation.error },
        }
      }

      const fieldValidation = validateEntryFieldData(input.data, collection.fields, false)
      if (!fieldValidation.valid) {
        return {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: fieldValidation.error },
        }
      }
    }

    // Validate status if provided
    if (input.status && !isEntryStatus(input.status)) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: `Invalid status '${input.status}'. Valid values: ${VALID_STATUSES.join(', ')}`,
        },
      }
    }

    // Check slug uniqueness if changing slug
    if (input.slug && input.slug !== existing.slug) {
      const slugified = slugify(input.slug)
      const conflict = await entriesRepository.findByCollectionAndSlug(
        db,
        existing.collectionId,
        slugified,
        tenantId
      )
      if (conflict && conflict.id !== id) {
        return {
          success: false,
          error: {
            code: 'DUPLICATE_SLUG',
            message: `Slug '${slugified}' already exists in this collection`,
          },
        }
      }
      input.slug = slugified
    }

    const now = new Date().toISOString()
    const newVersion = existing.version + 1

    // Update the entry with incremented version
    const updated =
      optimisticVersion !== undefined
        ? await entriesRepository.updateWithVersion(db, id, optimisticVersion, {
            ...input,
            version: newVersion,
            updatedAt: now,
          })
        : await entriesRepository.update(db, id, {
            ...input,
            version: newVersion,
            updatedAt: now,
          })

    if (!updated) {
      if (optimisticVersion !== undefined) {
        return {
          success: false,
          error: {
            code: 'VERSION_CONFLICT',
            message: `Expected version ${optimisticVersion} but found ${existing.version}`,
          },
        }
      }
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: `Entry '${id}' not found` },
      }
    }

    // Create version snapshot of previous state only after successful update.
    await entriesRepository.createVersion(db, {
      id: crypto.randomUUID(),
      entryId: id,
      version: existing.version,
      data: existing.data,
      createdBy: userId ?? null,
      createdAt: now,
    })

    return { success: true, data: updated }
  },

  /** Delete an entry by ID. */
  async deleteById(db: Database, id: string, tenantId?: string): Promise<ServiceResult<{ id: string }>> {
    const existing = await entriesRepository.findById(db, id, tenantId)
    if (!existing) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: `Entry '${id}' not found` },
      }
    }
    const deleted = await entriesRepository.deleteById(db, id)
    if (!deleted) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: `Entry '${id}' not found` },
      }
    }
    return { success: true, data: { id } }
  },

  /** Duplicate an entry by ID. Creates a copy with draft status and new slug. */
  async duplicate(
    db: Database,
    entryId: string,
    _userId?: string,
    tenantId?: string
  ): Promise<ServiceResult<EntryRow>> {
    const existing = await entriesRepository.findById(db, entryId, tenantId)
    if (!existing) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: `Entry '${entryId}' not found` },
      }
    }

    // Generate unique slug with -copy suffix
    const baseSlug = `${existing.slug}-copy`
    let slug = baseSlug
    let suffix = 1
    while (await entriesRepository.findByCollectionAndSlug(db, existing.collectionId, slug, tenantId)) {
      slug = `${baseSlug}-${suffix}`
      suffix++
    }

    const id = crypto.randomUUID()
    const now = new Date().toISOString()

    const newEntry = await entriesRepository.create(db, {
      id,
      collectionId: existing.collectionId,
      slug,
      status: 'draft',
      data: existing.data,
      version: 1,
      createdAt: now,
      updatedAt: now,
    })

    return { success: true, data: newEntry }
  },
}
