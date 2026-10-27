import { drizzle } from 'drizzle-orm/d1'

/**
 * Creates a typed Drizzle ORM instance configured for Cloudflare D1.
 *
 * This function accepts the D1 binding from the Cloudflare Worker environment
 * and returns a Drizzle instance ready for querying. It is designed to be
 * called from ElysiaJS route handlers that have access to the Worker env.
 *
 * @example
 * ```ts
 * import { createDb } from '@/database/db'
 *
 * // In an ElysiaJS route handler with access to env:
 * const db = createDb(env.DB)
 * const results = await db.select().from(someTable)
 * ```
 */
export interface CreateDbOptions {
  sessionBookmark?: string
  sessionToken?: string
}

export function createDb(d1: D1Database, options?: CreateDbOptions) {
  let targetD1 = d1
  const bookmark = options?.sessionBookmark ?? options?.sessionToken
  if (bookmark && typeof (d1 as unknown as { withSession?: (s: string) => D1Database }).withSession === 'function') {
    targetD1 = (d1 as unknown as { withSession: (s: string) => D1Database }).withSession(bookmark)
  }
  return drizzle(targetD1)
}

/** The Drizzle D1 instance type, for use in repositories and service layers. */
export type Database = ReturnType<typeof createDb>
