import { describe, expect, it } from 'bun:test'
import {
  computeCacheHitRatio,
  evaluatePerformanceGoals,
} from '../../observability/performance-goals'

describe('performance goals', () => {
  it('computes cache hit ratio from hits and misses', () => {
    expect(computeCacheHitRatio(9, 1)).toBe(0.9)
    expect(computeCacheHitRatio(0, 0)).toBe(0)
  })

  it('marks all PRD performance goals as passing when metrics are within budget', () => {
    const statuses = evaluatePerformanceGoals({
      cachedApiP95Ms: 44,
      globalApiP95Ms: 92,
      imageUploadPipelineP95Ms: 2100,
      imageVariantCdnP95Ms: 35,
      offlineSyncRecoveryP95Ms: 4300,
      cacheHits: 90,
      cacheMisses: 10,
    })

    expect(statuses.every((status) => status.passed)).toBe(true)
  })

  it('flags budget breaches when a metric exceeds target', () => {
    const statuses = evaluatePerformanceGoals({
      cachedApiP95Ms: 60,
      globalApiP95Ms: 110,
      imageUploadPipelineP95Ms: 3200,
      imageVariantCdnP95Ms: 75,
      offlineSyncRecoveryP95Ms: 5200,
      cacheHits: 70,
      cacheMisses: 30,
    })

    expect(statuses.find((status) => status.goal === 'Cached API latency')?.passed).toBe(false)
    expect(statuses.find((status) => status.goal === 'Global API latency')?.passed).toBe(false)
    expect(statuses.find((status) => status.goal === 'Cache hit ratio')?.passed).toBe(false)
    expect(
      statuses.find((status) => status.goal === 'Image variant CDN delivery latency')?.passed
    ).toBe(false)
    expect(
      statuses.find((status) => status.goal === 'Image upload + WASM processing pipeline latency')
        ?.passed
    ).toBe(false)
    expect(statuses.find((status) => status.goal === 'Offline sync recovery latency')?.passed).toBe(
      false
    )
  })
})
