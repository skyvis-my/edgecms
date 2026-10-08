export type CacheSource = 'memory' | 'kv' | 'origin'
export type CacheStatus = 'HIT' | 'MISS' | 'STALE'

export class CacheMetadataTracker {
  private status: CacheStatus = 'MISS'
  private source: CacheSource = 'origin'
  private readonly startMs = Date.now()

  recordHit(source: 'memory' | 'kv'): void {
    this.status = 'HIT'
    this.source = source
  }

  recordStale(source: 'memory' | 'kv' = 'kv'): void {
    this.status = 'STALE'
    this.source = source
  }

  recordMiss(): void {
    this.status = 'MISS'
    this.source = 'origin'
  }

  getStatus(): CacheStatus {
    return this.status
  }

  getSource(): CacheSource {
    return this.source
  }

  toHeaders(): Record<string, string> {
    return {
      'X-Cache-Status': this.status,
      'X-Cache-Source': this.source,
      'X-Response-Time': `${Date.now() - this.startMs}ms`,
      'x-edgecms-cache': this.status.toLowerCase(),
    }
  }
}
