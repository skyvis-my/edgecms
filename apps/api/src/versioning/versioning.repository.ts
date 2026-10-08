import type { Database } from '@/database/db'
import { entriesRepository } from '@/entries/entries.repository'

export const versioningRepository = {
  async findEntryById(db: Database, entryId: string) {
    return entriesRepository.findById(db, entryId)
  },

  async findVersions(db: Database, entryId: string) {
    return entriesRepository.findVersions(db, entryId)
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
}
