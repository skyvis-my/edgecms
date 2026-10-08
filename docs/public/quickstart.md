# EdgeCMS Quickstart

This guide takes a new developer from checkout to first published content read through the public API.

## Admin First-Run Checklist

Use this local checklist before claiming a working editorial path:

1. Confirm active tenant and local D1 bindings.
2. Create first collection or singleton model.
3. Create entry content for that model.
4. Publish entry content after checking SEO, locale, media, and schedule readiness.
5. Read published content through the tenant public route.

This checklist is local onboarding proof. It is not deployed smoke proof unless an operator records the deployed URL, tenant, command, date, and result.

## 1-Click Cloudflare Deployment

Deploy EdgeCMS directly to your Cloudflare account with the Workers Deploy button:

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/skyvis-my/edgecms)

This deploys EdgeCMS to Cloudflare Workers with required D1 database, KV cache, and R2 media bucket bindings.

## Prerequisites

- Bun `1.3.x`
- Cloudflare Wrangler access for local Worker and D1 commands
- Repo checkout at the project root

Check tool availability:

```bash
bun --version
bunx wrangler --version
```

## Install

```bash
bun install
```

Self-check:

```bash
bun run check:merge-markers
```

Expected: command exits `0`.

## Start Local Services

Use two terminals:

```bash
bun run dev:api
```

```bash
bun run dev:admin
```

Local URLs:

- API: `http://localhost:8787`
- Admin: `http://localhost:5173`

Automated live health check:

```bash
bun run smoke:e2e:local-live
```

Expected: wrapper starts local API/admin processes and runs live API smoke checks.

Run this from a clean terminal when `localhost:8787` is free. Keep the manual dev terminals for browsing the app.

## Seed Smoke Data

Seed local D1 with the smoke admin, tenant, and collection:

```bash
bun run db:seed:smoke
```

Default seed values:

- Admin email: `smoke.admin@example.com`
- Admin password: `SmokePassw0rd!`
- Tenant slug: `smoke`
- Collection slug: `smoke-posts`

Override values when needed:

```bash
bun run db:seed:smoke -- --tenant-slug demo --collection-slug posts
```

Expected: output includes `Smoke seed applied.` and prints the tenant and collection slugs.

The smoke seed is intended to be idempotent for local proof. Re-running it should keep the same tenant, owner membership, smoke collection, and credential identity instead of creating duplicate adoption fixtures.

## Migration Status

Local D1 migrations are managed through the API workspace:

```bash
bun run --filter edgecms-api db:migrate:local
```

Remote migration execution is an operator action and is not implied by this quickstart. Record the target environment, migration command, date/time, and rollback expectation in the release receipt before claiming remote migration proof.

Cloudflare Worker runtime code cannot depend on ad hoc filesystem migration bundles at request time. Migrations must be generated, reviewed, and applied as deployment/release steps rather than discovered dynamically inside the Worker.

Migration status proof is local unless the operator receipt includes:

- Environment name and D1 database binding.
- Migration directory or generated migration ids reviewed for that release.
- Command used for local or remote migration status.
- Rollback expectation and owner.

This docs path does not run production migrations or prove rollback health.

Worker migration bundling proof is also local. The Worker should serve requests from deployed code and bindings, not discover migration files from the runtime filesystem. Treat generated Drizzle files as release inputs reviewed before deployment, then record migration status in the release receipt after the operator runs the local or remote command.

T014 local proof commands for this boundary:

```bash
bun run --filter edgecms-api db:migrate:local
bun run check:docs
```

Those commands do not prove production migration completion.

## Run Smoke Checks

Mocked admin smoke:

```bash
bun run smoke:e2e:local
```

Expected: Playwright PRD smoke passes against mocked backend responses.

Live persisted smoke after seed:

```bash
E2E_ADMIN_EMAIL=smoke.admin@example.com \
E2E_ADMIN_PASSWORD='SmokePassw0rd!' \
E2E_TENANT_SLUG=smoke \
E2E_COLLECTION_SLUG=smoke-posts \
bun run smoke:e2e:local-live -- --live-persisted
```

Expected: smoke publishes first content, reads it through the public API, and verifies media upload.

## Release Proof Boundaries

Local release proof for public docs is:

```bash
bun run check:docs
bun test scripts/docs-quality.test.ts scripts/seed-smoke-db.test.ts
```

External proof still needs operator receipts for deployed URL, remote migration status, remote backup/export, and production smoke results.

Acceptance checklist for local proof:

- `bun run db:seed:smoke` completed for tenant `smoke` and collection `smoke-posts`.
- `bun run smoke:e2e:local-live -- --live-persisted` completed with public read and media upload checks.
- Public read path used tenant-scoped routing: `/api/tenants/smoke/api/public/smoke-posts/<entry-slug>`.
- Evidence stayed local unless a deployed Worker URL and operator receipt were recorded separately.

Starter template proof uses `bun run seed:smoke`, `bun run smoke`, and `bun run validate` inside the generated starter. The starter smoke checks `.env.example` for `EDGE_CMS_URL`, `EDGE_CMS_ADMIN_URL`, `EDGE_CMS_TENANT`, and `EDGE_CMS_COLLECTION` before reporting the public read proof path.

## Public Delivery Model

Public reads use tenant-scoped routes. Current live persisted smoke verifies:

```text
/api/tenants/:tenantSlug/api/public/:collectionSlug/:entrySlug
```

Mocked admin smoke also covers the legacy PRD route:

```text
/api/tenants/:tenantSlug/public/:collectionSlug/:entrySlug
```

Use tenant slugs in client examples. Do not rely on admin-only collection or entry routes for public delivery.

Copy/paste local read shape after live smoke creates published content:

```bash
curl http://localhost:8787/api/tenants/smoke/api/public/smoke-posts/<entry-slug>
```

Expected public read headers include `Cache-Control`, `CDN-Cache-Control`, and `Cache-Tag`. Public misses and invalid filters return `no-store`.

Draft content is not readable from public routes. `filter[status]=published` is allowed for explicit public list checks; `filter[status]=draft` returns a validation error instead of querying draft snapshots.

## Cloudflare Bindings

Local and deployed Workers need these binding categories before deploy proof can be claimed:

- D1 database binding for CMS state and migrations.
- KV namespace binding for cache metadata.
- R2 bucket binding for media assets.
- Queue binding for webhook/background delivery.
- Durable Object binding for scheduling/stateful coordination.
- Static assets binding for the built admin SPA.

`apps/api/wrangler.toml` is the source of truth for current binding names and env sections. This checklist is setup guidance only; it does not prove a remote deploy, migration, or live binding health.

## Collection Config Export

Use the collection create/edit form's Developer Export panel to copy the current schema as TypeScript. This is local admin proof only: it helps move visual content modeling into code, but it does not replace migrations, starter packaging, or deploy validation.

Suggested local workflow:

1. Create or edit a collection in admin.
2. Use Developer Export and copy the TypeScript config.
3. Paste it into starter/plugin code as a review artifact, not as an automatic migration.
4. Run the relevant schema, API, and admin tests before applying any matching backend change.

Current boundary: EdgeCMS does not yet import this export back into the database. Treat the export as a deterministic handoff from visual modeling to code review. Import preview proof must stay non-destructive: it can count additions, changes, and removals, but it cannot apply migrations or delete production data.

## Admin First-Run Checklist

Before counting admin onboarding proof, verify:

- Tenant exists or is selected.
- Collection exists.
- Entry exists.
- Entry is published through the publishing path.
- Published entry is readable through the tenant-scoped public API.
- Required media workflow is confirmed when content depends on media.

This is local docs/UI proof only. It does not prove a deployed onboarding flow.

## Revalidation Setup

Create frontend revalidation webhooks with HTTPS destinations only. For local testing, use a public HTTPS tunnel and set `WEBHOOK_ALLOWED_HOSTS` to the exact host or parent domain you expect.

Use webhook dry-run first to validate tenant scope, destination policy, and signing without sending an outbound request. Then publish an entry and confirm the frontend handler receives an `entry.published` event with `data.metadata.revalidate.paths` or `data.metadata.revalidate.tags`.

## Quality Gate

Run the full local gate before merge:

```bash
bun run check:all
```

For release candidates:

```bash
bun run check:release
```

`check:release` can fail when Cloudflare staging or production binding IDs are still placeholders. Treat that as an operator setup blocker, not a quickstart failure.

## Performance Proof

Use local performance proof before repeating edge-performance claims:

```bash
bun run perf:public-read:local -- --path /api/tenants/smoke/api/public/smoke-posts/<entry-slug>
```

Use remote performance proof only when an operator provides a deployed Worker URL and a known published public-read path:

```bash
EDGE_CMS_URL=https://<deployed-worker> bun run perf:public-read:remote -- --path /api/tenants/smoke/api/public/smoke-posts/<entry-slug>
```

Remote performance receipts must record the deployed URL, path, date/time, p95, and command used. Do not claim cold-start behavior from local perf output, package checks, or docs-only proof.

Keep local and remote receipts separate. Local perf proves command wiring and local response behavior; it does not prove deployed latency, cold-start behavior, or global edge performance.

Remote receipt template:

```json
{
  "url": "https://<deployed-worker>",
  "path": "/api/tenants/smoke/api/public/smoke-posts/<entry-slug>",
  "measuredAt": "YYYY-MM-DDTHH:mm:ss.sssZ",
  "p95Ms": 0,
  "proof": "deployed",
  "command": "EDGE_CMS_URL=https://<deployed-worker> bun run perf:public-read:remote -- --path /api/tenants/smoke/api/public/smoke-posts/<entry-slug>"
}
```

## Private Starter CLI

`packages/create-app` contains a private workspace `create-edgecms-app` CLI for local starter proof. It is not published to npm or installable outside this repo yet. `templates/starter/README.md` remains the acceptance checklist before any external install path is claimed.

## Starter Gap Checklist

Before extracting a future starter or `create-edgecms-app`, this path should prove:

- Local install succeeds.
- API and admin start locally.
- Smoke seed creates admin user, tenant, and collection.
- Live persisted smoke creates and publishes content.
- Public API read returns the published entry.
- Media upload smoke passes.
- One trusted plugin appears in the admin plugin panel.

Current known gap: the seed script does not create an asset or plugin state by itself; live smoke and admin plugin checks cover those surfaces separately.

## Next Docs

- Plugin SDK: `docs/public/plugin-sdk.md`
- Sample plugins: `docs/public/sample-plugins.md`
- Starter template checklist: `templates/starter/README.md`
- Cloudflare operations: `docs/operations-guide.md`
- Deployment: `docs/deployment-runbook.md`
