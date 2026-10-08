import { count, eq } from 'drizzle-orm'
import type { Database } from '@/database/db'
import { collections, entries } from '@/database/schema'

export const systemService = {
  async getStats(db: Database) {
    const [collectionCount, entryCount, publishedCount] = await Promise.all([
      db.select({ count: count() }).from(collections).then((r) => r[0]?.count ?? 0),
      db.select({ count: count() }).from(entries).then((r) => r[0]?.count ?? 0),
      db
        .select({ count: count() })
        .from(entries)
        .where(eq(entries.status, 'published'))
        .then((r) => r[0]?.count ?? 0),
    ])

    return {
      collections: collectionCount,
      entries: entryCount,
      publishedEntries: publishedCount,
    }
  },
}
