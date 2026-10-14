import type { Database } from '@/database/db'
import { collectionsRepository } from '@/collections/collections.repository'
import { entriesRepository } from '@/entries/entries.repository'
import { type RelationRow, relationsRepository } from './relations.repository'

/** Result types for service operations. */
export type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string } }

/** Valid relation type values. */
const VALID_RELATION_TYPES = ['one-to-one', 'one-to-many', 'many-to-many'] as const

export type RelationType = (typeof VALID_RELATION_TYPES)[number]

/** Input for linking entries. */
export interface LinkRelationInput {
  sourceEntryId: string
  targetEntryId: string
  sourceCollectionId: string
  targetCollectionId: string
  relationType: RelationType
  fieldName: string
  sortOrder?: number
}

/** Input for unlinking entries. */
export interface UnlinkRelationInput {
  sourceEntryId: string
  targetEntryId: string
  fieldName: string
}

/**
 * Business logic layer for relations.
 *
 * Orchestrates repository calls with validation, cardinality enforcement,
 * and constraint checking.
 */
export const relationsService = {
  /**
   * Create a relation link with constraint enforcement.
   *
   * - For one-to-one: ensures the source entry doesn't already have a relation for this field
   * - For one-to-many: allows multiple targets from the same source+field
   * - For many-to-many: allows multiple targets with duplicate prevention via unique constraint
   * - Validates that both source and target entries exist before linking
   */
  async link(db: Database, params: LinkRelationInput, tenantId?: string): Promise<ServiceResult<RelationRow>> {
    // Validate relation type
    if (!VALID_RELATION_TYPES.includes(params.relationType)) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: `Invalid relation type '${params.relationType}'. Valid values: ${VALID_RELATION_TYPES.join(', ')}`,
        },
      }
    }

    // Validate source and target entries exist (single roundtrip pair).
    // When tenantId is provided, both lookups are tenant-scoped, so a
    // cross-tenant target resolves to undefined and is rejected below (H2).
    // Without tenantId, resolve the tenant from the source collection so the
    // new row is still stamped (at most one extra lookup).
    const [sourceEntry, targetEntry, sourceCollection] = await Promise.all([
      entriesRepository.findById(db, params.sourceEntryId, tenantId),
      entriesRepository.findById(db, params.targetEntryId, tenantId),
      tenantId
        ? Promise.resolve(undefined)
        : collectionsRepository.findById(db, params.sourceCollectionId),
    ])
    if (!sourceEntry) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: `Source entry '${params.sourceEntryId}' not found` },
      }
    }
    if (!targetEntry) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: `Target entry '${params.targetEntryId}' not found` },
      }
    }

    // Tenant stamp for the new row: explicit scope wins, else inherit the
    // source collection's tenant so pre-existing unscoped callers (global
    // collections) still produce correctly attributed rows (H3).
    const resolvedTenant = tenantId ?? sourceCollection?.tenantId ?? 'global'

    // For one-to-one relations, check that the source entry doesn't already have a relation for this field
    if (params.relationType === 'one-to-one') {
      const existingCount = await relationsRepository.countBySourceEntryAndField(
        db,
        params.sourceEntryId,
        params.fieldName,
        resolvedTenant
      )
      if (existingCount > 0) {
        return {
          success: false,
          error: {
            code: 'CARDINALITY_VIOLATION',
            message: `One-to-one relation: field '${params.fieldName}' already has a relation`,
          },
        }
      }
    }

    // Create the relation
    const now = new Date().toISOString()
    const id = crypto.randomUUID()

    try {
      const relation = await relationsRepository.link(db, {
        id,
        tenantId: resolvedTenant,
        sourceEntryId: params.sourceEntryId,
        targetEntryId: params.targetEntryId,
        sourceCollectionId: params.sourceCollectionId,
        targetCollectionId: params.targetCollectionId,
        relationType: params.relationType,
        fieldName: params.fieldName,
        sortOrder: params.sortOrder ?? 0,
        createdAt: now,
        updatedAt: now,
      })

      return { success: true, data: relation }
    } catch (error) {
      // Handle unique constraint violation (duplicate link).
      // ATM-05: the pre-check above is check-then-act and cannot serialize
      // concurrent linkers; the UNIQUE constraint is the arbiter. A
      // one-to-one race that loses the constraint race surfaces here and is
      // reported as CARDINALITY_VIOLATION instead of a raw DB error.
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        if (params.relationType === 'one-to-one') {
          return {
            success: false,
            error: {
              code: 'CARDINALITY_VIOLATION',
              message: `One-to-one relation: field '${params.fieldName}' already has a relation`,
            },
          }
        }
        return {
          success: false,
          error: {
            code: 'DUPLICATE_RELATION',
            message: 'This relation already exists',
          },
        }
      }
      throw error
    }
  },

  /**
   * Remove a relation link.
   */
  async unlink(
    db: Database,
    params: UnlinkRelationInput,
    tenantId?: string
  ): Promise<ServiceResult<{ deleted: boolean }>> {
    // Tenant guard: verify the source entry belongs to the tenant before unlinking.
    if (tenantId) {
      const source = await entriesRepository.findById(db, params.sourceEntryId, tenantId)
      if (!source) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Relation not found' },
        }
      }
    }
    const deleted = await relationsRepository.unlinkByEntries(
      db,
      params.sourceEntryId,
      params.targetEntryId,
      params.fieldName,
      tenantId
    )

    if (!deleted) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Relation not found' },
      }
    }

    return { success: true, data: { deleted: true } }
  },

  /**
   * Get all relations for an entry (as source), optionally filtered by field.
   */
  async getRelationsForEntry(
    db: Database,
    entryId: string,
    fieldName?: string,
    tenantId?: string
  ): Promise<ServiceResult<RelationRow[]>> {
    const relations = await relationsRepository.findBySourceEntry(db, entryId, fieldName, tenantId)
    return { success: true, data: relations }
  },

  /**
   * Get all relations pointing to a target entry (reverse lookup).
   */
  async getRelationsForTarget(
    db: Database,
    targetEntryId: string,
    tenantId?: string
  ): Promise<ServiceResult<RelationRow[]>> {
    const relations = await relationsRepository.findByTargetEntry(db, targetEntryId, tenantId)
    return { success: true, data: relations }
  },
}
