/**
 * Context Builder
 *
 * Builds rich context packs for AI prompts by gathering relevant data
 * from the database (collections, entries, relations) and formatting it
 * for inclusion in system prompts or user messages.
 *
 * This allows the AI to understand:
 * - What collections are available
 * - What fields each collection has
 * - Current entry data (when editing)
 * - Available relations and their constraints
 */

export interface Collection {
  id: string
  name: string
  slug: string
  singleton: boolean
  fields: Array<{
    name: string
    type: string
    required: boolean
    localizable: boolean
    options?: Record<string, unknown>
  }>
  defaultLocale: string
  supportedLocales: string[]
}

export interface Entry {
  id: string
  collectionId: string
  slug: string
  status: string
  data: Record<string, unknown>
  version: number
  createdAt: string
  updatedAt: string
}

export interface Relation {
  id: string
  sourceEntryId: string
  targetEntryId: string
  sourceCollectionId: string
  targetCollectionId: string
  relationType: string
  fieldName: string
  sortOrder: number
}

export interface ContextPack {
  collections: Collection[]
  currentEntry?: Entry
  relatedEntries?: Entry[]
  availableRelations?: Array<{
    fieldName: string
    targetCollection: Collection
    relationType: string
  }>
  locale?: string
  tenant?: {
    slug: string
    name: string
  }
}

export interface ContextBuilderOptions {
  collections?: Collection[]
  entryId?: string
  collectionSlug?: string
  tenantId?: string
  locale?: string
  tenant?: {
    slug: string
    name: string
  }
}

export interface DbContextBuilderOptions extends ContextBuilderOptions {
  db: Database
}

/**
 * Build a context pack for AI prompts.
 *
 * This is a factory function that creates a structured context object.
 * In a real implementation, this would fetch data from the database.
 * For now, it provides the structure that the AI can use.
 *
 * @param options - Context configuration
 * @returns Structured context pack for AI consumption
 */
export function buildContextPack(options: ContextBuilderOptions): ContextPack {
  const { collections = [], entryId: _entryId, collectionSlug, locale = 'en', tenant } = options

  const contextPack: ContextPack = {
    collections,
    locale,
    tenant,
  }

  // If we're working with a specific collection, add relation info
  if (collectionSlug) {
    const collection = collections.find((c) => c.slug === collectionSlug)
    if (collection) {
      // Extract relation fields from the collection schema
      const relationFields = collection.fields.filter(
        (field) => field.type === 'relation' || field.type === 'reference'
      )

      contextPack.availableRelations = relationFields.map((field) => {
        const targetCollectionId = field.options?.collection as string
        const targetCollection = collections.find((c) => c.id === targetCollectionId)
        return {
          fieldName: field.name,
          targetCollection: targetCollection || ({} as Collection),
          relationType:
            (field.options?.relationType as string) ||
            (field.options?.multiple ? 'one-to-many' : 'one-to-one'),
        }
      })
    }
  }

  // Note: In a real implementation, if entryId is provided, this would:
  // 1. Fetch the entry from the database
  // 2. Fetch related entries via relations
  // 3. Add them to contextPack.currentEntry and contextPack.relatedEntries
  //
  // For now, we provide the structure so the calling code can populate it.

  return contextPack
}

export async function buildContextPackFromDb(
  options: DbContextBuilderOptions
): Promise<ContextPack> {
  const { db, collectionSlug, entryId, tenantId } = options
  const collectionRows = await collectionsRepository.findAll(db, tenantId)
  const collections: Collection[] = collectionRows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    singleton: row.singleton,
    fields: row.fields,
    defaultLocale: row.defaultLocale,
    supportedLocales: row.supportedLocales,
  }))

  const base = buildContextPack({ ...options, collections })

  if (!entryId) {
    return base
  }

  const entry = await entriesRepository.findById(db, entryId, tenantId)
  if (!entry) {
    return base
  }

  // Ensure optional collection context can be inferred from entry data if omitted.
  if (!collectionSlug) {
    const entryCollection = collections.find((c) => c.id === entry.collectionId)
    if (entryCollection?.slug) {
      base.availableRelations = buildContextPack({
        collections,
        collectionSlug: entryCollection.slug,
        locale: base.locale,
        tenant: base.tenant,
      }).availableRelations
    }
  }

  return {
    ...base,
    currentEntry: {
      id: entry.id,
      collectionId: entry.collectionId,
      slug: entry.slug,
      status: entry.status,
      data: entry.data,
      version: entry.version,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    },
  }
}

/**
 * Format a context pack into a human-readable string for AI consumption.
 *
 * This is useful for adding context to user messages or system prompts.
 *
 * @param contextPack - The context pack to format
 * @returns Formatted context string
 */
export function formatContextPack(contextPack: ContextPack): string {
  const sections: string[] = []

  if (contextPack.tenant) {
    sections.push(`**Workspace**: ${contextPack.tenant.name} (${contextPack.tenant.slug})`)
  }

  if (contextPack.locale) {
    sections.push(`**Current Locale**: ${contextPack.locale}`)
  }

  if (contextPack.currentEntry) {
    const entry = contextPack.currentEntry
    const collection = contextPack.collections.find((c) => c.id === entry.collectionId)
    sections.push(`
**Current Entry**:
- Collection: ${collection?.name || entry.collectionId}
- Slug: ${entry.slug}
- Status: ${entry.status}
- Version: ${entry.version}
- Data: ${JSON.stringify(entry.data, null, 2)}
`)
  }

  if (contextPack.availableRelations && contextPack.availableRelations.length > 0) {
    sections.push(`
**Available Relations**:
${contextPack.availableRelations
  .map((rel) => `- ${rel.fieldName} → ${rel.targetCollection.name} (${rel.relationType})`)
  .join('\n')}
`)
  }

  if (contextPack.relatedEntries && contextPack.relatedEntries.length > 0) {
    sections.push(`
**Related Entries** (${contextPack.relatedEntries.length}):
${contextPack.relatedEntries
  .map((entry) => {
    const collection = contextPack.collections.find((c) => c.id === entry.collectionId)
    return `- ${collection?.name || entry.collectionId}: ${entry.slug}`
  })
  .join('\n')}
`)
  }

  return sections.join('\n\n')
}

import { collectionsRepository } from '@/collections/collections.repository'
import type { Database } from '@/database/db'
import { entriesRepository } from '@/entries/entries.repository'
