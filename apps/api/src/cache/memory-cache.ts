type CacheEntry = {
  value: unknown
  sizeBytes: number
  expiresAtMs: number
}

type MemoryCacheStats = {
  entryCount: number
  sizeBytes: number
  maxSizeBytes: number
}

/** Single oversized snapshots must never evict the whole isolate cache. */
export const MEMORY_CACHE_PER_ENTRY_MAX_BYTES = 1 * 1024 * 1024 // 1 MB

function cloneValue<T>(value: T): T {
  try {
    return structuredClone(value)
  } catch {
    return JSON.parse(JSON.stringify(value)) as T
  }
}

function estimateSizeBytes(value: unknown): number {
  return JSON.stringify(value).length * 2
}

export class LRUMemoryCache {
  private readonly entries = new Map<string, CacheEntry>()
  private currentSizeBytes = 0
  private readonly maxSizeBytes: number
  private readonly perEntryMaxBytes: number

  constructor(opts: { maxSizeBytes: number; perEntryMaxBytes?: number }) {
    this.maxSizeBytes = opts.maxSizeBytes
    this.perEntryMaxBytes = opts.perEntryMaxBytes ?? MEMORY_CACHE_PER_ENTRY_MAX_BYTES
  }

  get(key: string): unknown | null {
    const entry = this.entries.get(key)
    if (!entry) return null

    if (entry.expiresAtMs <= Date.now()) {
      this.delete(key)
      return null
    }

    // O(1) LRU promotion via Map insertion order: re-insert as most-recent.
    this.entries.delete(key)
    this.entries.set(key, entry)
    return cloneValue(entry.value)
  }

  /**
   * O(1) read for immutable snapshots: promotes via Map order and returns
   * the stored reference without a structuredClone. Callers must treat the
   * result as read-only (snapshots are frozen at write time).
   */
  getFrozen(key: string): unknown | null {
    const entry = this.entries.get(key)
    if (!entry) return null

    if (entry.expiresAtMs <= Date.now()) {
      this.delete(key)
      return null
    }

    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.value
  }

  set(key: string, value: unknown, ttlSeconds: number): void {
    this.delete(key)

    const cloned = cloneValue(value)
    const sizeBytes = estimateSizeBytes(cloned)
    if (sizeBytes > this.maxSizeBytes || sizeBytes > this.perEntryMaxBytes) return

    this.evictUntilFits(sizeBytes)

    this.entries.set(key, {
      value: cloned,
      sizeBytes,
      expiresAtMs: Date.now() + Math.max(1, ttlSeconds) * 1000,
    })
    this.currentSizeBytes += sizeBytes
  }

  /**
   * Zero-clone write: stores `value` by reference with a caller-provided
   * size (already-serialized byte length). Skips JSON.stringify +
   * structuredClone entirely. Oversized entries are dropped to bound isolates.
   */
  setFrozen(key: string, value: unknown, ttlSeconds: number, sizeBytes: number): void {
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return
    if (sizeBytes > this.maxSizeBytes || sizeBytes > this.perEntryMaxBytes) return
    this.delete(key)
    this.evictUntilFits(sizeBytes)
    this.entries.set(key, {
      value,
      sizeBytes,
      expiresAtMs: Date.now() + Math.max(1, ttlSeconds) * 1000,
    })
    this.currentSizeBytes += sizeBytes
  }

  delete(key: string): void {
    const entry = this.entries.get(key)
    if (entry) {
      this.currentSizeBytes -= entry.sizeBytes
      this.entries.delete(key)
    }
  }

  clear(): void {
    this.entries.clear()
    this.currentSizeBytes = 0
  }

  stats(): MemoryCacheStats {
    return {
      entryCount: this.entries.size,
      sizeBytes: this.currentSizeBytes,
      maxSizeBytes: this.maxSizeBytes,
    }
  }

  private evictUntilFits(incomingBytes: number): void {
    while (
      this.currentSizeBytes + incomingBytes > this.maxSizeBytes &&
      this.entries.size > 0
    ) {
      this.evictLeastRecentlyUsed()
    }
  }

  private evictLeastRecentlyUsed(): void {
    // Map preserves insertion order: first key is the least-recently-used.
    const oldestKey = this.entries.keys().next().value as string | undefined
    if (oldestKey !== undefined) {
      this.delete(oldestKey)
    }
  }
}
