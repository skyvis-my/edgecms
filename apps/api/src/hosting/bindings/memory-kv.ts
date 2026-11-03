type KvEntry = {
  value: string
  expiration?: number
}

/**
 * In-process KVNamespace stand-in for Docker/K8s self-host.
 * Not a multi-replica cache — use CACHE_DRIVER=redis (L2) with default L1 wrap
 * (`createTwoTierKv`) when scaling out.
 */
export function createMemoryKv(): KVNamespace {
  const store = new Map<string, KvEntry>()

  function purgeExpired(key: string, entry: KvEntry | undefined): entry is KvEntry {
    if (!entry) return false
    if (entry.expiration !== undefined && entry.expiration <= Date.now() / 1000) {
      store.delete(key)
      return false
    }
    return true
  }

  const kv = {
    async get(key: string, type?: string) {
      const entry = store.get(key)
      if (!purgeExpired(key, entry)) return null
      if (type === 'json') {
        try {
          return JSON.parse(entry.value)
        } catch {
          return null
        }
      }
      if (type === 'arrayBuffer') {
        return new TextEncoder().encode(entry.value).buffer
      }
      return entry.value
    },
    async put(key: string, value: string | ArrayBuffer | ArrayBufferView, options?: { expirationTtl?: number; expiration?: number }) {
      const text =
        typeof value === 'string'
          ? value
          : new TextDecoder().decode(
              value instanceof ArrayBuffer
                ? new Uint8Array(value)
                : new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
            )
      let expiration: number | undefined
      if (options?.expiration !== undefined) expiration = options.expiration
      else if (options?.expirationTtl !== undefined) {
        expiration = Math.floor(Date.now() / 1000) + Math.max(1, Math.floor(options.expirationTtl))
      }
      store.set(key, { value: text, expiration })
    },
    async delete(key: string) {
      store.delete(key)
    },
    async list(options?: { prefix?: string; limit?: number; cursor?: string }) {
      const prefix = options?.prefix ?? ''
      const limit = options?.limit ?? 1000
      const keys = [...store.keys()]
        .filter((k) => k.startsWith(prefix) && purgeExpired(k, store.get(k)))
        .sort()
        .slice(0, limit)
        .map((name) => ({ name }))
      return { keys, list_complete: true, cacheStatus: null }
    },
    async getWithMetadata(key: string) {
      const value = await kv.get(key)
      return { value, metadata: null, cacheStatus: null }
    },
  }

  return kv as unknown as KVNamespace
}
