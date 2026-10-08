export type PerformanceGoalsSnapshot = {
  cachedApiP95Ms: number
  globalApiP95Ms: number
  imageUploadPipelineP95Ms: number
  imageVariantCdnP95Ms: number
  offlineSyncRecoveryP95Ms: number
  cacheHits: number
  cacheMisses: number
}

export type PerformanceGoalStatus = {
  goal: string
  target: string
  actual: number
  passed: boolean
}

export const PUBLIC_READ_PERFORMANCE_GOALS = {
  localP95Ms: 50,
  deployedP95Ms: 100,
} as const

export function computeCacheHitRatio(cacheHits: number, cacheMisses: number): number {
  const total = cacheHits + cacheMisses
  if (total <= 0) return 0
  return cacheHits / total
}

export function evaluatePerformanceGoals(
  snapshot: PerformanceGoalsSnapshot
): PerformanceGoalStatus[] {
  const cacheHitRatio = computeCacheHitRatio(snapshot.cacheHits, snapshot.cacheMisses)
  return [
    {
      goal: 'Cached API latency',
      target: `<= ${PUBLIC_READ_PERFORMANCE_GOALS.localP95Ms}ms`,
      actual: snapshot.cachedApiP95Ms,
      passed: snapshot.cachedApiP95Ms <= PUBLIC_READ_PERFORMANCE_GOALS.localP95Ms,
    },
    {
      goal: 'Global API latency',
      target: `<= ${PUBLIC_READ_PERFORMANCE_GOALS.deployedP95Ms}ms`,
      actual: snapshot.globalApiP95Ms,
      passed: snapshot.globalApiP95Ms <= PUBLIC_READ_PERFORMANCE_GOALS.deployedP95Ms,
    },
    {
      goal: 'Cache hit ratio',
      target: '>= 80%',
      actual: Number((cacheHitRatio * 100).toFixed(2)),
      passed: cacheHitRatio >= 0.8,
    },
    {
      goal: 'Image upload + WASM processing pipeline latency',
      target: '< 3000ms',
      actual: snapshot.imageUploadPipelineP95Ms,
      passed: snapshot.imageUploadPipelineP95Ms < 3000,
    },
    {
      goal: 'Image variant CDN delivery latency',
      target: '<= 50ms',
      actual: snapshot.imageVariantCdnP95Ms,
      passed: snapshot.imageVariantCdnP95Ms <= 50,
    },
    {
      goal: 'Offline sync recovery latency',
      target: '< 5000ms',
      actual: snapshot.offlineSyncRecoveryP95Ms,
      passed: snapshot.offlineSyncRecoveryP95Ms < 5000,
    },
  ]
}
