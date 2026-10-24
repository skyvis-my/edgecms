---
name: multi-layer-performance-profiler
description: Multi-angle performance audit, profiling, and optimization skill for EdgeCMS across CDN cache, middleware, D1/KV queries, Worker compute, and client rendering. Activate when tasks mention edge latency, Server-Timing, Cache API, D1/KV bottlenecks, PRD §11.1 targets, or executing performance benchmarks.
---

# Multi-Layer Performance Profiler

## Goal

Activate for any performance audit, profiling task, latency complaint, or edge optimization ticket across EdgeCMS (`apps/api`, `apps/admin`, `packages/*`). 

Systematically analyze and optimize the 6 architectural performance layers of the edge runtime:
1. **Edge CDN & Cloudflare Cache API (`DL-03`)**
2. **Middleware & Request Pipeline Overhead (`DL-10`)**
3. **Data Tier & Storage Access (D1, KV, R2)**
4. **Elysia Routing, Validation & Serialization**
5. **Worker Compute, V8 Isolate & Memory Envelope (§11.1)**
6. **Frontend Admin & Client SDK Rendering**

---

## 1. Architectural Layers & Investigation Areas

```
[ Visitor / Client ]
         │
         ▼
┌────────────────────────────────────────────────────────┐
│ Layer 1: Edge CDN (Cloudflare Edge / Cache API)        │ <- caches.default, ETag, 304, cf-cache-status
└────────────────────────┬───────────────────────────────┘
                         │ (Edge CDN Miss / Worker Invocation)
                         ▼
┌────────────────────────────────────────────────────────┐
│ Layer 2: Request Pipeline & Middleware                 │ <- Tenant resolution, rate-limits, session auth
└────────────────────────┬───────────────────────────────┘
                         │
                         ▼
┌────────────────────────────────────────────────────────┐
│ Layer 4: Elysia Application & Validation               │ <- TypeBox validation, JSON serialization, Server-Timing
└────────────────────────┬───────────────────────────────┘
                         │
                         ▼
┌────────────────────────────────────────────────────────┐
│ Layer 3: Data Tier (D1 SQLite, KV Cache, R2 Assets)    │ <- In-memory LRU -> KV snapshot -> D1 database
└────────────────────────────────────────────────────────┘
```

### Layer 1: Edge CDN & Cloudflare Cache API (`DL-03`)
* **Objective**: Achieve > 90% CDN-served ratio for public reads; 0 ms Worker CPU on CDN hits.
* **Audit Checks**:
  - Does response include `cf-cache-status: HIT`?
  - Does the Worker execute `caches.default.match(request)` before routing into application controllers?
  - Are public 200 GET responses saved via `ctx.waitUntil(caches.default.put(request, response.clone()))`?
  - Is a weak `ETag` returned (e.g. `W/"<version>-<snapshotTimestamp>"`) to handle `If-None-Match` with HTTP 304?
  - Are cache invalidation tags (`Cache-Tag: collection:<slug>,locale:<loc>`) emitted for Cloudflare purge-by-tag?

### Layer 2: Request Pipeline & Middleware (`DL-10`)
* **Objective**: Zero D1 and KV round-trips before cache resolution.
* **Audit Checks**:
  - **Tenant Resolution**: Check `apps/api/src/tenants/tenant.middleware.ts`. Does every request execute `SELECT * FROM tenants WHERE slug = ?`?
    * *Remediation*: Cache tenant metadata in-isolate with an in-memory LRU (TTL 10–30s). Provide negative caching (TTL 5s) for nonexistent slugs.
  - **Rate Limiting**: Check `apps/api/src/host/tenant-rate-limits.ts`. Does rate limiting perform un-cached KV reads/writes?
    * *Remediation*: Migrate to Cloudflare Workers Rate Limiting native binding (`[[ratelimiting]]`).
  - **Session Auth**: Ensure Better-Auth cookie/session verification is completely skipped on `/api/tenants/:slug/public/*`.

### Layer 3: Data Tier & Storage Access (D1, KV, R2)
* **Objective**: Zero unnecessary D1 database queries; zero background KV write amplification.
* **Audit Checks**:
  - Verify public list queries do not fetch collection records from D1 when snapshot is cached (ensured by lazy `resolveCollection` in `public.service.ts`).
  - Verify metric increments do not write to KV unless explicitly enabled (`EDGE_METRICS_KV_SINK=1`).
  - Check relational entry hydration: ensure relations are resolved via single batched queries rather than N+1 queries.
  - Ensure media assets stream with proper Range headers or presigned R2 direct URLs.

### Layer 4: Elysia Application & Serialization Engine
* **Objective**: Sub-millisecond routing and validation overhead.
* **Audit Checks**:
  - Benchmark TypeBox schema compilation and validation throughput.
  - Verify `Server-Timing` headers emit detailed, standardized telemetry:
    ```http
    Server-Timing: middleware;dur=1.2, cache;desc="memory";dur=0.1, total;dur=3.4
    ```

### Layer 5: Worker Compute & V8 Isolate Envelope (§11.1)
* **Objective**: Worker CPU < 5 ms p50; < 1 ms in-process median hot reads.
* **Audit Checks**:
  - Run `wrangler tail <worker-name> --format json` and inspect `cpuTime` and `wallTime`.
  - Validate against `apps/api/src/tests/benchmarks/api-hot-paths.bench.test.ts`.

### Layer 6: Frontend Admin & Client SDK Performance
* **Objective**: Compact bundles, zero hydration mismatch, responsive editing.
* **Audit Checks**:
  - Verify Vite chunk splitting in `apps/admin/dist`.
  - Check TipTap ProseMirror serialization speed in `@edgecms/client`.
  - Audit TanStack Query cache `staleTime` and deduplication keys.

---

## 2. Invariants & Guardrails

1. **Safety (Principle P5)**: Public reads MUST NEVER return draft, future scheduled, or soft-deleted content.
2. **Tenant Boundary (Principle P4)**: Tenant isolation must remain absolute. In-memory and KV cache keys must always include the `tenantId`.
3. **Change Control (§12)**: Every change impacting product behavior must cite PRD requirement IDs (e.g., `PRD: DL-03, DL-10, P6`).
4. **Merge Gates**: Every commit must pass `bun run check:all` and `RELEASE_SCOPE=library bash ./scripts/check-release-readiness.sh`.

---

## 3. Profiling Scripts in This Skill

Run the specialized profiling scripts bundled with this skill:

```bash
# 1. Profile HTTP layers, latency percentiles, and cache headers (local or remote)
bun .agents/skills/multi-layer-performance-profiler/scripts/profile-http-layers.ts \
  --url https://edgecms-api-staging.cheongnanfeng.workers.dev/api/tenants/smoke/public/smoke-posts \
  --samples 30

# 2. Benchmark middleware lifecycle and in-memory vs D1 overhead
bun .agents/skills/multi-layer-performance-profiler/scripts/benchmark-middleware-cost.ts

# 3. In-process hot-path budget verification
bun test apps/api/src/tests/benchmarks/api-hot-paths.bench.test.ts
```
