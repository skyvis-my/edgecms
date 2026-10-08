import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type { Database } from '@/database/db'

const findChangesAfterCursor = mock()
const findLatestSnapshot = mock()
const findExistingChangeLogEntry = mock()
const insertChangeLogEntry = mock()

mock.module('../../collections/schema-snapshots.repository', () => ({
  schemaSnapshotsRepository: {
    findLatestSnapshot,
  },
}))

mock.module('../../sync/sync.repository', () => ({
  syncRepository: {
    findChangesAfterCursor,
    findExistingChangeLogEntry,
    insertChangeLogEntry,
  },
}))

const { pullSyncChanges } = await import(`../../sync/sync.service?bypass=${Date.now()}`)

describe('schema snapshot sync', () => {
  beforeEach(() => {
    findChangesAfterCursor.mockReset()
    findLatestSnapshot.mockReset()
    findExistingChangeLogEntry.mockReset()
    insertChangeLogEntry.mockReset()
    findLatestSnapshot.mockResolvedValue(undefined)
    findExistingChangeLogEntry.mockResolvedValue(undefined)
    insertChangeLogEntry.mockResolvedValue(undefined)
  })

  it('includes schema snapshots in sync pull', async () => {
    const snapshot = {
      id: 's1',
      tenantId: 'global',
      schemaVersion: 1,
      payload: { fields: [] },
      createdAt: new Date().toISOString(),
    }

    findLatestSnapshot.mockResolvedValueOnce(snapshot)
    findExistingChangeLogEntry.mockResolvedValueOnce(undefined)

    findChangesAfterCursor.mockResolvedValueOnce([
      {
        sequence: 1,
        id: 'change-1',
        entityType: 'schema_snapshot',
        entityId: 's1',
        commandId: null,
        changeType: 'upsert',
        payload: snapshot,
        timestamp: new Date().toISOString(),
      },
    ])

    const db = {} as unknown as Database

    const res = await pullSyncChanges({
      db,
      cursor: 0,
      limit: 10,
    })

    expect(
      res.changes.some((change: { entityType?: string }) => change.entityType === 'schema_snapshot')
    ).toBe(true)
    expect(insertChangeLogEntry).toHaveBeenCalledTimes(1)
  })
})
