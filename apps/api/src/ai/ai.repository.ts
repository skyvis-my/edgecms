import type { Database } from '@/database/db'
import { buildContextPackFromDb } from './context/context-builder'

export const aiRepository = {
  async buildContextPack(
    db: Database,
    params: { collectionSlug?: string; entryId?: string; tenantId?: string; locale: string }
  ) {
    return buildContextPackFromDb({
      db,
      collectionSlug: params.collectionSlug,
      entryId: params.entryId,
      tenantId: params.tenantId,
      locale: params.locale,
    })
  },
}
