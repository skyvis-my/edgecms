import { commandsRepository } from '@/commands/commands.repository'
import type { Database } from '@/database/db'
import { logger } from '@/observability/logger'
import type { EntryRow, EntryVersionRow } from '@/entries/entries.repository'
import type { ServiceResult } from '@/shared/types/result'
import { versioningRepository } from './versioning.repository'

/** Diff entry for version comparison. */
export interface VersionDiffEntry {
  field: string
  before: unknown
  after: unknown
  action: 'add' | 'update' | 'remove'
}

/** Paginated version list result. */
export interface VersionListResult {
  versions: EntryVersionRow[]
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
    const page = options.page ?? 1
    const perPage = options.limit ?? 20
    const offset = (page - 1) * perPage

    // Verify entry exists
    const entry = await versioningRepository.findEntryById(db, entryId)
    if (!entry) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: `Entry '${entryId}' not found` },
      }
    }

    // Get all versions for the entry (ordered by version DESC in repository)
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

    // Find all versions and locate the specific one
    const versions = await versioningRepository.findVersions(db, entryId)
    const version = versions.find((v) => v.id === versionId)

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
    // Get both versions
    const version1Result = await versioningService.getVersion(db, entryId, versionId1)
    if (!version1Result.success) {
      return version1Result
    }

    const version2Result = await versioningService.getVersion(db, entryId, versionId2)
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
    // Get the target version
    const versionResult = await versioningService.getVersion(db, entryId, versionId)
    if (!versionResult.success) {
      return versionResult
    }

    const targetVersion = versionResult.data

    // Get current entry
    const entry = await versioningRepository.findEntryById(db, entryId)
    if (!entry) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: `Entry '${entryId}' not found` },
      }
    }

    const now = new Date().toISOString()
    const newVersionNumber = entry.version + 1

    // Create new version record with the rolled-back data
    const newVersion = await versioningRepository.createVersion(db, {
      id: crypto.randomUUID(),
      entryId,
      version: newVersionNumber,
      data: targetVersion.data || {},
      createdBy: userId ?? null,
      createdAt: now,
    })

    // Update entry with data from target version
    const updated = await versioningRepository.updateEntry(db, entryId, {
      data: targetVersion.data || {},
      version: newVersionNumber,
      updatedAt: now,
    })

    if (!updated) {
      return {
        success: false,
        error: { code: 'ROLLBACK_FAILED', message: 'Failed to update entry during rollback' },
      }
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

    return {
      success: true,
      data: {
        entry: updated,
        newVersion,
      },
    }
  },
}
