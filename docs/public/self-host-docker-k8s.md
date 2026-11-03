# Self-host: Docker, Kubernetes, and Postgres (OSS)

EdgeCMS’s primary product path remains **Cloudflare Workers + D1 + KV + R2**. This document is the **optional OSS / on-prem hosting path**: Docker, Kubernetes, Postgres, and S3-compatible object storage — without proprietary Cloudflare-only assumptions on that path. It does not change NG1 (Workers remains the default runtime).

| Path | When to choose |
| --- | --- |
| **Workers (default)** | Edge delivery, Atomic Edge Promote against Workers Cache/KV, managed D1/R2/Queues/DO. Follow [deployment runbook](../deployment-runbook.md) / `wrangler`. |
| **Docker / K8s + Postgres** | Self-host / air-gapped / existing Postgres+S3 ops. You accept reduced edge parity (see blockers below). |

## Quick start (Docker Compose)

```bash
cp deploy/docker/.env.example deploy/docker/.env
# set BETTER_AUTH_SECRET (≥32 chars)
docker compose -f deploy/docker/docker-compose.yml --env-file deploy/docker/.env up --build
```

- API + admin SPA: `http://localhost:8787` (API serves `apps/admin/dist`)
- Postgres: `localhost:5432`
- MinIO console: `http://localhost:9001`

Optional split admin nginx: `docker compose ... --profile split-admin up`.

Optional Redis for multi-replica shared CACHE (KV stand-in):

```bash
# in deploy/docker/.env
CACHE_DRIVER=redis
REDIS_URL=redis://redis:6379
docker compose -f deploy/docker/docker-compose.yml --env-file deploy/docker/.env --profile redis up --build
```

## Bun-only (no Docker)

```bash
cd apps/api
export DATABASE_DRIVER=postgres   # or sqlite
export DATABASE_URL=postgres://edgecms:edgecms@127.0.0.1:5432/edgecms
export BETTER_AUTH_SECRET="$(openssl rand -base64 48)"
export SIGNUP_POLICY=disabled
export SUPER_ADMIN_REQUIRE_MFA=true
bun run hosting:migrate
bun run hosting:serve
```

`hosting:build` bundles the server with a Bun plugin that resolves `cloudflare:workers` to an in-process env shim so the same controllers run outside workerd. The Workers/wrangler build is unchanged and must not use that shim.

## Kubernetes

Plain manifests (Kustomize):

```bash
kubectl apply -k deploy/k8s
```

Helm:

```bash
helm upgrade --install edgecms deploy/helm/edgecms \
  --namespace edgecms --create-namespace \
  --set secrets.BETTER_AUTH_SECRET="…" \
  --set secrets.DATABASE_URL="postgres://…" \
  --set ingress.host=cms.example.com
```

Replace placeholder secrets before production. Image `ghcr.io/skyvis-my/edgecms-api:oss` is built from `deploy/docker/Dockerfile.api`.

Shared CACHE on Kubernetes:

- **Helm:** `--set redis.enabled=true` (in-chart Redis) or `--set redis.enabled=true --set redis.externalUrl=redis://:pass@my-redis:6379`. Chart ConfigMap then sets `CACHE_DRIVER=redis` + `REDIS_URL`. Raise `replicaCount` only after Redis is wired.
- **Kustomize:** uncomment `redis.yaml` in `deploy/k8s/kustomization.yaml`, set `CACHE_DRIVER=redis` and `REDIS_URL=redis://redis:6379` (or an external URL) on the API ConfigMap/Secret.

## Redis shared cache (multi-replica)

On the OSS Bun path, `env.CACHE` is a **KVNamespace-shaped** adapter (snapshots, pointers, rate-limit counters, etc.). Default is **in-process memory** — fine for one API replica, wrong for HA.

| Setting | Behavior |
| --- | --- |
| `CACHE_DRIVER` unset / `memory`, and no `REDIS_URL` / `REDIS_HOST` | **Memory KV** (single replica, L1-only) |
| `CACHE_DRIVER` unset + `REDIS_URL` or `REDIS_HOST` set | **Redis L2** + default **in-process L1** (two-tier) |
| `CACHE_DRIVER=redis` | Same two-tier — requires `REDIS_URL` or `REDIS_HOST` (+ optional port/password/db) |
| `CACHE_DRIVER=redis` + `CACHE_L1_ENABLED=false` | **Redis-only** (shared L2, no per-process L1) |
| `CACHE_DRIVER=memory` with Redis env present | Stays **memory** (explicit override) |

### Two-tier KV (L1 memory + L2 Redis)

When Redis is selected, EdgeCMS wraps Redis with an in-process memory tier by default (`createTwoTierKv`):

| Tier | Store | Scope |
| --- | --- | --- |
| **L1** | In-process memory KV | Per API replica / process |
| **L2** | Redis | Shared across replicas |

| Policy | Behavior |
| --- | --- |
| **Read-through** | `get` checks L1 → miss → L2 → populate L1 |
| **Write-through** (default `CACHE_WRITE_MODE`) | `put` writes L2 then L1 |
| **Write-invalidate** | `put` writes L2 and deletes L1 (next `get` refill) |
| **Delete** | Clears both tiers |
| **List** | Always L2 (authoritative key inventory) |

**TTL / invalidation honesty**

- L2 TTL follows the caller's `expirationTtl` / `expiration` (same as Workers KV).
- L1 TTL defaults to **30s** (`CACHE_L1_TTL_SECONDS`) and is **capped at 60s** (`CACHE_L1_MAX_TTL_SECONDS`) even when L2 TTL is longer — keeps per-replica memory short so cross-replica lag after promote/invalidate stays bounded.
- Versioned snapshot invalidation (increment collection/locale version) still applies on top via `kv.service`; L1 entries for old version keys age out via TTL.
- Cross-replica L1 lag is bounded by L1 TTL (or immediate on write-through to the writing replica). Other replicas see L2 immediately; their L1 may serve a stale value until TTL or local delete.

Env (Bun / Docker / K8s only — Workers keep the KV binding):

| Variable | Notes |
| --- | --- |
| `CACHE_DRIVER` | `memory` \| `redis` |
| `REDIS_URL` | Preferred, e.g. `redis://:pass@redis:6379/0` |
| `REDIS_HOST` | Alternative to URL |
| `REDIS_PORT` | Default `6379` |
| `REDIS_PASSWORD` | Optional; encoded into URL |
| `REDIS_DB` | Optional logical DB index |
| `CACHE_L1_ENABLED` | Default `true` when Redis; set `false` for Redis-only |
| `CACHE_L1_TTL_SECONDS` | Default `30` — L1 read-through / put default TTL |
| `CACHE_L1_MAX_TTL_SECONDS` | Default `60` — hard cap on L1 TTL |
| `CACHE_WRITE_MODE` | `write-through` (default) \| `write-invalidate` |

The optional npm package `redis` is an `optionalDependency` of `edgecms-api` (used only when Redis is selected).

### Mapping vs Workers Cache / KV

| Cloudflare Workers | OSS Bun hosting |
| --- | --- |
| KV binding `env.CACHE` + isolate LRU in `kv.service` / isolate memos | Memory (L1-only) **or** two-tier memory L1 + Redis L2 (`createTwoTierKv`) |
| Workers Cache API (`caches.default` + Cache-Tags) | **Absent** — no edge CDN HIT path on Docker/K8s |
| Atomic Edge Promote tag purge (`CF_API_TOKEN` + zone) | N/A on OSS; Redis shares the **application** KV layer across replicas |

Redis does **not** replace Workers Cache. Prefer Workers when published-plane edge HIT ratio matters; use Redis (+ default L1) when you scale OSS API replicas and need a shared application cache / channel-pointer store with per-process hot reads.

## OSS object storage + CDN (Strapi / R2 style)

Wait for OSS means: **assets live on S3-compatible storage; public URLs can use a different CDN base.** Same pattern as Strapi upload provider + CDN URL, or Cloudflare R2 + custom domain.

```text
Browser / published site
        │  GET https://cdn.example.com/tenants/…/asset.webp
        ▼
   CDN / custom domain          ← CDN_BASE_URL (public)
        │  origin pull
        ▼
   MinIO / AWS S3 / Alibaba OSS / R2   ← S3_ENDPOINT (private API)
```

| Role | Env | Example |
| --- | --- | --- |
| Storage API (writes) | `S3_ENDPOINT` / `OSS_ENDPOINT` | `https://oss-ap-southeast-1.aliyuncs.com` or `http://minio:9000` |
| Bucket + credentials | `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (or `OSS_*`) | |
| Path-style (MinIO) | `S3_FORCE_PATH_STYLE=true` | |
| **Public / CDN origin** | **`CDN_BASE_URL`** (preferred) or `MEDIA_PUBLIC_BASE_URL` | `https://cdn.example.com` |

Rules:

1. **`CDN_BASE_URL` must be an origin** (scheme + host, no path). Put Cloudflare, Fastly, nginx, or Alibaba CDN in front of the bucket; do not paste a path-style MinIO URL here.
2. Object keys in the bucket are unchanged; public URLs are `${CDN_BASE_URL}/${objectKey}`.
3. Workers path: set `CDN_BASE_URL` or `MEDIA_PUBLIC_BASE_URL` to the R2 custom domain — same resolver (`resolveMediaPublicBaseFromEnv`).
4. Leaving CDN unset falls back to Worker `/api/.../public/assets/...` routes (no separate media host).

### Strapi ↔ EdgeCMS mapping

| Strapi-style | EdgeCMS |
| --- | --- |
| `providerOptions.endpoint` / AWS endpoint | `S3_ENDPOINT` / `OSS_ENDPOINT` |
| Bucket + keys | `S3_BUCKET` + access/secret (or `OSS_*`) |
| `providerOptions.cdn` / `url` (public base) | **`CDN_BASE_URL`** (alias `CDN_PUBLIC_BASE_URL`, legacy `MEDIA_PUBLIC_BASE_URL`) |
| Cloudflare R2 + custom domain | Workers: R2 binding + `CDN_BASE_URL`/`MEDIA_PUBLIC_BASE_URL`; OSS path: MinIO/S3/OSS + CDN |

See also [Media economics (MD-06)](media.md#media-economics-md-06).

## OSS configuration (env / feature flags)

| Variable | Workers | Docker/K8s | Notes |
| --- | --- | --- | --- |
| `DATABASE_DRIVER` | n/a (D1) | `postgres` \| `sqlite` | Postgres needs `DATABASE_URL` |
| `DATABASE_URL` | — | required for postgres | e.g. `postgres://user:pass@host:5432/db` |
| `SQLITE_PATH` | — | file path | When `DATABASE_DRIVER=sqlite` |
| `CACHE_DRIVER` | KV binding | `memory` \| `redis` | Unset + no Redis env → memory; Redis defaults to two-tier L1+L2 — see [Redis shared cache](#redis-shared-cache-multi-replica) |
| `REDIS_URL` | — | preferred for redis | Or use `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` / `REDIS_DB` |
| `REDIS_HOST` (+ port/password/db) | — | alt to URL | Builds `redis://…` when `REDIS_URL` unset |
| `CACHE_L1_ENABLED` / `CACHE_L1_TTL_SECONDS` / `CACHE_L1_MAX_TTL_SECONDS` / `CACHE_WRITE_MODE` | — | optional | Two-tier toggles when Redis; defaults on / 30s / 60s / write-through |
| `MEDIA_DRIVER` | R2 binding | `filesystem` \| `s3` | S3 covers MinIO / AWS / Alibaba OSS |
| `S3_*` / `OSS_*` | — | endpoint, keys, bucket | Write/origin only — not public URLs |
| **`CDN_BASE_URL`** | recommended | recommended | Public CDN origin; preferred over `MEDIA_PUBLIC_BASE_URL` |
| `CDN_PUBLIC_BASE_URL` | alias | alias | Same as `CDN_BASE_URL` |
| `MEDIA_PUBLIC_BASE_URL` | optional | optional | Legacy public media origin (R2 custom domain) |
| `BETTER_AUTH_SECRET` | secret | **required** (≥32) | Same as Workers |
| `SIGNUP_POLICY` | `open`/`invite-only`/`disabled` | prefer `disabled` for new OSS deploys | HS-01 |
| `SUPER_ADMIN_EMAILS` | optional | bootstrap owners | |
| `SUPER_ADMIN_REQUIRE_MFA` | optional | prefer `true` | HS-11 |
| `ENTRA_CLIENT_ID` / `ENTRA_CLIENT_SECRET` / `ENTRA_TENANT_ID` | optional | optional | Microsoft Entra admin OIDC (same as Workers) |
| `ENTRA_REDIRECT_URI` | optional | optional | Must match `${BASE_URL}/api/auth/callback/microsoft` when set |
| `SSO_MODE` / `SSO_*` | optional | optional | Env forwarded only; full SSO/SAML packaging stays host-side (saas) |
| `ENABLE_*` AI / cache warm | same flags | same | Prefer off until configured |
| `CF_API_TOKEN` / dedicated provision | Workers only | unused | HS-03 dedicated D1/KV/R2 N/A |

### Microsoft Entra ID

OIDC admin login uses the same Better Auth microsoft provider as Workers. Compose and Helm/K8s pass `ENTRA_*` through to the API process (`apps/api/src/hosting/config.ts` passthrough).

```bash
# deploy/docker/.env (or Helm --set secrets.ENTRA_CLIENT_SECRET=…)
ENTRA_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
ENTRA_CLIENT_SECRET=your-client-secret
ENTRA_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx   # prefer directory GUID
BASE_URL=https://cms.example.com
# Register this reply URL on the Entra app:
# https://cms.example.com/api/auth/callback/microsoft
```

Full checklist: [Authentication And Access → Microsoft Entra ID setup](auth-and-access.md#microsoft-entra-id-setup-workers--self-host).

Schema:

- Workers: `apps/api/drizzle/migrations` (SQLite / D1)
- Postgres: `apps/api/drizzle/postgres` (checked-in baseline; review after schema changes)

Code entrypoints: `apps/api/src/hosting/` (adapters + `server.ts`).

## Choosing Workers vs Docker/K8s+Postgres

1. Need global edge cache, KV snapshot CAS promote, R2 media CDN, Queues, Durable Object exact-time publish → **Workers**.
2. Need bring-your-own Postgres / S3 / cluster ops, or Cloudflare is unavailable → **Docker/K8s**.
3. Hybrid is not supported in-process: one runtime per deployment. Content migration between D1 and Postgres is an ops concern (export/import), not an automatic bridge.

## Hard blockers / parity gaps (honest)

Full Cloudflare feature parity is **not** claimed on the OSS path:

| Workers binding | OSS stand-in | Gap |
| --- | --- | --- |
| D1 | Postgres D1-facade or bun:sqlite file | SQL dialect differences; regenerate/review PG baseline after schema changes; `db.batch` is transactional but not D1-identical |
| KV (`env.CACHE`) | Memory (default) or Redis L2 + in-process L1 (default when `CACHE_DRIVER=redis`) | Memory is not multi-replica; two-tier shares L2 across replicas with per-process L1 — still not a global edge / Workers Cache |
| R2 | Filesystem or S3-compatible | No Cloudflare Image Transformations / zone Cache Rules — put your own CDN in front via `CDN_BASE_URL` |
| Workers Cache API (`caches.default`) | absent | Published CDN HIT path is Workers-only — Redis ≠ Workers Cache |
| Queues | In-process queue | Lost on crash; no CF retry/backoff telemetry |
| Durable Objects (PublishScheduler) | In-memory DO shim | Alarm state not durable across restarts (D1/PG schedule intents still sweep) |
| Vectorize | unbound | Semantic asset/release search degraded |
| `SELF` service binding | loopback HTTP via `BASE_URL` | Operator must set reachable URL for warm jobs |
| Smart Placement / Version Metadata | n/a | Deploy id via `EDGECMS_DEPLOY_ID` |
| Dedicated per-tenant D1/KV/R2 (HS-03) | not applicable | Shared DB only on OSS path |

Prefer Workers when Atomic Edge Promote + published-plane economics matter. Prefer Docker/K8s when control-plane self-hosting matters more than edge HIT ratio.

## Related

- [Hosting seams](hosting-seams.md) (`HS-*`)
- [Media](media.md) (MD-06 economics + CDN)
- [Quickstart](quickstart.md) (local Workers/wrangler)
- [Deployment runbook](../deployment-runbook.md) (Cloudflare)
- ADR feasibility note: `docs/adr/2026-09-11-modular-composable-edgecms.md` (Docker as second profile)
