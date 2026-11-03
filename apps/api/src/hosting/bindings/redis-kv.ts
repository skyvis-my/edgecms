export type RedisLike = {
  get: (key: string) => Promise<string | null>
  set: (key: string, value: string, ...args: string[]) => Promise<unknown>
  del: (...keys: string[]) => Promise<unknown>
  scan: (cursor: string, ...args: string[]) => Promise<[string, string[]]>
}

function valueToText(value: string | ArrayBuffer | ArrayBufferView): string {
  if (typeof value === 'string') return value
  return new TextDecoder().decode(
    value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  )
}

/**
 * Redis-backed KVNamespace for multi-replica Docker/K8s.
 * Same host cache interface as memory KV / Workers KV binding — not Workers Cache API.
 */
export function createRedisKv(client: RedisLike): KVNamespace {
  const kv = {
    async get(key: string, type?: string) {
      const value = await client.get(key)
      if (value === null) return null
      if (type === 'json') {
        try {
          return JSON.parse(value)
        } catch {
          return null
        }
      }
      if (type === 'arrayBuffer') {
        return new TextEncoder().encode(value).buffer
      }
      return value
    },
    async put(
      key: string,
      value: string | ArrayBuffer | ArrayBufferView,
      options?: { expirationTtl?: number; expiration?: number }
    ) {
      const text = valueToText(value)
      let ttlSeconds: number | undefined
      if (options?.expiration !== undefined) {
        ttlSeconds = Math.floor(options.expiration - Date.now() / 1000)
      } else if (options?.expirationTtl !== undefined) {
        ttlSeconds = Math.floor(options.expirationTtl)
      }

      if (ttlSeconds !== undefined) {
        if (ttlSeconds <= 0) {
          await client.del(key)
          return
        }
        await client.set(key, text, 'EX', String(ttlSeconds))
        return
      }

      await client.set(key, text)
    },
    async delete(key: string) {
      await client.del(key)
    },
    async list(options?: { prefix?: string; limit?: number }) {
      const prefix = options?.prefix ?? ''
      const limit = options?.limit ?? 1000
      const keys: string[] = []
      let cursor = '0'
      do {
        const [next, batch] = await client.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', '100')
        cursor = next
        for (const name of batch) {
          keys.push(name)
          if (keys.length >= limit) break
        }
      } while (cursor !== '0' && keys.length < limit)
      return {
        keys: keys.slice(0, limit).map((name) => ({ name })),
        list_complete: true,
        cacheStatus: null,
      }
    },
    async getWithMetadata(key: string) {
      const value = await kv.get(key)
      return { value, metadata: null, cacheStatus: null }
    },
  }
  return kv as unknown as KVNamespace
}

/**
 * Connect via optional `redis` package. Memory KV is the default compose path;
 * Redis is only required when CACHE_DRIVER=redis (multi-replica).
 */
type RedisPackage = {
  createClient: (opts: { url: string }) => {
    connect: () => Promise<unknown>
    get: (key: string) => Promise<string | null>
    set: (key: string, value: string, opts?: { EX?: number }) => Promise<unknown>
    del: (keys: string[]) => Promise<unknown>
    scan: (
      cursor: number,
      opts: { MATCH?: string; COUNT?: number }
    ) => Promise<{ cursor: number; keys: string[] }>
    quit: () => Promise<unknown>
  }
}

export async function connectRedisUrl(
  url: string
): Promise<RedisLike & { close: () => void }> {
  let redisMod: RedisPackage
  try {
    // Optional peer — not a hard dependency of edgecms-api Workers path.
    redisMod = (await (Function('return import("redis")')() as Promise<unknown>)) as RedisPackage
  } catch {
    throw new Error(
      'CACHE_DRIVER=redis requires the optional npm package "redis". Install it (apps/api optionalDependency) or set CACHE_DRIVER=memory.'
    )
  }
  const client = redisMod.createClient({ url })
  await client.connect()
  return {
    get: (key) => client.get(key),
    set: async (key, value, ...args) => {
      if (args[0] === 'EX' && args[1]) {
        return client.set(key, value, { EX: Number(args[1]) })
      }
      return client.set(key, value)
    },
    del: (...keys) => client.del(keys),
    scan: async (cursor, ...args) => {
      const matchIdx = args.indexOf('MATCH')
      const match = matchIdx >= 0 ? args[matchIdx + 1] : undefined
      const countIdx = args.indexOf('COUNT')
      const count = countIdx >= 0 ? Number(args[countIdx + 1]) : 100
      const result = await client.scan(Number(cursor), {
        MATCH: match,
        COUNT: count,
      })
      return [String(result.cursor), result.keys]
    },
    close: () => {
      void client.quit()
    },
  }
}
