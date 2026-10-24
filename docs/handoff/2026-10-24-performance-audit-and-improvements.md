# EdgeCMS Performance Audit & Improvements Handoff

**Date**: 2026-10-24  
**Author**: EdgeCMS Core Engineering  
**Branch / Target**: `main` (Post-PR #23, #24, Elysia 2 modernization)  
**Scope**: Public REST, KV/Memory Caching, Middleware Overhead, and Resource Budgets  
**Applicable Repositories**: `edgecms-public` & `edgecms-saas`

---

## 1. Executive Summary

This handoff consolidates the findings, shipped optimizations, and next-phase roadmap from the EdgeCMS API performance audit and benchmarking campaign.

### Key Milestones Delivered (as of 2026-10-24 on `main`)
* **PR #20 Merged**: Fixed tenant path resolution bug (`GET /api/tenants/:slug/public/...`) which previously failed with HTTP 404 or leaked to global scope.
* **PR #23 Merged (`690f007`)**:
  1. **Zero-D1 Public List Cache Hits**: Memoized, lazy collection resolution on public list routes eliminates the unnecessary D1 collection query during memory/KV hits, saving ~14 ms server wall time per hit.
  2. **Opt-in KV Metric Sink**: Replaced unconditional KV writes on metric increments with an opt-in flag (`EDGE_METRICS_KV_SINK=1`). Default runtime uses console logging, saving 2–3 fire-and-forget KV write round-trips per read.
  3. **`Server-Timing` Headers**: Public reads now emit `Server-Timing: cache;desc="<source>";dur=<ms>` for transparent edge-to-client observability.
  4. **Stabilized Benchmark Budgets**: In-process benchmark harnesses (`api-hot-paths.bench.test.ts`) now enforce a 1 ms median budget for hot reads, 5 ms for writes, with 3x tolerance under CI and automatic single re-measurement before failing.
* **PR #24 Merged (`757d800`)**: Updated PRD v3.7 (§11.1 targets, DL-03 marked `Partial`, and added `DL-10` for edge-cached tenant/rate-limit middleware).
* **Modernized Elysia Scope Syntax**: Hook and derive syntax updated to string literals (`'plugin'`) across all controllers and plugins without runtime warnings.

---

## 2. Staging Benchmark Baseline & Audit Evidence

### Staging Environment Setup
* **Deployment**: Cloudflare Workers (`edgecms-api-staging`) in APAC.
* **Database**: Cloudflare D1 (read replication disabled, probe latency ~12 ms).
* **Network Baseline**: `GET /api/health/live` client p50 ~56 ms (from Malaysia hitting Cloudflare SIN colo).
* **Data Volume**: 1 tenant (`smoke`), 1 collection (`smoke-posts`), and 1 published entry (`perf-audit-2026-10-22`).

### Staging Latency & CPU Quantiles (Measured via `wrangler tail` & synthetic load)

| Endpoint | Status | Client p50 | Client p95 | Server Wall p50 | Worker CPU p50 | Cache Source |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| `/api/health/live` (baseline network probe) | 200 | 56 ms | 131 ms | < 1 ms | < 1 ms | – |
| Public Entry (`GET .../smoke-posts/:slug`) | 200 | 96 ms | 131 ms | 38 ms | 6 ms | memory hit |
| Public List (`GET .../smoke-posts`) [Pre-PR #23] | 200 | 112 ms | 165 ms | 52 ms | 5 ms | memory hit (with D1 query) |
| Public List (`GET .../smoke-posts`) [Post-PR #23] | 200 | ~98 ms | ~135 ms | ~38 ms | ~5 ms | zero-D1 memory hit |
| GraphQL Public Query (`POST .../graphql`) | 200 | 61–63 ms | 82–107 ms | ~40 ms | 4–5 ms | D1 (uncached) |
| MCP Tools List (`POST .../api/mcp`) | 200 | 99 ms | 145 ms | ~70 ms | ~8 ms | Uncached session |

### Scorecard Against PRD §11.1 Targets

| PRD Target | Objective | Staging Status | Gap / Analysis |
| :--- | :---: | :---: | :--- |
| **Cached Public Read Latency** | < 50 ms | **Met Server-Side** (38 ms p50) | Client-observed p50 is ~96 ms due to regional internet transit. Server processing is < 40 ms. |
| **Uncached Global Read Latency** | < 100 ms | **Met / Proxy Verified** (~62 ms) | Measured via GraphQL direct-to-D1 query path. |
| **CDN-Served Share of Reads** | > 90% | **0% (Gap DL-03)** | Responses emit `CDN-Cache-Control` and `Cache-Tag`, but no Cache API (`caches.default`) is executed. Every request executes the Worker. |
| **Worker CPU per Cached Request** | < 5 ms | **Borderline** (5–6 ms p50) | All-routes average is 3.2 ms p50; public cached reads hover at 5–6 ms due to upstream middleware. |
| **Local In-Process Read Median** | < 1 ms | **Met** (~0.05–0.2 ms) | Enforced by `scripts/*.bench.test.ts`. |

---

## 3. Bottleneck Analysis: Why Server Wall Time is ~38 ms on Memory Hits

When an entry is fully cached in in-isolate memory LRU (`X-Response-Time: 0ms`), the server still spends ~38 ms wall time before responding. 

### Round-Trip Breakdown per Request:
1. **Tenant Middleware (`tenant.middleware.ts`)**:
   - Queries D1: `SELECT * FROM tenants WHERE slug = ?` (costs ~12–15 ms D1 round-trip).
2. **Host / Rate-Limiting Policy (`tenant-rate-limits.ts`)**:
   - Reads KV counter for rate limits (costs ~10–15 ms KV round-trip).
   - Incurred on **every request**, before cache lookup is reached.
3. **Public Controller & Service (`public.service.ts`)**:
   - Pre-PR #23: Queried D1 for collection metadata on list queries (+14 ms D1 round-trip). **Fixed in PR #23.**
   - Post-PR #23: Memory hit returns in ~0 ms.

**Net Result**: Server wall time on a memory cache hit is almost entirely dominated by upstream D1/KV middleware calls, not the CMS content lookup.

```
Incoming Request -> [1. D1 Tenant Lookup (~14ms)] -> [2. KV Rate Limit (~12ms)] -> [3. Memory Cache Hit (<1ms)] -> 200 OK (Total: ~38ms)
```

---

## 4. Improvements Shipped in Core

### 1. Zero-D1 Public List Cache Hits ([public.service.ts](../../apps/api/src/public/public.service.ts))
* **Problem**: Previously, `getPublicCollectionEntries` fetched the collection record from D1 to validate its existence before checking the KV/memory cache.
* **Fix**: Collection lookup is now deferred into a memoized lazy getter (`resolveCollection()`). When a cached snapshot exists, `resolveCollection` is never evaluated, completely bypassing D1.

### 2. KV Metric Sink Made Opt-In ([metrics.ts](../../apps/api/src/observability/metrics.ts))
* **Problem**: Every public read wrote 2–3 metrics asynchronously to Cloudflare KV, producing background worker I/O and potential KV write costs.
* **Fix**: KV metrics sink is now guarded by `env.EDGE_METRICS_KV_SINK === '1'`. By default, metric reporting routes to the structured console sink, preserving zero background KV writes.

### 3. Server-Timing Instrumentation
* Emits standard HTTP `Server-Timing` headers on public responses:
  ```http
  Server-Timing: cache;desc="memory";dur=0
  ```
  Permits real-time monitoring of whether responses originated from in-memory LRU, Cloudflare KV, or D1 origin.

---

## 5. Next Optimization Roadmap (High Impact)

To transition EdgeCMS from **Borderline/Partial** to **Production-Grade Scale**, the following architectural initiatives are scheduled under PRD v3.7:

### Phase 1: Real Edge CDN Cache Layer (`DL-03`)
* **Problem**: Currently, 0% of traffic is served by the Cloudflare CDN edge cache because workers.dev subdomains and naked Worker responses do not automatically persist to the edge cache without explicit Cache API calls.
* **Solution**:
  1. Implement `caches.default.match(req)` at the head of the Worker request pipeline.
  2. For cacheable 200 GET public responses, store the response via `ctx.waitUntil(caches.default.put(req, res.clone()))`.
  3. Generate weak `ETag` headers derived from snapshot `version` + `generatedAt` to serve HTTP 304 Not Modified.
  4. Use custom domains on Cloudflare Zones to enable edge caching and Cache-Tag purging.
* **Expected Impact**: > 90% CDN cache hit ratio, reducing Worker invocations, dropping edge latency to < 20 ms, and cutting CPU time to 0 ms for CDN hits.

### Phase 2: In-Isolate Tenant Caching (`DL-10`)
* **Problem**: D1 is queried for tenant row metadata on every single public request (`SELECT * FROM tenants WHERE slug = ?`).
* **Solution**:
  - Implement a bounded LRU cache in Worker isolate memory (TTL: 10–30s) for active tenant records.
  - Implement negative caching (TTL: 5s) for nonexistent tenant slugs to reject traffic floods without hitting D1.
* **Expected Impact**: Eliminates 12–15 ms D1 round-trip on warm isolates.

### Phase 3: Move Rate Limiting to Cloudflare Native Binding
* **Problem**: KV-backed rate limiting requires 1 read + 1 write round trip per request.
* **Solution**:
  - Adopt Cloudflare Workers Rate Limiting binding (`[[ratelimiting]]`) configured in `wrangler.toml`.
* **Expected Impact**: Offloads counter management to native Cloudflare infrastructure, removing the ~12 ms KV read latency.

### Phase 4: Skip Session Auth on Public Routes
* **Problem**: `app.ts` evaluates Better-Auth session cookies across routes that have public read policies.
* **Solution**: Short-circuit authentication middleware entirely for `/api/tenants/:slug/public/*`.

---

## 6. Verification & Benchmark Runbook

### Running Local Benchmarks
```bash
# In edgecms-public or edgecms-saas:
# 1. Run in-process microbenchmarks
bun test apps/api/src/tests/benchmarks/api-hot-paths.bench.test.ts

# 2. Run local HTTP public read benchmark (requires local dev server on port 8787)
bun run dev:api
bun run perf:public-read:local -- --path /api/tenants/smoke/public/smoke-posts --expected-kind list
```

### Running Remote Benchmark on Staging
```bash
# 1. Execute remote public read benchmark
bun run perf:public-read:remote -- \
  --base-url https://edgecms-api-staging.cheongnanfeng.workers.dev \
  --path /api/tenants/smoke/public/smoke-posts \
  --expected-kind list

# 2. Monitor real-time Worker CPU and wall time
npx wrangler tail edgecms-api-staging --format json
```

### Quality Gate Certification
Before committing any performance enhancements, verify all release gates pass:
```bash
bun run check:all
RELEASE_SCOPE=library bash ./scripts/check-release-readiness.sh
```
