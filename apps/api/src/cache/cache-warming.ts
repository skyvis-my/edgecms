import type { Database } from '@/database/db'
import { logger } from '@/observability/logger'

type CollectionInfo = {
  id: string
  slug: string
  singleton: boolean
  defaultLocale: string
}

type WarmCacheParams = {
  db: Database
  kv: KVNamespace
  getCollections: (db: Database) => Promise<CollectionInfo[]>
  getCollectionList: (params: {
    db: Database
    kv: KVNamespace
    collectionSlug: string
    locale: string
    page: number
    perPage: number
  }) => Promise<unknown>
  getSingletonEntry: (params: {
    db: Database
    kv: KVNamespace
    collectionSlug: string
    locale: string
  }) => Promise<unknown>
}

type WarmCacheResult = { warmed: number; failed: number }

export async function warmPublicCache(params: WarmCacheParams): Promise<WarmCacheResult> {
  const { db, kv, getCollections, getCollectionList, getSingletonEntry } = params

  const collections = await getCollections(db)
  let warmed = 0
  let failed = 0

  for (const collection of collections) {
    try {
      if (collection.singleton) {
        await getSingletonEntry({
          db,
          kv,
          collectionSlug: collection.slug,
          locale: collection.defaultLocale,
        })
      } else {
        await getCollectionList({
          db,
          kv,
          collectionSlug: collection.slug,
          locale: collection.defaultLocale,
          page: 1,
          perPage: 20,
        })
      }
      warmed++
    } catch (err) {
      failed++
      logger.warn('cache_warm_failed', {
        collection: collection.slug,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  logger.info('cache_warming_complete', { warmed, failed, total: collections.length })
  return { warmed, failed }
}
