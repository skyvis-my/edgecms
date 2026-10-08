import { collectionsRepository } from '@/collections/collections.repository'
import type { Database } from '@/database/db'
import { entriesRepository } from '@/entries/entries.repository'

export const publicRepository = {
  async findCollectionBySlug(db: Database, collectionSlug: string, tenantId?: string) {
    return collectionsRepository.findBySlug(db, collectionSlug, tenantId)
  },

  async findFirstVisibleEntryForCollection(db: Database, collectionId: string) {
    const { rows } = await entriesRepository.findVisibleByCollection(db, {
      collectionId,
      page: 1,
      perPage: 1,
    })
    return rows[0]
  },
}
