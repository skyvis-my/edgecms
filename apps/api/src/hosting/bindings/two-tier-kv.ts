export type TwoTierWriteMode = 'write-through' | 'write-invalidate'

export type TwoTierKvOptions = {
  /**
   * L1 TTL used on read-through fill when L2 did not supply an expiration.
   * Also used as the default when put() omits TTL. Default 30s.
   */
  l1DefaultTtlSeconds?: number
  /**
   * Cap for L1 TTL even when L2 expirationTtl is longer. Default 60s.
   * Keeps per-replica memory short-lived so invalidate/write-through honesty stays tight.
   */
  l1MaxTtlSeconds?: number
  /**
   * write-through (default): put writes L2 then L1.
   * write-invalidate: put writes L2 and deletes L1 (next get read-through fills L1).
   */
  writeMode?: TwoTierWriteMode
}

const DEFAULT_L1_TTL_SECONDS = 30
const DEFAULT_L1_MAX_TTL_SECONDS = 60

function clampL1Ttl(
  requestedSeconds: number | undefined,
  defaultSeconds: number,
  maxSeconds: number
): number {
  const base =
    requestedSeconds !== undefined && Number.isFinite(requestedSeconds)
      ? Math.floor(requestedSeconds)
      : defaultSeconds
  return Math.max(1, Math.min(base, maxSeconds))
}

function putOptionsFromTtl(ttlSeconds: number): { expirationTtl: number } {
  return { expirationTtl: ttlSeconds }
}

/**
 * Two-tier KVNamespace: L1 in-process (fast, per-replica) + L2 shared (Redis / Workers KV).
 *
 * Read-through: get checks L1, misses fall through to L2 and populate L1.
 * Writes: write-through (default) or write-invalidate. delete always clears both.
 * list always hits L2 (authoritative key inventory).
 *
 * Workers already layer isolate LRU (`kv.service`) + Workers Cache API on top of
 * the KV binding; this adapter is the OSS Redis path equivalent at the binding.
 */
export function createTwoTierKv(
  l1: KVNamespace,
  l2: KVNamespace,
  options: TwoTierKvOptions = {}
): KVNamespace {
  const l1DefaultTtlSeconds = options.l1DefaultTtlSeconds ?? DEFAULT_L1_TTL_SECONDS
  const l1MaxTtlSeconds = options.l1MaxTtlSeconds ?? DEFAULT_L1_MAX_TTL_SECONDS
  const writeMode: TwoTierWriteMode = options.writeMode ?? 'write-through'

  const kv = {
    async get(key: string, type?: string) {
      const fromL1 = await l1.get(key as never, type as never)
      if (fromL1 !== null && fromL1 !== undefined) return fromL1

      const fromL2 = await l2.get(key as never, type as never)
      if (fromL2 === null || fromL2 === undefined) return null

      // Read-through fill: always re-fetch string form for L1 storage so typed
      // get(json|arrayBuffer) callers still go through L1/L2 get correctly next time.
      const ttl = clampL1Ttl(undefined, l1DefaultTtlSeconds, l1MaxTtlSeconds)
      try {
        const textForL1 =
          type === undefined || type === 'text'
            ? typeof fromL2 === 'string'
              ? fromL2
              : String(fromL2)
            : ((await l2.get(key)) as string | null)
        if (textForL1 !== null) {
          await l1.put(key, textForL1, putOptionsFromTtl(ttl))
        }
      } catch {
        // Soft-fail L1 fill — L2 value still returns.
      }
      return fromL2
    },

    async put(
      key: string,
      value: string | ArrayBuffer | ArrayBufferView,
      putOpts?: { expirationTtl?: number; expiration?: number }
    ) {
      await l2.put(key, value as never, putOpts as never)

      if (writeMode === 'write-invalidate') {
        await l1.delete(key)
        return
      }

      let requestedTtl: number | undefined
      if (putOpts?.expirationTtl !== undefined) {
        requestedTtl = putOpts.expirationTtl
      } else if (putOpts?.expiration !== undefined) {
        requestedTtl = putOpts.expiration - Math.floor(Date.now() / 1000)
      }
      const ttl = clampL1Ttl(requestedTtl, l1DefaultTtlSeconds, l1MaxTtlSeconds)
      await l1.put(key, value as never, putOptionsFromTtl(ttl))
    },

    async delete(key: string) {
      await Promise.all([l2.delete(key), l1.delete(key)])
    },

    async list(options?: { prefix?: string; limit?: number; cursor?: string }) {
      return l2.list(options as never)
    },

    async getWithMetadata(key: string, type?: string) {
      const value = await kv.get(key, type)
      return { value, metadata: null, cacheStatus: null }
    },
  }

  return kv as unknown as KVNamespace
}
