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

  // Chunked parallel warming (concurrency 5) — avoids serial per-collection latency
  // while bounding simultaneous D1/KV pressure.
  const CHUNK = 5
  for (let i = 0; i < collections.length; i += CHUNK) {
    const chunk = collections.slice(i, i + CHUNK)
    const results = await Promise.allSettled(
      chunk.map((collection) =>
        collection.singleton
          ? getSingletonEntry({
              db,
              kv,
              collectionSlug: collection.slug,
              locale: collection.defaultLocale,
            })
          : getCollectionList({
              db,
              kv,
              collectionSlug: collection.slug,
              locale: collection.defaultLocale,
              page: 1,
              perPage: 20,
            })
      )
    )
    results.forEach((result, idx) => {
      if (result.status === 'fulfilled') {
        warmed++
      } else {
        failed++
        logger.warn('cache_warm_failed', {
          collection: chunk[idx]?.slug,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        })
      }
    })
  }

  logger.info('cache_warming_complete', { warmed, failed, total: collections.length })
  return { warmed, failed }
}
