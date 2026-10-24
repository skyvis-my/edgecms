# EdgeCMS Multi-Layer Performance Architecture Reference

This reference explains the execution mechanics of each layer in the EdgeCMS Cloudflare Workers stack, common anti-patterns, and the corresponding design patterns to enforce.

---

## Layer 1: Edge CDN & Cloudflare Cache API (`DL-03`)

### Mechanics
Cloudflare Workers execute *before* or *at* the edge cache depending on routing. On `*.workers.dev` subdomains, Cloudflare does not store Worker responses in the CDN edge cache regardless of `Cache-Control` headers. On custom domains (zones), Cloudflare caches responses only when the Cache API (`caches.default`) is explicitly invoked or Cloudflare Edge Cache Rules match.

### Anti-Pattern
```typescript
// ❌ Anti-pattern: Setting headers without Cache API does not populate edge cache
return new Response(body, {
  headers: { 'CDN-Cache-Control': 'public, max-age=300' }
})
```

### Enforced Pattern
```typescript
// ✅ Enforced pattern: Use caches.default with non-blocking put
const cache = caches.default
const cacheKey = new Request(url, { headers: { 'Accept-Encoding': 'gzip' } })
const cachedResponse = await cache.match(cacheKey)
if (cachedResponse) return cachedResponse

// ... compute response ...
ctx.waitUntil(cache.put(cacheKey, response.clone()))
return response
```

---

## Layer 2: Middleware & Request Pipeline (`DL-10`)

### Mechanics
Elysia executes middlewares (`onRequest`, `derive`, `beforeHandle`) sequentially before reaching route controllers. If any middleware awaits a database or KV lookup, that latency adds directly to the server wall time.

### Anti-Pattern
```typescript
// ❌ Anti-pattern: Querying D1 on every request in middleware
.derive(async ({ params }) => {
  const tenant = await db.select().from(tenants).where(eq(tenants.slug, params.slug)).get()
  return { tenant }
})
```

### Enforced Pattern
```typescript
// ✅ Enforced pattern: Bounded in-isolate memory LRU with negative caching
const tenantCache = new QuickLRU<string, Tenant>({ maxSize: 1000 })

.derive(async ({ params, env }) => {
  let tenant = tenantCache.get(params.slug)
  if (!tenant) {
    tenant = await resolveTenantFromD1(env.DB, params.slug)
    if (tenant) tenantCache.set(params.slug, tenant)
  }
  return { tenant }
})
```

---

## Layer 3: Data Tier & Storage Access

### Mechanics
* **D1**: Serverless SQLite distributed globally with eventual consistency and regional primary writers. Unindexed lookups block the isolate worker loop.
* **KV**: High read throughput (eventually consistent), but writes have propagation latency and incur operations costs. Never write to KV on GET requests.
* **R2**: S3-compatible object storage. Large objects should be streamed or served via presigned URLs, never loaded entirely into isolate RAM.

---

## Layer 4: Serialization & Schemas

### Mechanics
Elysia uses TypeBox for ahead-of-time schema compilation into fast V8 JavaScript validator functions. 

### Best Practices:
* Keep schema compilation outside per-request handlers (compile schemas at module load time).
* Use `Server-Timing` to expose breakdown for APM tools and synthetic testing.

---

## Layer 5: Worker Compute Envelope

### Constraints:
* V8 Isolate memory limit: 128 MB (Standard Workers).
* CPU Wall Time: 50 ms (free) / unlimited (Paid/Unbound), but target is < 5 ms for cold hits and < 1 ms for warm hits.

---

## Layer 6: Admin Frontend & Client SDK

### Best Practices:
* Dynamic imports for TanStack Router routes in `apps/admin`.
* Client SDK `@edgecms/client` tree-shakeable exports (`react.js`, `index.js`).
* Avoid re-fetching unchanging schemas in the admin dashboard by setting `staleTime: 60_000` in TanStack Query.
