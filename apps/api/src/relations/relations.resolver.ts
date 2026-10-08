import type { Database } from '@/database/db'
import { type EntryRow, entriesRepository } from '@/entries/entries.repository'
import { relationsRepository } from './relations.repository'

/**
 * Entry with populated relation fields.
 * Relation fields are replaced with the resolved entry data (or arrays of entries).
 */
export type PopulatedEntry = EntryRow & {
  data: Record<string, unknown>
}

/**
 * Populate resolver — recursively resolve related entries.
 *
 * For each specified field name, this resolver:
 * 1. Queries relations where sourceEntryId = entry.id and fieldName matches
 * 2. Fetches the target entries
 * 3. Recursively populates the target entries' relation fields (if depth < maxDepth)
 * 4. Replaces the relation field with resolved entry data
 *
 * A visited set prevents circular reference infinite loops.
 */
export const relationsResolver = {
  /**
   * Populate relation fields on an entry.
   *
   * @param db - Database instance
   * @param entry - Entry to populate
   * @param fieldNames - Field names to resolve (empty array = resolve all relation fields)
   * @param depth - Current recursion depth
   * @param maxDepth - Maximum recursion depth (default 3)
   * @param visited - Set of visited entry IDs to prevent circular references
   * @param tenantId - Tenant ID for tenant-scoped entry lookups
   * @returns Entry with resolved relation fields
   */
  async populate(
    db: Database,
    entry: EntryRow,
    fieldNames: string[] = [],
    depth = 1,
    maxDepth = 3,
    visited: Set<string> = new Set(),
    tenantId?: string
  ): Promise<PopulatedEntry> {
    // Prevent circular references
    if (visited.has(entry.id)) {
      return entry as PopulatedEntry
    }

    // Prevent excessive depth
    if (depth > maxDepth) {
      return entry as PopulatedEntry
    }

    // Mark this entry as visited
    const newVisited = new Set(visited)
    newVisited.add(entry.id)

    // Clone entry data to avoid mutating the original
    const populatedData = { ...entry.data }

    // If no fieldNames specified, fetch all relation fields once.
    const allRelations =
      fieldNames.length === 0 ? await relationsRepository.findBySourceEntry(db, entry.id) : []
    const fieldsToPopulate =
      fieldNames.length > 0 ? fieldNames : Array.from(new Set(allRelations.map((r) => r.fieldName)))

    // Process each field
    for (const fieldName of fieldsToPopulate) {
      const fieldRelations =
        fieldNames.length > 0
          ? await relationsRepository.findBySourceEntry(db, entry.id, fieldName)
          : allRelations.filter((r) => r.fieldName === fieldName)

      if (fieldRelations.length === 0) {
        continue
      }

      // Batch-fetch all target entries for this field
      const targetEntryIds = fieldRelations.map((r) => r.targetEntryId)
      const targetEntries = await this.batchFetchEntries(db, targetEntryIds, tenantId)

      // Create a map for quick lookup
      const targetEntriesMap = new Map(targetEntries.map((e) => [e.id, e]))

      // Recursively populate target entries if depth allows
      const populatedTargets: PopulatedEntry[] = []
      for (const relation of fieldRelations) {
        const targetEntry = targetEntriesMap.get(relation.targetEntryId)
        if (!targetEntry) {
          continue
        }

        // Recursively populate if we haven't reached max depth
        if (depth < maxDepth) {
          const populated = await this.populate(
            db,
            targetEntry,
            [],
            depth + 1,
            maxDepth,
            newVisited,
            tenantId
          )
          populatedTargets.push(populated)
        } else {
          populatedTargets.push(targetEntry as PopulatedEntry)
        }
      }

      // Determine cardinality based on relationType of the first relation
      const relationType = fieldRelations[0]?.relationType

      // For one-to-one, store a single object; for one-to-many and many-to-many, store an array
      if (relationType === 'one-to-one') {
        populatedData[fieldName] = populatedTargets[0] ?? null
      } else {
        populatedData[fieldName] = populatedTargets
      }
    }

    return {
      ...entry,
      data: populatedData,
    }
  },

  /**
   * Batch-fetch multiple entries by IDs to avoid N+1 queries.
   */
  async batchFetchEntries(
    db: Database,
    entryIds: string[],
    tenantId?: string
  ): Promise<EntryRow[]> {
    if (entryIds.length === 0) {
      return []
    }
    return entriesRepository.findByIds(db, entryIds, tenantId)
  },
}
