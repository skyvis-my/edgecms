# Autonomous Agent Handoff Prompt: Multi-Layer EdgeCMS Performance Audit & Optimization

> **Purpose**: Copy-paste this prompt into an autonomous agent session (e.g., Claude Code, Antigravity, or Codex) or pass it to a subagent team to execute a systematic, multi-angle performance audit, bottleneck remediation, and verification across the EdgeCMS ecosystem.

---

```markdown
You are a Principal Edge Systems Performance Engineer working on EdgeCMS (`skyvis-my/edgecms` and `skyvis-my/edgecms-saas`).

Your objective is to conduct a rigorous, multi-angle, multi-layer performance audit across the entire system, eliminate latency and resource bottlenecks, implement concrete optimizations, and produce verified before/after measurements against PRD §11.1 targets.

---

### Core Objectives & Targets (PRD §11.1)

1. **Cached Public Read Server Wall Time**: < 50 ms p50 (Target: < 20 ms via CDN/Cache API).
2. **Worker CPU per Cached Request**: < 5 ms p50 (Target: 0 ms on CDN hit, < 3 ms on Worker cache hit).
3. **CDN-Served Share of Public Traffic**: > 90% (Currently ~0% due to missing Cache API layer, DL-03).
4. **Zero-Overhead Middleware**: Eliminate unnecessary D1 and KV round-trips prior to cache resolution (DL-10).
5. **Predictable Cloudflare Cost Envelope (P6)**: Zero runaway KV write amplification or unindexed D1 queries.
6. **Zero Quality Regressions**: All quality gates must pass (`bun run check:all`, `check-release-readiness.sh`).

---

### Multi-Angle Layered Investigation Playbook

Investigate, profile, and optimize across the following 6 layers in order:

#### Layer 1: Edge CDN & Cloudflare Cache API (DL-03)
- **Diagnosis**: Verify why responses setting `CDN-Cache-Control` and `Cache-Tag` do not populate Cloudflare's edge cache (`cf-cache-status: none`).
- **Action**:
  - Inspect `apps/api/src/runtime/` and entrypoint handlers.
  - Implement explicit Cloudflare Cache API integration (`caches.default.match()` and `caches.default.put()`) for cacheable 200 GET public reads.
  - Ensure Cache API writes are non-blocking via `ctx.waitUntil()`.
  - Add weak `ETag` generation based on content version + snapshot timestamp to return HTTP 304 Not Modified.
  - Verify cache-tag invalidation semantics during content mutation events.

#### Layer 2: Middleware & Request Pipeline (DL-10)
- **Diagnosis**: Profile `tenant.middleware.ts`, `tenant-rate-limits.ts`, and Better-Auth session middleware.
- **Action**:
  - Identify and eliminate the per-request D1 query `SELECT * FROM tenants WHERE slug = ?`.
  - Implement an in-isolate bounded memory LRU cache for tenant metadata (TTL: 10–30s) with negative caching for invalid slugs.
  - Bypass session cookie authentication middleware on `/api/tenants/:slug/public/*`.
  - Benchmark replacing KV-backed rate limiting with the Cloudflare Workers Rate Limiting native binding (`[[ratelimiting]]`).

#### Layer 3: Data Tier & Storage Access (D1, KV, R2)
- **Diagnosis**:
  - Audit D1 query execution plans on uncached paths and write mutations.
  - Check for N+1 query patterns during relational content hydration and schema snapshot loading.
  - Verify that KV metric writes remain strictly opt-in (`EDGE_METRICS_KV_SINK=1`).
  - Audit R2 asset delivery: ensure media assets leverage signed CDN URLs or edge caching rather than proxying raw bytes through Worker CPU.

#### Layer 4: Elysia Application & Serialization Engine
- **Diagnosis**:
  - Measure JSON serialization overhead and TypeBox schema validation costs on high-frequency routes.
  - Audit route dispatch overhead in `apps/api/src/app.ts`.
  - Ensure `Server-Timing` headers accurately report granular breakdown (`middleware;dur=...`, `db;dur=...`, `cache;dur=...`).

#### Layer 5: Worker Compute, V8 Isolate & Memory Envelope
- **Diagnosis**:
  - Profile cold-start overhead vs warm-isolate execution via `wrangler tail --format json`.
  - Measure heap usage and garbage collection pauses during large collection exports or batch updates.
  - Check bundle size of the compiled worker output; tree-shake unused dependencies.

#### Layer 6: Frontend Admin & Client SDK Performance
- **Diagnosis**:
  - Measure Vite production bundle sizes in `apps/admin/dist` and verify dynamic route chunking.
  - Verify `@edgecms/client` bundle footprint and TipTap ProseMirror HTML/AST serializer throughput.
  - Check TanStack Query cache stale-times to prevent client-side refetch storms.

---

### Non-Negotiable Invariants

1. **Principle P5 (Safety)**: Public reads MUST NEVER return draft, scheduled (future), or soft-deleted content.
2. **Principle P4 (Tenant Boundary)**: Tenant isolation must remain mathematically guaranteed; cache keys and in-memory caches must always be tenant-scoped.
3. **Change Control (§12)**: Every product behavior modification must cite a requirement ID from `PRD.md` or `SAAS-PRD.md` (e.g. `PRD: DL-03, DL-10, P6`).
4. **Quality Gates**: `bun run check:all` and `RELEASE_SCOPE=library bash ./scripts/check-release-readiness.sh` must exit 0 before concluding.

---

### Execution Steps & Workflow

1. **Preflight Benchmark Baseline**:
   - Run in-process benchmarks: `bun test apps/api/src/tests/benchmarks/api-hot-paths.bench.test.ts`
   - Run local HTTP baseline: `bun run perf:public-read:local -- --path /api/tenants/smoke/public/smoke-posts --expected-kind list`
   - (If staging credentials available) Run remote staging benchmark and capture `wrangler tail` logs.
2. **Execute Root-Cause Optimization**:
   - Tackle Layer 1 (CDN Cache API) and Layer 2 (Tenant / Middleware caching).
   - Keep code modular, strictly typed, and covered by unit/regression tests.
3. **Post-Optimization Verification**:
   - Re-run benchmarks and compare latency percentiles (p50, p95, p99), CPU time, and server wall time.
   - Run full quality suite: `bun run check:all`.
4. **Deliverables**:
   - Produce a concise before/after comparative scorecard against PRD §11.1 targets.
   - Summarize code changes, architectural decisions, and remaining roadmap recommendations.
```
