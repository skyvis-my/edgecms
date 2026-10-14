const counters = new Map<string, number>()
const MAX_METRIC_SERIES = 2000

function normalizeLabelKey(labels: Record<string, string>): string {
  const serialized = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(',')
  return serialized || 'none'
}

export class RequestMetrics {
  private readonly entries = new Map<string, { name: string; labels: Record<string, string>; count: number }>()

  private normalizeKey(name: string, labels: Record<string, string>): string {
    const labelKey = normalizeLabelKey(labels)
    return `${name}|${labelKey}`
  }

  increment(name: string, labels: Record<string, string> = {}) {
    const key = this.normalizeKey(name, labels)
    const existing = this.entries.get(key)
    if (existing) {
      existing.count += 1
      return
    }
    if (this.entries.size >= MAX_METRIC_SERIES) return
    this.entries.set(key, { name, labels: { ...labels }, count: 1 })
  }

  flush(sink: MetricSink) {
    for (const entry of this.entries.values()) {
      sink(entry.name, entry.labels, entry.count)
    }
    this.entries.clear()
  }

  snapshot(): Map<string, number> {
    const out = new Map<string, number>()
    for (const [key, entry] of this.entries) {
      out.set(key, entry.count)
    }
    return out
  }
}

export function createRequestMetrics(): RequestMetrics {
  return new RequestMetrics()
}

export function createConsoleMetricSink(): MetricSink {
  return (name: string, labels: Record<string, string>, value: number) => {
    console.log(
      JSON.stringify({
        type: 'metric',
        name,
        labels,
        value,
        timestamp: new Date().toISOString(),
      })
    )
  }
}

export function createKvMetricSink(kv: KVNamespace, prefix = 'metrics'): MetricSink {
  return (name: string, labels: Record<string, string>, value: number) => {
    const key = `${prefix}:${name}:${normalizeLabelKey(labels)}`
    const payload = JSON.stringify({ name, labels, value })
    void kv.put(key, payload)
  }
}

export function createCompositeMetricSink(...sinks: Array<MetricSink | undefined>): MetricSink {
  return (name: string, labels: Record<string, string>, value: number) => {
    for (const sink of sinks) {
      sink?.(name, labels, value)
    }
  }
}

export type MetricSink = (name: string, labels: Record<string, string>, value: number) => void

export class MetricsRegistry {
  private counters = new Map<string, number>()
  private metricSink: MetricSink | undefined

  constructor(sink?: MetricSink) {
    this.metricSink = sink
  }

  setSink(sink: MetricSink | undefined): void {
    this.metricSink = sink
  }

  getSink(): MetricSink | undefined {
    return this.metricSink
  }

  increment(name: string, labels: Record<string, string> = {}): void {
    const key = normalizeKey(name, labels)
    const existing = this.counters.get(key)
    if (existing !== undefined) {
      const value = existing + 1
      this.counters.set(key, value)
      try {
        this.metricSink?.(name, labels, value)
      } catch {
        // Never let telemetry failures affect runtime behavior.
      }
      return
    }
    // Bound long-lived isolates: drop new series past the cap (sink still fires).
    if (this.counters.size >= MAX_METRIC_SERIES) {
      try {
        this.metricSink?.(name, labels, 1)
      } catch {
        // Never let telemetry failures affect runtime behavior.
      }
      return
    }
    this.counters.set(key, 1)
    try {
      this.metricSink?.(name, labels, 1)
    } catch {
      // Never let telemetry failures affect runtime behavior.
    }
  }

  get(name: string, labels: Record<string, string> = {}): number {
    return this.counters.get(normalizeKey(name, labels)) ?? 0
  }

  snapshot(): Map<string, number> {
    return new Map(this.counters)
  }

  clear(): void {
    this.counters.clear()
    this.metricSink = undefined
  }
}

export function createMetricsRegistry(sink?: MetricSink): MetricsRegistry {
  return new MetricsRegistry(sink)
}

export const defaultMetricsRegistry = createMetricsRegistry()

function normalizeKey(name: string, labels: Record<string, string>): string {
  const labelKey = normalizeLabelKey(labels)
  return `${name}|${labelKey}`
}

export function incrementMetric(name: string, labels: Record<string, string> = {}) {
  const key = normalizeKey(name, labels)
  const existing = counters.get(key)
  if (existing === undefined && counters.size >= MAX_METRIC_SERIES) {
    defaultMetricsRegistry.increment(name, labels)
    return
  }
  const value = (existing ?? 0) + 1
  counters.set(key, value)
  defaultMetricsRegistry.increment(name, labels)
}

export function getMetric(name: string, labels: Record<string, string> = {}): number {
  return counters.get(normalizeKey(name, labels)) ?? 0
}

export function setMetricSink(
  sink: MetricSink | undefined
) {
  defaultMetricsRegistry.setSink(sink)
}

export function resetMetrics() {
  counters.clear()
  defaultMetricsRegistry.clear()
}

export const metrics = {
  get cache_hits_total() {
    return getMetric('cache_hits_total', { layer: 'kv' })
  },
  get cache_misses_total() {
    return getMetric('cache_misses_total', { layer: 'kv' })
  },
  get cache_hits_total_memory() {
    return getMetric('cache_hits_total', { layer: 'memory' })
  },
  get cache_misses_total_memory() {
    return getMetric('cache_misses_total', { layer: 'memory' })
  },
  get ai_gateway_requests_total() {
    return getMetric('ai_gateway_requests_total')
  },
}
