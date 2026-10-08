export const CACHE_NAMESPACE = {
  CONTENT: 'content',
  COLLECTION: 'collection',
  CORS: 'cors',
  API: 'api',
} as const

export type CacheNamespace = (typeof CACHE_NAMESPACE)[keyof typeof CACHE_NAMESPACE]

const MEMORY_TTL_SECONDS: Record<CacheNamespace, number> = {
  content: 60,
  collection: 300,
  cors: 300,
  api: 30,
}

const DEFAULT_MEMORY_TTL_SECONDS = 30

export function getMemoryTTL(namespace: CacheNamespace): number {
  return MEMORY_TTL_SECONDS[namespace] ?? DEFAULT_MEMORY_TTL_SECONDS
}
