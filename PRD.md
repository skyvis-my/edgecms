# EdgeCMS Product Requirements

Version: 3.8 (2026-11-05)
Owner: EdgeCMS maintainers
Status: Living document. Every feature PR cites a requirement ID from this file (see [Change control](#12-change-control)).

This PRD replaces the internal v2.1 spec. It describes what EdgeCMS is for, the rules every change must keep, and the status of each capability. Status labels describe the repository today; they are not deployment or performance claims.

| Status | Meaning |
| --- | --- |
| `Shipped` | Implemented in this repo with local tests. |
| `Partial` | Code exists; a stated gap remains before it meets the requirement. |
| `Planned` | Accepted direction, not built yet. |
| `Deferred` | Explicitly out of scope until the stated trigger happens. |

---

## 1. Product

EdgeCMS is an open-source (MIT), edge-native headless CMS for Cloudflare Workers. One Worker serves the Elysia API and the React admin, backed by D1, KV, R2, Queues and Durable Objects. Content is tenant-scoped, every mutation is a typed command, and humans and AI agents edit through the same reviewed command path.

**One-line pitch:** a self-hostable CMS that runs where your readers are, with AI editing you can audit.

### 1.1 Who it is for

| Persona | Needs |
| --- | --- |
| **Adopter** (developer) | Clone or scaffold, run locally, publish one entry, read it publicly, deploy to their own Cloudflare account. |
| **Editor** | Create, localize, schedule and publish content in the admin, including offline. |
| **Agent operator** | Let AI propose content changes through MCP or the admin, preview them and approve them. |
| **Extension author** | Add fields, hooks, routes, admin UI and AI tools through a trusted plugin contract without editing core. |
| **Operator** | Run tenants, roles, webhooks, backups and upgrades with audit evidence. |

### 1.2 Repository boundary

- **This repo (`skyvis-my/edgecms`)** holds the framework only: `apps/*`, `packages/*`, `templates/*`, `examples/*`, `docs/`. Placeholder Cloudflare IDs, no hosting targets.
- **`skyvis-my/edgecms-saas`** (private) holds the hosted service: real account IDs, staging/production deploy workflows, billing, signup, plan limits and the marketing website. It merges this repo as `upstream`.
- A feature that only makes sense for the hosted service (billing, signup, plan limits, hosted ops tooling) is out of scope here and belongs in `edgecms-saas`. Framework seams the SaaS needs are in scope and live in §10.1 (`HS-*`).
- A downstream repo may add its own `*PRD.md` at its root (the SaaS uses `SAAS-PRD.md`). Its IDs extend this file; they never override a principle here.

---

## 2. Product principles (invariants)

These apply to every change. A feature that breaks one is rejected or needs an explicit PRD amendment approved by the maintainers.

| ID | Principle |
| --- | --- |
| **P1 Edge-native** | Runs inside Cloudflare Worker limits. No Node-only runtime dependencies, no external image or search services required for core flows. |
| **P2 Tenant isolation** | Every route, query, cache key, R2 key, queue message and log line is scoped to a resolved tenant. No global "current tenant" or actor state. |
| **P3 Commands are the only write path** | Content mutations go through typed command envelopes with validation, optimistic versions, audit and dry-run. No direct table writes from controllers, plugins or AI. |
| **P4 AI proposes, humans approve** | AI and agents produce command envelopes; execution requires the same authorization as the caller and a reviewable preview. The executed command must equal the previewed one. |
| **P5 Published means public, nothing else** | Public routes return only content inside its publish window. Drafts are never served anonymously. |
| **P6 CDN first** | Public reads are designed to be served from cache: versioned keys, tag invalidation, TTLs that respect scheduled transitions. |
| **P7 One schema source** | TypeBox schemas in `@edgecms/schemas` define commands, content and AI tools; Elysia routes, the Eden client, the admin and MCP reuse them. |
| **P8 Trusted extensions only** | Plugins load from a build-time trusted catalog with declared permissions. No arbitrary uploaded code. A timeout is not a sandbox. |
| **P9 Honest claims** | Docs and UI copy state only what local or deployed evidence proves. Sample data is labeled. `bun run check:docs` enforces this for public docs. |
| **P10 Small, measured architecture** | One deployable Worker by default. New packages, services or Workers need a real consumer or a measurement that justifies them (see the [modular ADR](docs/adr/2026-09-11-modular-composable-edgecms.md)). |

---

## 3. Goals and non-goals

### 3.1 Goals

- **G1** An adopter goes from checkout to a first public read in one documented local path.
- **G2** Editors publish localized, related, scheduled content from the admin, online or offline.
- **G3** AI and agents edit content only through previewed, audited, RBAC-checked commands.
- **G4** Public delivery is cache-first with predictable Cloudflare cost.
- **G5** Many tenants share one deployment safely.
- **G6** Extensions compose through one versioned trusted contract.
- **G7** Releases are reproducible, migratable and recoverable.

### 3.2 Non-goals

- **NG1** Traditional monolithic or Node/Postgres hosting as the default runtime.
- **NG2** Real-time collaborative (multi-cursor) editing.
- **NG3** Arbitrary runtime plugin installation or a public plugin marketplace.
- **NG4** Unreviewed autonomous AI mutation.
- **NG5** Anonymous draft or preview public routes.
- **NG6** Deep recursive relation traversal or an arbitrary query engine on public routes.
- **NG7** Billing, signup, plan limits or marketing site in this repo (see §1.2).
- **NG8** Splitting features into separate Workers or services before measurements justify it.

---

## 4. Content model

| ID | Requirement | Status |
| --- | --- | --- |
| **CM-01** | Collections define typed fields, relations, localization rules, a singleton flag and lifecycle behavior. | Shipped |
| **CM-02** | Singleton collections hold exactly one entry (site settings, homepage, navigation). | Shipped |
| **CM-03** | Per-field localization: each field can be localized independently, stored as `{ en: "...", fr: "..." }`, with a default and supported locales per collection. | Shipped |
| **CM-04** | Relations: one-to-one, one-to-many, many-to-many in normalized tables, resolved at snapshot time with a bounded populate depth. Public reads resolve only related entries inside their publish window (same rule as public list/get), and snapshot TTLs expire before a related entry's next scheduled transition. Snapshots are cache-tagged with every related entry they resolved (per related collection above 50 entries or 8 KB of tags), so updating, publishing, unpublishing or deleting a related entry purges them instead of waiting for the TTL. | Shipped |
| **CM-05** | Entry lifecycle: `draft`, `scheduled`, `published`, `archived`, with optional `publishAt` and `unpublishAt`. | Shipped |
| **CM-06** | Entry versions with history, diff and rollback; retention policy for old versions. | Shipped |
| **CM-07** | Field types beyond the current matrix (see [public API field matrix](docs/public/public-api.md)) arrive only through CM-01 or a trusted plugin field (EX-02). | Planned |

## 5. Command engine and editing

| ID | Requirement | Status |
| --- | --- | --- |
| **CMD-01** | All content mutations are typed commands: `createEntry`, `updateEntry`, `deleteEntry`, `bulkUpdate`, `updateSingleton`, `linkRelation`, `unlinkRelation`, `schedulePublish`, `scheduleUnpublish`, `publishNow`, `unpublishNow`, `transaction`. | Shipped |
| **CMD-02** | Envelopes carry actor metadata, optimistic version checks, transaction grouping and dry-run mode. | Shipped |
| **CMD-03** | Dry-run returns a diff before execution. A `transaction` with top-level `dryRun` previews every sub-command, writes nothing and returns their combined diff with one preview receipt. | Shipped |
| **CMD-04** | Durable duplicate suppression: a replayed envelope executes at most once. | Shipped |
| **CMD-05** | Every executed command writes audit and change-log records with secrets redacted. | Shipped |
| **CMD-06** | Post-commit side effects (webhooks, cache purge, search indexing) are recorded as committed intents and delivered asynchronously with retries. | Partial. Gaps: only webhooks have a committed intent (`webhook_outbox` row in the same D1 batch as `processed_commands` + audit). That batch runs after the handler's own entity writes, so a crash between them commits the mutation with no intent; on drivers without `db.batch` the outbox write is a separate best-effort insert. CDN tag purge, frontend revalidation and KV snapshot invalidation run in `handlePostExecution` via `waitUntil` with no durable record and no retry. RAG indexing (`publishNow`) is scheduled inside the handler before the command commits, also unrecorded. The FTS index (`fts.service` `syncPublishedEntry`/`removeEntry`) is not called from any command. Tenant lifecycle events have no outbox row. |

## 6. Offline-first admin

| ID | Requirement | Status |
| --- | --- | --- |
| **OF-01** | The admin keeps schema snapshots, entries, relations, a command queue and sync state in IndexedDB. | Shipped |
| **OF-02** | Offline edits become queued command envelopes and replay on reconnect. | Shipped |
| **OF-03** | Cursor-based push/pull sync against the change log. | Shipped |
| **OF-04** | Field-level conflict resolution with version checks; localized fields merge independently; the user confirms before a newer remote version is overwritten. | Partial |
| **OF-05** | The admin clearly distinguishes saved, draft, published, scheduled and queued states, and works with keyboard and on narrow screens. One status indicator (icon + text + colour, accessible name) is used in entry list rows, the editor header and the publishing overview; it shows scheduled publish/unpublish times and a queued/conflict marker from the offline command queue. Entry list and editor fit 375px; editor actions are keyboard reachable with visible focus. Gap: no automated axe audit; entries created offline have no list row until synced; other admin pages not yet audited at 375px. | Partial |

## 7. AI and agents

| ID | Requirement | Status |
| --- | --- | --- |
| **AI-01** | AI produces command envelopes from shared schemas; it never writes to the database directly (P3, P4). | Shipped |
| **AI-02** | Capabilities: single and bulk updates, cross-collection transactions, localization generation, relation navigation, scheduling help. | Partial |
| **AI-03** | Provider-agnostic via the Vercel AI SDK, routed through Cloudflare AI Gateway. Qwen primary, Gemini fallback, swappable by config. | Shipped |
| **AI-04** | A model router picks a cost tier by command complexity. | Shipped |
| **AI-05** | Preview receipts: execution is accepted only when it matches the reviewed preview. Receipts are stored server-side, bound to actor, tenant, a canonical SHA-256 hash of the reviewed envelopes and a 15-minute expiry; single use is claimed atomically in D1 (`preview_receipt_redemptions`) before anything runs. Command engine, admin AI and MCP execute reject mismatched, expired, other-actor, other-tenant and replayed receipts with typed codes. See [AI command safety](docs/public/ai-command-safety.md#preview-receipts). | Shipped |
| **AI-06** | MCP server exposes tenant-scoped discovery, read, semantic search and command tools with the caller's RBAC, over Streamable HTTP (version negotiation, session cookie, access token or deployment key). Reads and preview/execute writes verified on staging with the official MCP SDK client. See [MCP docs](docs/public/mcp-server.md). | Shipped |
| **AI-07** | Semantic search and RAG over tenant content using Vectorize. | Shipped |
| **AI-08** | AI-assisted imports (for example WordPress WXR) run as a non-destructive preview first. | Partial |

## 8. Media

| ID | Requirement | Status |
| --- | --- | --- |
| **MD-01** | Uploads are optimized in the browser with jSquash WASM (resize, WebP, optional AVIF) before upload; the Worker path is the fallback for API uploads. Today the admin encodes with the browser canvas (jSquash is not wired) and API uploads store only the original. | Partial |
| **MD-02** | Each upload stores the original plus `thumbnail` (150px), `small` (480), `medium` (1024), `large` (2048) variants in R2 under tenant-scoped immutable keys. | Shipped |
| **MD-03** | Asset metadata (dimensions, blurhash, variants) lives in D1; public variants are format-negotiated (AVIF > WebP > original) and cached as immutable. Asset responses send `Vary: Accept` (CORS `Origin` kept). The admin uploader always computes a blurhash from the thumbnail variant; the API rejects malformed blurhash strings with 400. Gap: API uploads without a client blurhash store none, because the Worker has no image decoder. | Partial |
| **MD-04** | Deleting an asset is a soft delete; R2 cleanup runs later through garbage collection. | Shipped |
| **MD-05** | Upload size, dimension and file-type limits are stored per tenant and enforced at the API (default 5 MB, 2048 px). The Worker reads dimensions from the file header (PNG, JPEG, GIF, WebP, AVIF/HEIF, BMP), ignores client-sent sizes for those, and checks direct-upload completion too; other formats fall back to the client-sent size. | Shipped |

## 9. Delivery, caching and scheduling

| ID | Requirement | Status |
| --- | --- | --- |
| **DL-01** | Tenant-scoped public REST: list, get by ID, singletons and asset variants. Published content only (P5). See [public API](docs/public/public-api.md). | Shipped |
| **DL-02** | Typed client (`@edgecms/client`) and fetch examples for frontends. | Shipped |
| **DL-03** | Cache hierarchy Browser → CDN → KV → memory → D1 with versioned keys, tag invalidation and stale-while-revalidate. Anonymous public list, entry and singleton reads are stored in the Workers Cache API (`caches.default`) under keys with tenant, collection, locale, content version and query, so a version bump or tag purge retires them; snapshots that include related entries carry those entries' tags, so a command on a related entry retires them too; credentialed, preview, paid-read and read-your-writes requests skip it. The edge layer is per data centre, has no stale-while-revalidate (the Cache API does not support it) and is absent on non-Cloudflare hosts. See [public API](docs/public/public-api.md#edge-cache-workers). | Shipped |
| **DL-04** | Snapshots per collection, locale and query pattern, with relations resolved and lifecycle filtered. | Shipped |
| **DL-05** | Scheduled publishing is evaluated at request time; cache TTLs shrink toward the next `publishAt`/`unpublishAt`; a Durable Object alarm invalidates KV at the transition. | Shipped |
| **DL-06** | GraphQL read endpoint over published content, guarded against expensive D1 queries. Not a parity claim with REST. List, single-item and singleton resolvers use the same publish-window rule as public REST (P5); an id lookup only returns entries of the queried collection. Queries are limited to depth 3 and complexity 50, with a page-size argument passed as a variable costed at the maximum. Gap: no relation population, no snapshot/CDN caching (every query reads D1), `sort` is accepted but ignored, and a list field without `perPage` is costed as one row although it reads up to 20. | Partial |
| **DL-07** | Paid public reads (x402/L402 challenge middleware) as an opt-in per-route option. | Partial |
| **DL-08** | Signed preview tokens for draft preview inside authenticated frontends; no anonymous draft route (NG5). | Partial |
| **DL-09** | Webhooks through an outbox and Queues, with destination policy, retries and replay. | Partial. Shipped: outbox row per command event, Queues delivery with jittered retries, per-`(eventId, webhookId)` dedup, destination policy re-checked before queued and test deliveries (incl. `0.0.0.0/8`, `100.64.0.0/10`, `::`, `*.localhost`, trailing-dot hosts), no redirect following, timestamped `x-edgecms-signature-v1` HMAC on every delivery with protected signature headers, and `POST .../deliveries/:deliveryId/replay` for failed deliveries. Gaps: no scheduled outbox sweeper (relay only runs after the next command, for rows older than 60 s); outbox rows retry at a fixed 60 s with no attempt cap or dead state; no Queues dead-letter queue; no bulk replay; the policy does not resolve DNS, so a public name pointing at a private address passes; the legacy untimestamped `sha256=` headers are still sent. |
| **DL-10** | A cached public read does no D1 or KV round trip before the cache: tenant resolution and rate-limit state are cached at the edge. Tenant rows (any status) stay in isolate memory for at most 20 s; the isolate that changes a tenant's state drops it at once, so a disabled tenant is blocked there immediately and everywhere within 20 s (plus one in-flight D1 read). Public-read rate limits use an in-isolate counter (approximate across isolates) or the optional `PUBLIC_READ_RATE_LIMITER` binding; `PUBLIC_READ_RATE_LIMIT_STORE=kv` keeps the KV counter. A warm isolate reads the tenant row at most once per 20 s per slug; staging timings not yet re-measured. | Shipped |

## 10. Platform: tenants, auth, extensions

| ID | Requirement | Status |
| --- | --- | --- |
| **PL-01** | Multi-tenant: tenant resolution by path, provisioning, per-tenant bindings and CORS, super-admin tooling. | Shipped |
| **PL-02** | Sign-in with Better Auth (email/password, optional Microsoft Entra ID and Google), JWT validation, sessions cached at the edge. | Shipped |
| **PL-03** | RBAC with built-in roles; every route, command, AI and MCP action checks the caller's permissions. Custom-role `entry:<collection>` grants are enforced per collection on entry routes and on every command (admin, AI, MCP, sync, imports); webhooks, role changes and permanent asset deletion need owner/admin or an explicit grant. Gap: no API route assigns a custom role to a member (set `tenant_users.role` in D1). | Partial |
| **PL-04** | CSRF protection, rate limits, security headers and audit logging on admin routes. | Shipped |
| **EX-01** | Trusted plugin catalog: manifests resolve from the catalog, unknown plugins are blocked, disabled plugins register nothing. See [plugin SDK](docs/public/plugin-sdk.md). | Shipped |
| **EX-02** | One versioned extension contract (`@edgecms/plugin-sdk`) declaring version range, dependencies, bindings, routes, fields, admin contributions, hooks and AI tools, validated at composition time. | Partial |
| **EX-03** | Public plugin routes need their own authorization and cache contract. | Deferred (until a reviewed design exists) |

### 10.1 Hosting seams

Generic hooks that let anyone run EdgeCMS as a multi-customer service, including `skyvis-my/edgecms-saas`. `HS-11`–`HS-14` are the controls a host needs to pass common SaaS security and privacy reviews (SOC 2, ISO 27001, GDPR, OWASP ASVS); the framework provides the control, the host provides the audit. The framework ships the hook and a safe default; pricing, payment and signup UI stay with the host (NG7). Each seam is configured at composition time (OP-02), never by request input.

| ID | Requirement | Status |
| --- | --- | --- |
| **HS-01** | Signup policy: `open`, `invite-only` (single-use, email-bound invites via `/api/admin/invites`) or `disabled`, set at composition time. Runtime default stays `open` for existing deployments; `disabled` is the documented setting for new ones, and the first account of an empty deployment can always be created. Email verification is required when an injected email sender is configured (console sender for development). | Shipped |
| **HS-02** | Tenant creation policy: an injected `canCreateTenant(actor)` decides who may create a tenant on the admin API and onboarding (default: super-admins only on the admin API; onboarding keeps a user's first workspace). A creator who is not a super-admin becomes the tenant owner in the same write. See [hosting seams](docs/public/hosting-seams.md). | Shipped |
| **HS-03** | Provisioning modes: `shared` (rows in the main D1) or `dedicated` (own D1, KV and R2 through the existing Cloudflare API provisioning), with an idempotent, resumable job and a status the admin can show. | Partial |
| **HS-04** | Tenant states: `pending`, `active`, `suspended` (admin locked, public reads continue) and `disabled` (everything blocked). Super-admins keep access in every state; legacy `inactive` behaves like `disabled`. | Shipped |
| **HS-05** | Usage metering: per-tenant counters for public reads, admin mutations, AI tokens by model tier, stored media bytes and entry count, written to an injected sink (`host.usageSink`) with an opt-in D1 daily-rollup sink. Metering never blocks or slows the request path. See [hosting seams](docs/public/hosting-seams.md). | Shipped |
| **HS-06** | Limit policy: an injected `TenantLimits` provider (`host.limits`) is checked before commands, uploads, AI calls and tenant creation. Over-limit returns a typed error (`402` quota, `429` rate) that the admin shows with the host's upgrade link. The default provider allows everything; the tenant-row media limits (MD-05) stay enforced by the upload path and are passed to the provider. | Shipped |
| **HS-07** | Per-tenant rate-limit policies (`host.rateLimits`), with an optional tenant-wide budget, falling back to the fixed framework policies. | Shipped |
| **HS-08** | Tenant lifecycle events (`tenant.created`, `tenant.activated`, `tenant.suspended`, `tenant.deleted`, `tenant.limit_reached`) on the event bus, global webhooks and the host's `onTenantEvent`. | Shipped |
| **HS-09** | Tenant offboarding: full export (content, media references, settings) and verified deletion of tenant data and dedicated resources, with an audit receipt. See [hosting seams](docs/public/hosting-seams.md#tenant-offboarding). The legacy direct `DELETE /api/admin/tenants/:slug` is retired (409 `TENANT_OFFBOARDING_REQUIRED`) and the admin UI uses the typed-confirmation flow. Gap: shared-mode D1 tenants only; dedicated resources are refused (no API delete path for them now) and the Postgres path is not covered; rows orphaned by the old route are not cleaned up. | Partial |
| **HS-10** | Host admin contributions: a trusted host plugin (EX-02) can add admin navigation, a plan/usage panel and banners without editing core. Contributions come from the admin's build-time catalog, are validated at composition time, are gated by the viewer's tenant role and hidden when the API reports the plugin disabled. See [plugin SDK](docs/public/plugin-sdk.md#admin-contributions-hs-10). | Shipped |
| **HS-11** | Multi-factor authentication (TOTP and recovery codes through Better Auth), with a per-tenant "require MFA" setting and a deployment-wide requirement for super-admins (`SUPER_ADMIN_REQUIRE_MFA`), enforced on admin routes, access-token minting and the token fast path. Microsoft/Google sign-ins get no EdgeCMS second-factor challenge. | Shipped |
| **HS-12** | Audit log hardening: hash-chained entries for tamper evidence, configurable retention (at least 1 year), per-tenant export, and coverage of sign-ins, permission changes and super-admin actions as well as commands. See [operations and security](docs/public/operations-security.md#audit-ledger-hs-12). | Shipped |
| **HS-13** | Personal data requests: export and delete one user's personal data (account, sessions, memberships, authored-by references pseudonymized) with an audit receipt. See [operations and security](docs/public/operations-security.md#personal-data-requests-hs-13). | Shipped |
| **HS-14** | Per-tenant AI switch: AI features and the providers they send content to are disabled until a tenant admin enables them, and the admin shows which providers will receive content. New tenants start off; migration `0033` keeps existing tenants on. See [AI command safety](docs/public/ai-command-safety.md#per-tenant-ai-switch-hs-14). | Shipped |
| **HS-15** | Optional OSS hosting adapters (Docker / Kubernetes / Bun): Postgres or bun:sqlite D1 facade, memory or Redis KV (default two-tier L1 memory + L2 Redis when `CACHE_DRIVER=redis`), filesystem or S3/OSS media with `CDN_BASE_URL`, in-process queue/DO shims. Workers remains the default runtime (NG1). Documented parity gaps. See [self-host guide](docs/public/self-host-docker-k8s.md). | Partial |

## 11. Adoption and operations

| ID | Requirement | Status |
| --- | --- | --- |
| **OP-01** | Documented local path: install, run API and admin, migrate, seed, publish, read publicly ([quickstart](docs/public/quickstart.md)). Verified end to end on a clean checkout by the live quickstart and live persisted e2e specs. | Shipped |
| **OP-02** | `createApp()` composition: an application instance owns its config, modules and registries; independent instances can run side by side in tests. Host policies (`createApp({ host })`, §10.1) are per instance. | Partial |
| **OP-03** | `create-edgecms-app` starter that scaffolds a working consumer app. Not published to npm yet. | Partial |
| **OP-04** | Deploy to the adopter's own Cloudflare account via the Deploy button or the [deployment runbook](docs/deployment-runbook.md), with dev, staging and production environments. | Shipped |
| **OP-05** | Migrations use expand/contract sequencing; destructive changes need a backup and a tested restore. | Partial |
| **OP-06** | Collection export and non-destructive import preview. | Partial |
| **OP-07** | Observability: request IDs, cache metrics, scheduler alarm logs, sync logs, AI Gateway analytics. | Partial |
| **OP-08** | `bun run check:all` is the merge gate: merge markers, types, tests, package checks, docs claims, lint. | Shipped |
| **OP-11** | Documented Docker Compose + Kubernetes/Helm path for the OSS hosting adapters (`deploy/docker`, `deploy/k8s`, `deploy/helm/edgecms`), including optional Redis and Entra env forwarding. | Shipped |

### 11.1 Targets

Design targets, with the latest staging measurement. Staging numbers are server-side (`wrangler tail`, sampled) from the 2026-10-22 audit; they are not production results. Client-seen latency adds the network round trip.

| Target | Value | Staging, 2026-10-22 |
| --- | --- | --- |
| Cached public read latency | < 50 ms | Entry 38 ms, list 52 ms server p50 (met / borderline) |
| Uncached global read latency | < 100 ms | Not measured |
| CDN-served share of public reads | > 90% | About 0% before the Cache API layer (DL-03); not re-measured since |
| Worker CPU per cached request | < 5 ms | 5–6 ms p50 cached reads; 3.2 ms p50 across all routes (borderline) |
| Browser image pipeline (4 WebP variants) | < 3 s | Not measured |
| Offline sync recovery | < 5 s | Not measured |

Measure locally with `bun run perf:public-read:local`; remote numbers require a deployed URL and `bun run perf:public-read:remote`.

---

## 12. Change control

Every PR that adds or changes product behavior must fit this PRD.

1. **Cite it.** The PR description has a `PRD:` line naming the requirement IDs it implements (for example `PRD: DL-08, P5`). Chores, tests, CI and refactors with no behavior change use `PRD: n/a`. CI enforces the line ([check-prd-reference](scripts/check-prd-reference.ts)).
2. **Check it.** Run `/prd-check` in Claude Code (defined in [.claude/commands/prd-check.md](.claude/commands/prd-check.md)) before starting a feature. Other agents follow the same steps from [AGENTS.md](AGENTS.md).
3. **Keep the principles.** A change that breaks a principle (§2) or touches a non-goal (§3.2) stops and goes to the maintainers.
4. **Update statuses in the same PR.** When a PR finishes a `Partial` or `Planned` requirement, change its status here. New capabilities get a new ID in the right section; IDs are never reused or renumbered.
5. **Amend deliberately.** New goals, new non-goals, or removing a principle need maintainer approval and a line in the changelog below.

### Changelog

| Date | Version | Change |
| --- | --- | --- |
| 2026-11-03 | 3.9 | OSS Redis path defaults to two-tier KV (`createTwoTierKv`: L1 in-process + L2 Redis; `CACHE_L1_*` / `CACHE_WRITE_MODE`). Follow-up on hosting port; Workers path unchanged (NG1). `HS-15` still Partial. |
| 2026-11-03 | 3.8 | Ported optional OSS hosting adapters (`HS-15` Partial, `OP-11` Shipped): Docker/K8s/Helm, Postgres/SQLite facades, Redis cache option, S3/OSS + CDN public URL, shared Entra resolver (`ENTRA_REDIRECT_URI`). Workers path unchanged (NG1). |
| 2026-11-05 | 3.8 | Recorded #28 (DL-10 Shipped: in-isolate tenant cache with a 20 s state bound, KV-free public read rate limiting), #29 (CM-04 Shipped: public populate respects publish windows), #30 (CMD-03 Shipped: transaction dry-run writes nothing), #31 (DL-03 Shipped: Cache API edge layer), #32 (MD-05 Shipped: server-side dimension check; MD-03 Partial for blurhash), #33 (AI-05 Shipped: single-use preview receipts), #34 (OF-05 Partial), #35 (HS-10 Shipped), #36 (HS-09 Partial: shared-mode offboarding), #37 (PL-03 Partial: custom-role grants enforced, editor admin reads closed) and #38 (P2: MCP and version reads scoped to the request tenant). |
| 2026-10-22 | 3.7 | Recorded #20 (tenant public reads fixed; OP-01 Shipped), #21 (MCP writes, auth and Streamable HTTP fixed; AI-06 verified on staging) and #23 (list cache hits skip D1, opt-in KV metrics; DL-03 Partial for the missing CDN layer). Added staging measurements to §11.1 and DL-10 for the per-request D1/KV lookups the audit found. |
| 2026-10-22 | 3.6 | Corrected CM-04, CMD-03, MD-01, MD-03, MD-05 and PL-03 to Partial after the developer guides were written against the code; each row names its gap. |
| 2026-10-22 | 3.5 | Shipped `HS-05`, `HS-06`, `HS-07` (usage sink, limit policy, per-tenant rate limits) and `HS-08` (`tenant.limit_reached` now emitted). |
| 2026-10-22 | 3.4 | `HS-01` and `HS-11` shipped (signup policy, invites, email verification, MFA). |
| 2026-10-22 | 3.3 | Shipped `HS-02` and `HS-04`; `HS-08` partial (`tenant.limit_reached` reserved). Added the `createApp({ host })` policy surface under OP-02. |
| 2026-10-21 | 3.2 | Added compliance seams `HS-11`–`HS-14` (MFA, audit log hardening, personal data requests, per-tenant AI switch). |
| 2026-10-21 | 3.1 | Added §10.1 hosting seams (`HS-01`–`HS-10`) for multi-customer hosts; downstream `*PRD.md` files extend this one. Corrected MD-05 defaults and PL-02 providers. |
| 2026-10-21 | 3.0 | Rewritten from the internal v2.1 spec to match the open-source framework: TypeBox replaces ArkType, Better Auth replaces direct Entra auth, multi-tenancy, MCP, GraphQL, webhooks, versioning and x402 added, SaaS scope split out, requirement IDs and change control introduced. |
