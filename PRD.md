# EdgeCMS Product Requirements

Version: 3.5 (2026-10-22)
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
| **CM-04** | Relations: one-to-one, one-to-many, many-to-many in normalized tables, resolved at snapshot time with a bounded populate depth. | Shipped |
| **CM-05** | Entry lifecycle: `draft`, `scheduled`, `published`, `archived`, with optional `publishAt` and `unpublishAt`. | Shipped |
| **CM-06** | Entry versions with history, diff and rollback; retention policy for old versions. | Shipped |
| **CM-07** | Field types beyond the current matrix (see [public API field matrix](docs/public/public-api.md)) arrive only through CM-01 or a trusted plugin field (EX-02). | Planned |

## 5. Command engine and editing

| ID | Requirement | Status |
| --- | --- | --- |
| **CMD-01** | All content mutations are typed commands: `createEntry`, `updateEntry`, `deleteEntry`, `bulkUpdate`, `updateSingleton`, `linkRelation`, `unlinkRelation`, `schedulePublish`, `scheduleUnpublish`, `publishNow`, `unpublishNow`, `transaction`. | Shipped |
| **CMD-02** | Envelopes carry actor metadata, optimistic version checks, transaction grouping and dry-run mode. | Shipped |
| **CMD-03** | Dry-run returns a diff before execution. | Shipped |
| **CMD-04** | Durable duplicate suppression: a replayed envelope executes at most once. | Shipped |
| **CMD-05** | Every executed command writes audit and change-log records with secrets redacted. | Shipped |
| **CMD-06** | Post-commit side effects (webhooks, cache purge, search indexing) are recorded as committed intents and delivered asynchronously with retries. | Partial |

## 6. Offline-first admin

| ID | Requirement | Status |
| --- | --- | --- |
| **OF-01** | The admin keeps schema snapshots, entries, relations, a command queue and sync state in IndexedDB. | Shipped |
| **OF-02** | Offline edits become queued command envelopes and replay on reconnect. | Shipped |
| **OF-03** | Cursor-based push/pull sync against the change log. | Shipped |
| **OF-04** | Field-level conflict resolution with version checks; localized fields merge independently; the user confirms before a newer remote version is overwritten. | Partial |
| **OF-05** | The admin clearly distinguishes saved, draft, published, scheduled and queued states, and works with keyboard and on narrow screens. | Partial |

## 7. AI and agents

| ID | Requirement | Status |
| --- | --- | --- |
| **AI-01** | AI produces command envelopes from shared schemas; it never writes to the database directly (P3, P4). | Shipped |
| **AI-02** | Capabilities: single and bulk updates, cross-collection transactions, localization generation, relation navigation, scheduling help. | Partial |
| **AI-03** | Provider-agnostic via the Vercel AI SDK, routed through Cloudflare AI Gateway. Qwen primary, Gemini fallback, swappable by config. | Shipped |
| **AI-04** | A model router picks a cost tier by command complexity. | Shipped |
| **AI-05** | Preview receipts: execution is accepted only when it matches the reviewed preview. | Partial |
| **AI-06** | MCP server exposes tenant-scoped discovery, read, semantic search and command tools with the caller's RBAC. See [MCP docs](docs/public/mcp-server.md). | Shipped |
| **AI-07** | Semantic search and RAG over tenant content using Vectorize. | Shipped |
| **AI-08** | AI-assisted imports (for example WordPress WXR) run as a non-destructive preview first. | Partial |

## 8. Media

| ID | Requirement | Status |
| --- | --- | --- |
| **MD-01** | Uploads are optimized in the browser with jSquash WASM (resize, WebP, optional AVIF) before upload; the Worker path is the fallback for API uploads. | Shipped |
| **MD-02** | Each upload stores the original plus `thumbnail` (150px), `small` (480), `medium` (1024), `large` (2048) variants in R2 under tenant-scoped immutable keys. | Shipped |
| **MD-03** | Asset metadata (dimensions, blurhash, variants) lives in D1; public variants are format-negotiated (AVIF > WebP > original) and cached as immutable. | Shipped |
| **MD-04** | Deleting an asset is a soft delete; R2 cleanup runs later through garbage collection. | Shipped |
| **MD-05** | Upload size, dimension and file-type limits are stored per tenant and enforced at the API (default 5 MB, 2048 px). | Shipped |

## 9. Delivery, caching and scheduling

| ID | Requirement | Status |
| --- | --- | --- |
| **DL-01** | Tenant-scoped public REST: list, get by ID, singletons and asset variants. Published content only (P5). See [public API](docs/public/public-api.md). | Shipped |
| **DL-02** | Typed client (`@edgecms/client`) and fetch examples for frontends. | Shipped |
| **DL-03** | Cache hierarchy Browser → CDN → KV → memory → D1 with versioned keys, tag invalidation and stale-while-revalidate. | Shipped |
| **DL-04** | Snapshots per collection, locale and query pattern, with relations resolved and lifecycle filtered. | Shipped |
| **DL-05** | Scheduled publishing is evaluated at request time; cache TTLs shrink toward the next `publishAt`/`unpublishAt`; a Durable Object alarm invalidates KV at the transition. | Shipped |
| **DL-06** | GraphQL read endpoint over published content, guarded against expensive D1 queries. Not a parity claim with REST. | Partial |
| **DL-07** | Paid public reads (x402/L402 challenge middleware) as an opt-in per-route option. | Partial |
| **DL-08** | Signed preview tokens for draft preview inside authenticated frontends; no anonymous draft route (NG5). | Partial |
| **DL-09** | Webhooks through an outbox and Queues, with destination policy, retries and replay. | Partial |

## 10. Platform: tenants, auth, extensions

| ID | Requirement | Status |
| --- | --- | --- |
| **PL-01** | Multi-tenant: tenant resolution by path, provisioning, per-tenant bindings and CORS, super-admin tooling. | Shipped |
| **PL-02** | Sign-in with Better Auth (email/password, optional Microsoft Entra ID and Google), JWT validation, sessions cached at the edge. | Shipped |
| **PL-03** | RBAC with built-in roles; every route, command, AI and MCP action checks the caller's permissions. | Shipped |
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
| **HS-09** | Tenant offboarding: full export (content, media references, settings) and verified deletion of tenant data and dedicated resources, with an audit receipt. | Planned |
| **HS-10** | Host admin contributions: a trusted host plugin (EX-02) can add admin navigation, a plan/usage panel and banners without editing core. | Planned |
| **HS-11** | Multi-factor authentication (TOTP and recovery codes through Better Auth), with a per-tenant "require MFA" setting and a deployment-wide requirement for super-admins (`SUPER_ADMIN_REQUIRE_MFA`), enforced on admin routes, access-token minting and the token fast path. Microsoft/Google sign-ins get no EdgeCMS second-factor challenge. | Shipped |
| **HS-12** | Audit log hardening: hash-chained entries for tamper evidence, configurable retention (at least 1 year), per-tenant export, and coverage of sign-ins, permission changes and super-admin actions as well as commands. See [operations and security](docs/public/operations-security.md#audit-ledger-hs-12). | Shipped |
| **HS-13** | Personal data requests: export and delete one user's personal data (account, sessions, memberships, authored-by references pseudonymized) with an audit receipt. See [operations and security](docs/public/operations-security.md#personal-data-requests-hs-13). | Shipped |
| **HS-14** | Per-tenant AI switch: AI features and the providers they send content to are disabled until a tenant admin enables them, and the admin shows which providers will receive content. New tenants start off; migration `0033` keeps existing tenants on. See [AI command safety](docs/public/ai-command-safety.md#per-tenant-ai-switch-hs-14). | Shipped |

## 11. Adoption and operations

| ID | Requirement | Status |
| --- | --- | --- |
| **OP-01** | Documented local path: install, run API and admin, migrate, seed, publish, read publicly ([quickstart](docs/public/quickstart.md)). | Shipped |
| **OP-02** | `createApp()` composition: an application instance owns its config, modules and registries; independent instances can run side by side in tests. Host policies (`createApp({ host })`, §10.1) are per instance. | Partial |
| **OP-03** | `create-edgecms-app` starter that scaffolds a working consumer app. Not published to npm yet. | Partial |
| **OP-04** | Deploy to the adopter's own Cloudflare account via the Deploy button or the [deployment runbook](docs/deployment-runbook.md), with dev, staging and production environments. | Shipped |
| **OP-05** | Migrations use expand/contract sequencing; destructive changes need a backup and a tested restore. | Partial |
| **OP-06** | Collection export and non-destructive import preview. | Partial |
| **OP-07** | Observability: request IDs, cache metrics, scheduler alarm logs, sync logs, AI Gateway analytics. | Partial |
| **OP-08** | `bun run check:all` is the merge gate: merge markers, types, tests, package checks, docs claims, lint. | Shipped |

### 11.1 Targets

These are design targets to measure against, not measured results.

| Target | Value |
| --- | --- |
| Cached public read latency | < 50 ms |
| Uncached global read latency | < 100 ms |
| CDN-served share of public reads | > 90% |
| Worker CPU per cached request | < 5 ms |
| Browser image pipeline (4 WebP variants) | < 3 s |
| Offline sync recovery | < 5 s |

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
| 2026-10-22 | 3.5 | Shipped `HS-05`, `HS-06`, `HS-07` (usage sink, limit policy, per-tenant rate limits) and `HS-08` (`tenant.limit_reached` now emitted). |
| 2026-10-22 | 3.4 | `HS-01` and `HS-11` shipped (signup policy, invites, email verification, MFA). |
| 2026-10-22 | 3.3 | Shipped `HS-02` and `HS-04`; `HS-08` partial (`tenant.limit_reached` reserved). Added the `createApp({ host })` policy surface under OP-02. |
| 2026-10-21 | 3.2 | Added compliance seams `HS-11`–`HS-14` (MFA, audit log hardening, personal data requests, per-tenant AI switch). |
| 2026-10-21 | 3.1 | Added §10.1 hosting seams (`HS-01`–`HS-10`) for multi-customer hosts; downstream `*PRD.md` files extend this one. Corrected MD-05 defaults and PL-02 providers. |
| 2026-10-21 | 3.0 | Rewritten from the internal v2.1 spec to match the open-source framework: TypeBox replaces ArkType, Better Auth replaces direct Entra auth, multi-tenancy, MCP, GraphQL, webhooks, versioning and x402 added, SaaS scope split out, requirement IDs and change control introduced. |
