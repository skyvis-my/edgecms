import { eq } from 'drizzle-orm'
import type { Database } from '@/database/db'
import { entryVersions } from '@/database/schema'
import { type EntryVersionRow, entriesRepository } from '@/entries/entries.repository'

/** Retention policy configuration. */
export interface RetentionConfig {
  /** Maximum number of versions to keep per entry (default: 50). */
  maxVersions: number
  /** Maximum age in days for versions (default: 90). */
  maxAgeDays: number
}

/** Default retention policy configuration. */
const DEFAULT_RETENTION_CONFIG: RetentionConfig = {
  maxVersions: 50,
  maxAgeDays: 90,
}

/** Result of retention enforcement. */
export interface RetentionResult {
  deleted: number
  kept: number
  reason: string
}

/**
 * Service for enforcing version retention policies.
 *
 * Implements dual retention policy:
 * - Keep-N: Maximum 50 versions per entry (configurable)
 * - Time-based: Delete versions older than 90 days (configurable)
 *
 * NEVER deletes the current (latest) version regardless of policies.
 */
export const retentionService = {
  /**
   * Enforce retention policies for an entry.
   *
   * Should be called after each new version creation.
   * Applies both keep-N and time-based policies.
   *
   * @param db - Database connection
   * @param entryId - Entry ID to enforce retention for
   * @param config - Optional retention configuration (uses defaults if not provided)
   */
  async enforceRetention(
    db: Database,
    entryId: string,
    config: Partial<RetentionConfig> = {}
  ): Promise<RetentionResult> {
    const { maxVersions, maxAgeDays } = { ...DEFAULT_RETENTION_CONFIG, ...config }

    // Get current entry to determine latest version
    const entry = await entriesRepository.findById(db, entryId)
    if (!entry) {
      return { deleted: 0, kept: 0, reason: 'Entry not found' }
    }

    // Get all versions for the entry (ordered by version DESC)
    const allVersions = await entriesRepository.findVersions(db, entryId)
    if (allVersions.length === 0) {
      return { deleted: 0, kept: 0, reason: 'No versions to clean up' }
    }

    // Identify the current version (matches entry.version)
    const currentVersion = allVersions.find((v) => v.version === entry.version)
    const versionsToConsider = allVersions.filter((v) => v.id !== currentVersion?.id)

    // Apply time-based policy: mark old versions for deletion
    const now = new Date()
    const cutoffDate = new Date(now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000)

    const oldVersions = versionsToConsider.filter((v) => {
      const createdAt = new Date(v.createdAt)
      return createdAt < cutoffDate
    })

    // Apply keep-N policy: keep only the most recent N versions (excluding current)
    // Sort by version DESC to keep newest
    const sortedVersions = [...versionsToConsider].sort((a, b) => b.version - a.version)
    const excessVersions = sortedVersions.slice(maxVersions)

    // Combine both policies: delete versions that are either old OR excess
    const versionsToDelete = new Set<string>([
      ...oldVersions.map((v) => v.id),
      ...excessVersions.map((v) => v.id),
    ])

    // Delete marked versions
    let deleted = 0
    for (const versionId of versionsToDelete) {
      await db.delete(entryVersions).where(eq(entryVersions.id, versionId))
      deleted++
    }

    const kept = allVersions.length - deleted

    return {
      deleted,
      kept,
      reason: `Deleted ${deleted} versions (${oldVersions.length} old, ${excessVersions.length} excess). Kept ${kept} versions.`,
    }
  },

  /**
   * Get versions marked for deletion by retention policies (dry-run).
   *
   * Useful for previewing what would be deleted without actually deleting.
   *
   * @param db - Database connection
   * @param entryId - Entry ID
   * @param config - Optional retention configuration
   */
  async previewRetention(
    db: Database,
    entryId: string,
    config: Partial<RetentionConfig> = {}
  ): Promise<{ toDelete: EntryVersionRow[]; toKeep: EntryVersionRow[] }> {
    const { maxVersions, maxAgeDays } = { ...DEFAULT_RETENTION_CONFIG, ...config }

    // Get current entry
    const entry = await entriesRepository.findById(db, entryId)
    if (!entry) {
      return { toDelete: [], toKeep: [] }
    }

    // Get all versions
    const allVersions = await entriesRepository.findVersions(db, entryId)
    if (allVersions.length === 0) {
      return { toDelete: [], toKeep: [] }
    }

    // Identify current version (never delete)
    const currentVersion = allVersions.find((v) => v.version === entry.version)
    const versionsToConsider = allVersions.filter((v) => v.id !== currentVersion?.id)

    // Apply time-based policy
    const now = new Date()
    const cutoffDate = new Date(now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000)

    const oldVersions = versionsToConsider.filter((v) => {
      const createdAt = new Date(v.createdAt)
      return createdAt < cutoffDate
    })

    // Apply keep-N policy
    const sortedVersions = [...versionsToConsider].sort((a, b) => b.version - a.version)
    const excessVersions = sortedVersions.slice(maxVersions)

    // Combine both policies
    const versionsToDeleteSet = new Set<string>([
      ...oldVersions.map((v) => v.id),
      ...excessVersions.map((v) => v.id),
    ])

    const toDelete = allVersions.filter((v) => versionsToDeleteSet.has(v.id))
    const toKeep = allVersions.filter((v) => !versionsToDeleteSet.has(v.id))

    return { toDelete, toKeep }
  },
}
