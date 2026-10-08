type CacheEntry = {
  value: unknown
  sizeBytes: number
  expiresAtMs: number
  lastAccessedMs: number
}

type MemoryCacheStats = {
  entryCount: number
  sizeBytes: number
  maxSizeBytes: number
}

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

  constructor(opts: { maxSizeBytes: number }) {
    this.maxSizeBytes = opts.maxSizeBytes
  }

  get(key: string): unknown | null {
    const entry = this.entries.get(key)
    if (!entry) return null

    if (entry.expiresAtMs <= Date.now()) {
      this.delete(key)
      return null
    }

    entry.lastAccessedMs = Date.now()
    return cloneValue(entry.value)
  }

  set(key: string, value: unknown, ttlSeconds: number): void {
    this.delete(key)

    const cloned = cloneValue(value)
    const sizeBytes = estimateSizeBytes(cloned)

    this.evictUntilFits(sizeBytes)

    this.entries.set(key, {
      value: cloned,
      sizeBytes,
      expiresAtMs: Date.now() + Math.max(1, ttlSeconds) * 1000,
      lastAccessedMs: Date.now(),
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
    let oldestKey: string | null = null
    let oldestAccess = Number.POSITIVE_INFINITY

    for (const [key, entry] of this.entries) {
      if (entry.lastAccessedMs < oldestAccess) {
        oldestAccess = entry.lastAccessedMs
        oldestKey = key
      }
    }

    if (oldestKey) {
      this.delete(oldestKey)
    }
  }
}
