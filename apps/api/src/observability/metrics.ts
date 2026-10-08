const counters = new Map<string, number>()

function normalizeLabelKey(labels: Record<string, string>): string {
  const serialized = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(',')
  return serialized || 'none'
}

export class RequestMetrics {
  private counters = new Map<string, number>()

  private normalizeKey(name: string, labels: Record<string, string>): string {
    const labelKey = normalizeLabelKey(labels)
    return `${name}|${labelKey}`
  }

  increment(name: string, labels: Record<string, string> = {}) {
    const key = this.normalizeKey(name, labels)
    const value = (this.counters.get(key) ?? 0) + 1
    this.counters.set(key, value)
  }

  flush(sink: MetricSink) {
    for (const [key, value] of this.counters.entries()) {
      const [rawName, ...labelParts] = key.split('|')
      if (!rawName) {
        continue
      }
      const labels: Record<string, string> = {}
      if (labelParts.length > 0 && labelParts[0] !== 'none') {
        for (const part of labelParts.join('|').split(',')) {
          const [k, v] = part.split('=')
          if (k && v !== undefined) {
            labels[k] = v
          }
        }
      }
      sink(rawName, labels, value)
    }
    this.counters.clear()
  }

  snapshot(): Map<string, number> {
    return new Map(this.counters)
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
    const value = (this.counters.get(key) ?? 0) + 1
    this.counters.set(key, value)
    try {
      this.metricSink?.(name, labels, value)
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
  const value = (counters.get(key) ?? 0) + 1
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
