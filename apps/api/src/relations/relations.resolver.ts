import type { Database } from '@/database/db'
import { type EntryRow, entriesRepository } from '@/entries/entries.repository'
import { type RelationRow, relationsRepository } from './relations.repository'

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

    // Single query: fetch all relations for this entry once, filter fields in memory.
    const allRelations = await relationsRepository.findBySourceEntry(db, entry.id)
    const fieldsToPopulate =
      fieldNames.length > 0 ? fieldNames : Array.from(new Set(allRelations.map((r) => r.fieldName)))

    // Process each field — collect ALL target IDs first, single batch fetch.
    const relationsByField = new Map<string, typeof allRelations>()
    for (const fieldName of fieldsToPopulate) {
      const fieldRelations = allRelations.filter((r) => r.fieldName === fieldName)
      if (fieldRelations.length > 0) relationsByField.set(fieldName, fieldRelations)
    }
    const allTargetIds = [...new Set([...relationsByField.values()].flat().map((r) => r.targetEntryId))]
    const targetEntries = await this.batchFetchEntries(db, allTargetIds, tenantId)

    // Create a map for quick lookup
    const targetEntriesMap = new Map(targetEntries.map((e) => [e.id, e]))

    for (const [fieldName, fieldRelations] of relationsByField) {

      // Recursively populate target entries if depth allows — in parallel:
      // each branch only reads the shared visited set, so order is preserved
      // without sequential awaits.
      const populatedTargets = (
        await Promise.all(
          fieldRelations.map(async (relation) => {
            const targetEntry = targetEntriesMap.get(relation.targetEntryId)
            if (!targetEntry) {
              return null
            }

            // Recursively populate if we haven't reached max depth
            if (depth < maxDepth) {
              return this.populate(
                db,
                targetEntry,
                [],
                depth + 1,
                maxDepth,
                newVisited,
                tenantId
              )
            }
            return targetEntry as PopulatedEntry
          })
        )
      ).filter((target): target is PopulatedEntry => target !== null)

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

  /**
   * Batch-populates relations for an array of entries in minimal database round-trips.
   * Avoids the N+1 cascade of calling populate() per entry row.
   */
  async populateMany(
    db: Database,
    entriesList: EntryRow[],
    fieldNames: string[] = [],
    depth = 1,
    maxDepth = 2,
    visited = new Set<string>(),
    tenantId?: string
  ): Promise<PopulatedEntry[]> {
    if (entriesList.length === 0) return []
    if (depth > maxDepth) return entriesList as PopulatedEntry[]

    const entryIds = entriesList.map((e) => e.id)
    const allRelations = await relationsRepository.findBySourceEntries(
      db,
      entryIds,
      fieldNames.length > 0 ? fieldNames : undefined
    )

    if (allRelations.length === 0) {
      return entriesList as PopulatedEntry[]
    }

    // Group relations by sourceEntryId
    const relationsBySource = new Map<string, RelationRow[]>()
    const targetEntryIdSet = new Set<string>()

    for (const rel of allRelations) {
      let list = relationsBySource.get(rel.sourceEntryId)
      if (!list) {
        list = []
        relationsBySource.set(rel.sourceEntryId, list)
      }
      list.push(rel)
      targetEntryIdSet.add(rel.targetEntryId)
    }

    // Batch fetch target entries
    const targetEntries = await this.batchFetchEntries(
      db,
      Array.from(targetEntryIdSet),
      tenantId
    )
    const targetEntriesMap = new Map<string, EntryRow>(targetEntries.map((e) => [e.id, e]))

    // If depth < maxDepth, recursively populate target entries in batch
    let populatedTargetMap: Map<string, PopulatedEntry> = targetEntriesMap as Map<
      string,
      PopulatedEntry
    >
    if (depth < maxDepth && targetEntries.length > 0) {
      const nextVisited = new Set([...visited, ...entryIds])
      const unvisitedTargets = targetEntries.filter((t) => !nextVisited.has(t.id))
      if (unvisitedTargets.length > 0) {
        const recursivelyPopulated = await this.populateMany(
          db,
          unvisitedTargets,
          [],
          depth + 1,
          maxDepth,
          nextVisited,
          tenantId
        )
        const resultMap = new Map<string, PopulatedEntry>(
          targetEntriesMap as Map<string, PopulatedEntry>
        )
        for (const item of recursivelyPopulated) {
          resultMap.set(item.id, item)
        }
        populatedTargetMap = resultMap
      }
    }

    // Assemble populated results
    return entriesList.map((entry) => {
      const entryRelations = relationsBySource.get(entry.id) || []
      if (entryRelations.length === 0) {
        return entry as PopulatedEntry
      }

      const populatedData = { ...entry.data }
      const fields =
        fieldNames.length > 0
          ? fieldNames
          : Array.from(new Set(entryRelations.map((r) => r.fieldName)))

      for (const fieldName of fields) {
        const fieldRelations = entryRelations.filter((r) => r.fieldName === fieldName)
        if (fieldRelations.length === 0) continue

        const populatedTargets: PopulatedEntry[] = []
        for (const rel of fieldRelations) {
          const target = populatedTargetMap.get(rel.targetEntryId)
          if (target) populatedTargets.push(target)
        }

        const relationType = fieldRelations[0]?.relationType
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
    })
  },
}
