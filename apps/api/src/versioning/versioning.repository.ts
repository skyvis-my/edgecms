import type { Database } from '@/database/db'
import { entriesRepository } from '@/entries/entries.repository'

export const versioningRepository = {
  async findEntryById(db: Database, entryId: string, tenantId?: string) {
    return entriesRepository.findById(db, entryId, tenantId)
  },

  async findVersions(db: Database, entryId: string) {
    return entriesRepository.findVersions(db, entryId)
  },

  async findVersionById(db: Database, versionId: string) {
    return entriesRepository.findVersionById(db, versionId)
  },

  async createVersion(db: Database, data: Parameters<typeof entriesRepository.createVersion>[1]) {
    return entriesRepository.createVersion(db, data)
  },

  async updateEntry(
    db: Database,
    entryId: string,
    data: Parameters<typeof entriesRepository.update>[2]
  ) {
    return entriesRepository.update(db, entryId, data)
  },

  async updateWithExpectedVersion(
    db: Database,
    entryId: string,
    expectedVersion: number,
    data: Parameters<typeof entriesRepository.update>[2]
  ) {
    return entriesRepository.updateWithVersion(
      db,
      entryId,
      expectedVersion,
      data as Parameters<typeof entriesRepository.updateWithVersion>[3]
    )
  },
}
