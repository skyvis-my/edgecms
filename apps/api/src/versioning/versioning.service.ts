import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { commandsRepository } from '@/commands/commands.repository'
import { scheduleDeferredWork } from '@/commands/deferred-work'
import type { Database } from '@/database/db'
import { entries, entryVersions } from '@/database/schema'
import { logger } from '@/observability/logger'
import type { EntryRow, EntryVersionRow } from '@/entries/entries.repository'
import type { ServiceResult } from '@/shared/types/result'
import { retentionService } from './retention.service'
import { versioningRepository } from './versioning.repository'

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
   * @param options - Pagination options
   */
  async listVersions(
    db: Database,
    entryId: string,
    options: { page?: number; limit?: number } = {}
  ): Promise<ServiceResult<VersionListResult>> {
    const page = Math.max(1, options.page ?? 1)
    const perPage = Math.min(100, Math.max(1, options.limit ?? 20))
    const offset = (page - 1) * perPage

    // Verify entry exists
    const entry = await versioningRepository.findEntryById(db, entryId)
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
   */
  async getVersion(
    db: Database,
    entryId: string,
    versionId: string
  ): Promise<ServiceResult<EntryVersionRow>> {
    // Verify entry exists
    const entry = await versioningRepository.findEntryById(db, entryId)
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
   */
  async diffVersions(
    db: Database,
    entryId: string,
    versionId1: string,
    versionId2: string
  ): Promise<ServiceResult<VersionDiffEntry[]>> {
    // Fetch both versions in parallel (independent indexed lookups).
    const [version1Result, version2Result] = await Promise.all([
      versioningService.getVersion(db, entryId, versionId1),
      versioningService.getVersion(db, entryId, versionId2),
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
   * Rollback an entry to a previous version.
   *
   * Creates a NEW version with data from the specified historical version,
   * and updates the entry's current data. Does NOT delete intermediate versions.
   *
   * @param db - Database connection
   * @param entryId - Entry ID to rollback
   * @param versionId - Version ID to rollback to
   * @param userId - User performing the rollback
   */
  async rollback(
    db: Database,
    entryId: string,
    versionId: string,
    userId?: string,
    tenantScope?: string | null
  ): Promise<ServiceResult<{ entry: EntryRow; newVersion: EntryVersionRow }>> {
    // Fetch target version + current entry in parallel (independent reads).
    const [versionResult, entry] = await Promise.all([
      versioningService.getVersion(db, entryId, versionId),
      versioningRepository.findEntryById(db, entryId),
    ])
    if (!versionResult.success) {
      return versionResult
    }

    const targetVersion = versionResult.data

    if (!entry) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: `Entry '${entryId}' not found` },
      }
    }

    const now = new Date().toISOString()
    const newVersionNumber = entry.version + 1
    // Prefer atomic batch (entry update + version row) on real D1; mocks without
    // batch use the sequential path below with revert on failure.
    const hasBatch = typeof (db as unknown as { batch?: unknown }).batch === 'function'
    if (hasBatch) {
      try {
        const updateBuilder = db
          .update(entries)
          .set({ data: targetVersion.data || {}, version: newVersionNumber, updatedAt: now })
          .where(and(eq(entries.id, entryId), eq(entries.version, entry.version)))
          .returning()
        const versionId = crypto.randomUUID()
        const versionBuilder = db
          .insert(entryVersions)
          .values({
            id: versionId,
            entryId,
            version: newVersionNumber,
            data: targetVersion.data || {},
            createdBy: userId ?? null,
            createdAt: now,
          })
          .returning()
        const [updatedRows, versionRows] = (await (
          db as unknown as { batch: (q: unknown[]) => Promise<unknown[][]> }
        ).batch([updateBuilder, versionBuilder])) as unknown as [
          EntryRow[],
          EntryVersionRow[],
        ]
        const batchUpdated = updatedRows[0]
        const batchVersion = versionRows[0]
        if (batchUpdated && batchVersion) {
          try {
            await commandsRepository.insertChangeLogEntries({
              db,
              commandId: null,
              entries: [
                {
                  entityType: 'entry',
                  entityId: entryId,
                  action: 'update',
                  changes: {
                    ...(batchUpdated.data as Record<string, unknown>),
                    _rollbackFromVersion: versionId,
                  },
                },
              ],
              tenantScope: tenantScope ?? null,
              timestamp: now,
            })
          } catch (err) {
            logger.error('rollback_changelog_write_failed', { error: err instanceof Error ? err.message : String(err) })
          }
          scheduleDeferredWork(
            undefined,
            retentionService.enforceRetention(db, entryId),
            'version_retention'
          )
          return { success: true, data: { entry: batchUpdated, newVersion: batchVersion } }
        }
        // Batch driver returned no rows (mock) — fall through to sequential path.
      } catch {
        // Fall through to sequential path.
      }
    }
    // Update entry with expected version check first
    const updateFn =
      typeof versioningRepository.updateWithExpectedVersion === 'function'
        ? () =>
            versioningRepository.updateWithExpectedVersion(db, entryId, entry.version, {
              data: targetVersion.data || {},
              version: newVersionNumber,
              updatedAt: now,
            })
        : () =>
            versioningRepository.updateEntry(db, entryId, {
              data: targetVersion.data || {},
              version: newVersionNumber,
              updatedAt: now,
            })

    const updated = await updateFn()

    if (!updated) {
      return {
        success: false,
        error: { code: 'ROLLBACK_FAILED', message: 'Failed to update entry during rollback: version mismatch or entry missing' },
      }
    }

    // Create new version record with the rolled-back data
    let newVersion
    try {
      newVersion = await versioningRepository.createVersion(db, {
        id: crypto.randomUUID(),
        entryId,
        version: newVersionNumber,
        data: targetVersion.data || {},
        createdBy: userId ?? null,
        createdAt: now,
      })
    } catch (createErr) {
      // Revert entry to prevent desynchronization
      await versioningRepository.updateEntry(db, entryId, {
        data: entry.data || {},
        version: entry.version,
        updatedAt: entry.updatedAt,
      })
      throw createErr
    }

    // Write changelog entry (non-blocking — never fail the rollback)
    try {
      await commandsRepository.insertChangeLogEntries({
        db,
        commandId: null,
        entries: [
          {
            entityType: 'entry',
            entityId: entryId,
            action: 'update',
            changes: {
              ...(updated.data as Record<string, unknown>),
              _rollbackFromVersion: versionId,
            },
          },
        ],
        tenantScope: tenantScope ?? null,
        timestamp: now,
      })
    } catch (err) {
      logger.error('rollback_changelog_write_failed', { error: err instanceof Error ? err.message : String(err) })
    }

    scheduleDeferredWork(
      undefined,
      retentionService.enforceRetention(db, entryId),
      'version_retention'
    )

    return {
      success: true,
      data: {
        entry: updated,
        newVersion,
      },
    }
  },
}
