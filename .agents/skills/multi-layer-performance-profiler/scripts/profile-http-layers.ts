#!/usr/bin/env bun
/**
 * Multi-Layer HTTP Profiler for EdgeCMS
 *
 * Measures edge latency, TTFB, Server-Timing, Cache API headers, and quantiles
 * against PRD §11.1 performance targets.
 *
 * Usage:
 *   bun profile-http-layers.ts --url <url> [--samples 40] [--delay 100]
 */

interface Sample {
  durationMs: number
  status: number
  bytes: number
  cfCacheStatus: string
  cacheControl: string
  cdnCacheControl: string
  serverTiming: string
  etag: string
  cacheSource: string
}

function parseArgs(): { url: string; samples: number; delayMs: number } {
  const args = process.argv.slice(2)
  let url = ''
  let samples = 30
  let delayMs = 100

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) {
      url = args[++i]
    } else if (args[i] === '--samples' && args[i + 1]) {
      samples = parseInt(args[++i], 10)
    } else if (args[i] === '--delay' && args[i + 1]) {
      delayMs = parseInt(args[++i], 10)
    }
  }

  if (!url) {
    console.error('Error: --url is required.\nExample: bun profile-http-layers.ts --url http://localhost:8787/api/tenants/smoke/public/posts')
    process.exit(1)
  }

  return { url, samples, delayMs }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const index = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))]
}

async function run(): Promise<void> {
  const { url, samples, delayMs } = parseArgs()
  console.log(`\n=== EdgeCMS Multi-Layer HTTP Profiler ===`)
  console.log(`Target URL : ${url}`)
  console.log(`Samples    : ${samples} requests (sequential, ${delayMs}ms interval)\n`)

  // 1. Cold warmup request
  console.log('Sending cold request...')
  const coldStart = performance.now()
  const coldRes = await fetch(url)
  const coldDuration = performance.now() - coldStart
  await coldRes.arrayBuffer()
  console.log(`Cold latency: ${coldDuration.toFixed(1)} ms (status: ${coldRes.status})\n`)

  // 2. Sample collection loop
  const collected: Sample[] = []
  process.stdout.write('Collecting samples: ')

  for (let i = 0; i < samples; i++) {
    if (delayMs > 0 && i > 0) {
      await new Promise((r) => setTimeout(r, delayMs))
    }

    const start = performance.now()
    const res = await fetch(url)
    const buf = await res.arrayBuffer()
    const durationMs = performance.now() - start

    collected.push({
      durationMs,
      status: res.status,
      bytes: buf.byteLength,
      cfCacheStatus: res.headers.get('cf-cache-status') ?? 'none',
      cacheControl: res.headers.get('cache-control') ?? 'none',
      cdnCacheControl: res.headers.get('cdn-cache-control') ?? 'none',
      serverTiming: res.headers.get('server-timing') ?? 'none',
      etag: res.headers.get('etag') ?? 'none',
      cacheSource: res.headers.get('x-edgecms-cache') ?? res.headers.get('x-cache-source') ?? 'none',
    })

    process.stdout.write('.')
  }
  console.log(' Done.\n')

  // 3. Compute stats
  const latencies = collected.map((s) => s.durationMs).sort((a, b) => a - b)
  const p50 = percentile(latencies, 50)
  const p90 = percentile(latencies, 90)
  const p95 = percentile(latencies, 95)
  const p99 = percentile(latencies, 99)
  const min = latencies[0]
  const max = latencies[latencies.length - 1]
  const avg = latencies.reduce((sum, v) => sum + v, 0) / latencies.length

  const last = collected[collected.length - 1]

  console.log('--- Latency Distribution (Client-Observed) ---')
  console.log(`  Min      : ${min.toFixed(1)} ms`)
  console.log(`  p50      : ${p50.toFixed(1)} ms`)
  console.log(`  p90      : ${p90.toFixed(1)} ms`)
  console.log(`  p95      : ${p95.toFixed(1)} ms`)
  console.log(`  p99      : ${p99.toFixed(1)} ms`)
  console.log(`  Max      : ${max.toFixed(1)} ms`)
  console.log(`  Average  : ${avg.toFixed(1)} ms`)

  console.log('\n--- Edge & Cache Telemetry (Last Response) ---')
  console.log(`  HTTP Status        : ${last.status}`)
  console.log(`  Payload Size       : ${last.bytes} bytes`)
  console.log(`  cf-cache-status    : ${last.cfCacheStatus}`)
  console.log(`  Server-Timing      : ${last.serverTiming}`)
  console.log(`  Internal Cache     : ${last.cacheSource}`)
  console.log(`  Cache-Control      : ${last.cacheControl}`)
  console.log(`  CDN-Cache-Control  : ${last.cdnCacheControl}`)
  console.log(`  ETag               : ${last.etag}`)

  console.log('\n--- PRD §11.1 Target Verification ---')
  const cdnServed = collected.filter((s) => s.cfCacheStatus.toUpperCase() === 'HIT').length
  const cdnRatio = (cdnServed / collected.length) * 100

  console.log(`  [${p50 < 100 ? 'PASS' : 'WARN'}] Client p50 latency < 100ms: ${p50.toFixed(1)} ms`)
  console.log(`  [${cdnRatio >= 90 ? 'PASS' : 'GAP'}] CDN-served ratio > 90%: ${cdnRatio.toFixed(1)}% (DL-03 gap if 0%)`)
  console.log(`  [${last.serverTiming !== 'none' ? 'PASS' : 'WARN'}] Server-Timing emitted: ${last.serverTiming}`)
  console.log('========================================\n')
}

run().catch((err) => {
  console.error('Benchmark failed:', err)
  process.exit(1)
})
