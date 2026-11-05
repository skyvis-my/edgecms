import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { CommandEnvelope } from '@edgecms/schemas/commands'
import { collectionsRepository } from '@/collections/collections.repository'
import { type CommandContext, executeCommand } from '@/commands/engine'
import type { Database } from '@/database/db'
import { entryVersions } from '@/database/schema'
import { projectEntryDataWithSchema } from '@/entries/schema-projection'
import type { EntryRow, EntryVersionRow } from '@/entries/entries.repository'
import type { ServiceResult } from '@/shared/types/result'
import { versioningRepository } from './versioning.repository'

/** Result of a rollback: the applied update, or a dry-run preview. */
export type RollbackResult =
  | {
      dryRun?: undefined
      commandId: string
      entry: EntryRow
      newVersion: EntryVersionRow
      restoredFromVersionId: string
    }
  | {
      dryRun: true
      commandId: string
      diff: Record<string, unknown>[]
      previewReceipt?: string
    }

/** Diff entry for version comparison. */
export interface VersionDiffEntry {
  field: string
  before: unknown
  after: unknown
  action: 'add' | 'update' | 'remove'
}

/** Single row in a version listing. Excludes the large `data` JSON snapshot. */
export type VersionListItem = Omit<EntryVersionRow, 'data'> & Partial<Pick<EntryVersionRow, 'data'>>

/** Paginated version list result. */
export interface VersionListResult {
  versions: VersionListItem[]
  total: number
  page: number
  perPage: number
  latestDiff: VersionDiffEntry[]
}

function computeFieldDiff(
  beforeData: Record<string, unknown>,
  afterData: Record<string, unknown>
): VersionDiffEntry[] {
  const diffs: VersionDiffEntry[] = []
  const allKeys = new Set([...Object.keys(beforeData), ...Object.keys(afterData)])

  for (const key of allKeys) {
    const beforeValue = beforeData[key]
    const afterValue = afterData[key]

    if (JSON.stringify(beforeValue) === JSON.stringify(afterValue)) {
      continue
    }

    let action: 'add' | 'update' | 'remove'
    if (beforeValue === undefined && afterValue !== undefined) {
      action = 'add'
    } else if (beforeValue !== undefined && afterValue === undefined) {
      action = 'remove'
    } else {
      action = 'update'
    }

    diffs.push({
      field: key,
      before: beforeValue,
      after: afterValue,
      action,
    })
  }

  return diffs
}

/**
 * Business logic layer for version management.
 *
 * Provides version browsing, diff comparison, and rollback functionality.
 */
export const versioningService = {
  /**
   * List all versions for an entry with pagination.
   *
   * @param db - Database connection
   * @param entryId - Entry ID to list versions for
   * @param options - Pagination options and the request tenant (P2: the entry
   *   must belong to it; omitted means the global scope)
   */
  async listVersions(
    db: Database,
    entryId: string,
    options: { page?: number; limit?: number; tenantId?: string } = {}
  ): Promise<ServiceResult<VersionListResult>> {
    const page = Math.max(1, options.page ?? 1)
    const perPage = Math.min(100, Math.max(1, options.limit ?? 20))
    const offset = (page - 1) * perPage

    // Verify entry exists in the request tenant
    const entry = await versioningRepository.findEntryById(db, entryId, options.tenantId)
    if (!entry) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: `Entry '${entryId}' not found` },
      }
    }

    // Optimized SQL path: COUNT + projected page (excludes the large `data`
    // JSON blob) + a 2-row fetch for latestDiff. Used with a real Drizzle DB.
    if (db && typeof (db as unknown as { select?: unknown }).select === 'function') {
      const [countResult, versions] = await Promise.all([
        db
          .select({ count: sql<number>`count(*)` })
          .from(entryVersions)
          .where(eq(entryVersions.entryId, entryId)),
        db
          .select({
            id: entryVersions.id,
            entryId: entryVersions.entryId,
            version: entryVersions.version,
            createdBy: entryVersions.createdBy,
            createdAt: entryVersions.createdAt,
          })
          .from(entryVersions)
          .where(eq(entryVersions.entryId, entryId))
          .orderBy(desc(entryVersions.version))
          .limit(perPage)
          .offset(offset),
      ])
      const total = countResult[0]?.count ?? 0

      // latestDiff needs payloads. On page 1 the page rows are the newest, so
      // fetch full payloads only for the first two page rows instead of a
      // separate newestTwo query; other pages still fetch the two newest.
      let latestDiff: VersionDiffEntry[] = []
      if (page === 1 && versions.length >= 1) {
        const newestIds = versions.slice(0, 2).map((v) => v.id)
        const payloadRows = await db
          .select()
          .from(entryVersions)
          .where(inArray(entryVersions.id, newestIds))
          .orderBy(desc(entryVersions.version))
        if (payloadRows.length >= 2) {
          latestDiff = computeFieldDiff(payloadRows[1]?.data || {}, payloadRows[0]?.data || {})
        }
      } else {
        // latestDiff needs payloads: fetch only the two newest snapshots.
        const newestTwo = await db
          .select()
          .from(entryVersions)
          .where(eq(entryVersions.entryId, entryId))
          .orderBy(desc(entryVersions.version))
          .limit(2)
        latestDiff =
          newestTwo.length >= 2
            ? computeFieldDiff(newestTwo[1]?.data || {}, newestTwo[0]?.data || {})
            : []
      }

      return {
        success: true,
        data: { versions, total, page, perPage, latestDiff },
      }
    }

    // Fallback for mocked DBs (unit tests): paginate in memory.
    const allVersions = await versioningRepository.findVersions(db, entryId)
    const total = allVersions.length

    // Apply pagination
    const versions = allVersions.slice(offset, offset + perPage)
    const latestDiff =
      allVersions.length >= 2
        ? computeFieldDiff(allVersions[1]?.data || {}, allVersions[0]?.data || {})
        : []

    return {
      success: true,
      data: { versions, total, page, perPage, latestDiff },
    }
  },

  /**
   * Get a single version by entry ID and version ID.
   *
   * @param db - Database connection
   * @param entryId - Entry ID
   * @param versionId - Version ID to retrieve
   * @param tenantId - Request tenant the entry must belong to (P2)
   */
  async getVersion(
    db: Database,
    entryId: string,
    versionId: string,
    tenantId?: string
  ): Promise<ServiceResult<EntryVersionRow>> {
    // Verify entry exists in the request tenant
    const entry = await versioningRepository.findEntryById(db, entryId, tenantId)
    if (!entry) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: `Entry '${entryId}' not found` },
      }
    }

    // Optimized SQL path: single indexed lookup scoped to (id, entryId).
    if (db && typeof (db as unknown as { select?: unknown }).select === 'function') {
      const rows = await db
        .select()
        .from(entryVersions)
        .where(and(eq(entryVersions.id, versionId), eq(entryVersions.entryId, entryId)))
        .limit(1)
      const version = rows[0]
      if (!version) {
        return {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: `Version '${versionId}' not found for entry '${entryId}'`,
          },
        }
      }
      return { success: true, data: version }
    }

    // Fallback for mocked DBs: direct indexed lookup by version ID with fallback for custom mocks
    let version: EntryVersionRow | undefined
    if (typeof versioningRepository.findVersionById === 'function') {
      const v = await versioningRepository.findVersionById(db, versionId)
      if (v && (!v.entryId || v.entryId === entryId)) {
        version = v
      }
    } else {
      const versions = await versioningRepository.findVersions(db, entryId)
      version = versions.find((v) => v.id === versionId)
    }

    if (!version) {
      return {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Version '${versionId}' not found for entry '${entryId}'`,
        },
      }
    }

    return { success: true, data: version }
  },

  /**
   * Compute field-level diff between two versions.
   *
   * @param db - Database connection
   * @param entryId - Entry ID
   * @param versionId1 - First version ID (older)
   * @param versionId2 - Second version ID (newer)
   * @param tenantId - Request tenant the entry must belong to (P2)
   */
  async diffVersions(
    db: Database,
    entryId: string,
    versionId1: string,
    versionId2: string,
    tenantId?: string
  ): Promise<ServiceResult<VersionDiffEntry[]>> {
    // Fetch both versions in parallel (independent indexed lookups).
    const [version1Result, version2Result] = await Promise.all([
      versioningService.getVersion(db, entryId, versionId1, tenantId),
      versioningService.getVersion(db, entryId, versionId2, tenantId),
    ])
    if (!version1Result.success) {
      return version1Result
    }
    if (!version2Result.success) {
      return version2Result
    }

    const version1 = version1Result.data
    const version2 = version2Result.data

    return { success: true, data: computeFieldDiff(version1.data || {}, version2.data || {}) }
  },

  /**
   * Roll an entry back to a previous version (CM-06).
   *
   * P3: the write runs through the command engine as an `updateEntry`
   * command that replaces `data` with the chosen version's data and carries
   * the entry's current version as `optimisticVersion`. The engine applies
   * content permissions, validation, the version check, the processed-command
   * record, audit event, change log, sync event, cache invalidation and the
   * webhook outbox intent. Like every update, it snapshots the pre-rollback
   * state to `entry_versions` under its own version number.
   *
   * @param ctx - Command context built by the request (db, actor, tenant)
   * @param entryId - Entry ID to roll back
   * @param versionId - Version ID to restore
   * @param options.tenantId - Request tenant the entry must belong to (P2)
   * @param options.dryRun - Preview the change without writing
   */
  async rollback(
    ctx: CommandContext,
    entryId: string,
    versionId: string,
    options: { tenantId?: string; dryRun?: boolean } = {}
  ): Promise<ServiceResult<RollbackResult>> {
    const { db } = ctx
    const { tenantId, dryRun } = options
    // Fetch target version + current entry in parallel (independent reads).
    const [versionResult, entry] = await Promise.all([
      versioningService.getVersion(db, entryId, versionId, tenantId),
      versioningRepository.findEntryById(db, entryId, tenantId),
    ])
    if (!versionResult.success) {
      return versionResult
    }
    if (!entry) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: `Entry '${entryId}' not found` },
      }
    }

    let restoredData = (versionResult.data.data || {}) as Record<string, unknown>
    if (entry.collectionId) {
      try {
        const collection = await collectionsRepository.findById(db, entry.collectionId, tenantId)
        if (collection?.fields && Array.isArray(collection.fields)) {
          restoredData = projectEntryDataWithSchema(restoredData, collection.fields)
        }
      } catch {
        // Fall back to the stored version data if the collection lookup fails.
      }
    }

    const envelope: CommandEnvelope = {
      type: 'updateEntry',
      payload: { entryId, data: restoredData },
      actor: ctx.actor as CommandEnvelope['actor'],
      optimisticVersion: entry.version,
      ...(dryRun ? { dryRun: true } : {}),
      timestamp: new Date().toISOString(),
    }
    const result = await executeCommand(ctx, envelope)

    if (result.status === 'dry_run') {
      return {
        success: true,
        data: {
          dryRun: true,
          commandId: result.commandId,
          diff: result.diff ?? [],
          ...(result.previewReceipt ? { previewReceipt: result.previewReceipt } : {}),
        },
      }
    }
    if (result.status !== 'success' || !result.data) {
      return {
        success: false,
        error: result.error ?? { code: 'INTERNAL_ERROR', message: 'Rollback failed' },
      }
    }

    const updated = result.data as unknown as EntryRow
    return {
      success: true,
      data: {
        commandId: result.commandId,
        entry: updated,
        // The entry's new current version. History keeps the pre-rollback
        // snapshot; the current version itself lives on the entry row.
        newVersion: {
          id: result.commandId,
          entryId,
          version: updated.version,
          data: updated.data,
          createdBy: ctx.actor.userId ?? null,
          createdAt: updated.updatedAt,
        },
        restoredFromVersionId: versionId,
      },
    }
  },
}
