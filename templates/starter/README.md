# EdgeCMS Starter Template

This directory is the acceptance checklist for the private workspace `create-edgecms-app` package. It is not an externally installable starter yet.

Keep this template lightweight while proving the local path: install, run API/admin, seed smoke fixture data, publish content, read through public delivery, upload media, and inspect trusted plugin status.

## Starter Promise

A real starter is ready only when a new developer can run one local CMS in one sitting and answer these questions without reading internals:

- Which command installs dependencies?
- Which command starts the API?
- Which command starts the admin?
- Which command seeds usable smoke data?
- Which route proves public delivery?
- Which smoke check proves publish, public read, and media upload?
- Where does plugin status appear?

## Current Source Of Truth

- Root quickstart: `../../docs/public/quickstart.md`
- Public API docs: `../../docs/public/public-api.md`
- Frontend integration docs: `../../docs/public/frontend-integration.md`
- Plugin SDK docs: `../../docs/public/plugin-sdk.md`
- Sample plugin docs: `../../docs/public/sample-plugins.md`
- Root package scripts: `../../package.json`
- Starter env example: `.env.example`

Do not duplicate full app code here. Keep starter files limited to first-run proof.

## Required Starter Contents

This template includes:

- Minimal `apps/admin` and `apps/api` workspace shape.
- `package.json` scripts matching first-run command names.
- Copy-safe `.env.example` values.
- Local `bun run seed:smoke` command for one tenant, collection, published entry, media fixture, and trusted plugin status fixture.
- Offline `bun run smoke` check that fails clearly when setup is incomplete.

Do not add:

- Public or npm-installable `create-edgecms-app` command docs.
- Marketplace, runtime plugin upload, or sandboxing promises.
- Generic CMS examples that do not hit EdgeCMS routes.
- Extra config layers not needed for first local run.

## Acceptance Checklist

Run from repo root before extracting a starter:

```bash
bun install
bun run check:merge-markers
bun run seed:smoke
bun run smoke
bun run validate
```

Run from a generated starter before claiming first-run proof:

```bash
bun install
bun run seed:smoke
bun run smoke
bun run validate
```

Reset local starter smoke data with one command:

```bash
bun scripts/seed.ts --reset
```

`bun run smoke` verifies:

- `.env.example` contains copy-safe local values for `EDGE_CMS_URL`, `EDGE_CMS_ADMIN_URL`, `EDGE_CMS_TENANT`, and `EDGE_CMS_COLLECTION`.
- Smoke fixture tenant is `smoke`.
- Smoke fixture collection is `smoke-posts`.
- Smoke collection and entry references stay inside the `smoke` tenant fixture.
- Smoke fixture entry is published and addressable at `/api/tenants/smoke/api/public/smoke-posts/hello-edgecms`.
- Smoke media fixture references `fixtures/media/smoke-hero.txt`.
- Trusted plugin status fixture is loaded.

Start local dev services for manual acceptance:

```bash
bun run dev:api
bun run dev:admin
```

Run this for live local API/admin coverage:

```bash
E2E_ADMIN_EMAIL=smoke.admin@example.com \
E2E_ADMIN_PASSWORD='SmokePassw0rd!' \
E2E_TENANT_SLUG=smoke \
E2E_COLLECTION_SLUG=smoke-posts \
bun run smoke:e2e:local-live -- --live-persisted
```

Expected starter-level proof:

- Install exits `0`.
- Merge-marker check exits `0`.
- API starts on `http://localhost:8787`.
- Admin starts on `http://localhost:5173`.
- Smoke seed prints `Smoke seed applied.`
- Starter smoke exits `0`.
- Starter smoke prints `Public read proof path: http://localhost:8787/api/tenants/smoke/api/public/smoke-posts/hello-edgecms`.
- Smoke fixture includes one tenant, collection, published entry, media fixture, and trusted plugin status.

## Failure Guide

| Failure | Fix |
| --- | --- |
| `Missing starter file` | Regenerate the starter or restore the listed template file. |
| `Missing env example key` | Add the missing key to `.env.example` before changing smoke logic. |
| `Unexpected EDGE_CMS_* starter value` | Keep `.env.example` copy/paste safe unless tests and docs are updated together. |
| `Smoke seed fixture must include...` | Update `fixtures/smoke-seed.json` and keep tenant, collection, entry, media, and plugin status aligned. |
| `Applied smoke seed must match...` | Run `bun scripts/seed.ts --reset` so `.edgecms/smoke-seed-applied.json` matches the fixture. |
| Public read proof path is wrong | Keep `EDGE_CMS_TENANT`, `EDGE_CMS_COLLECTION`, and entry slug aligned with `fixtures/smoke-seed.json`. |

## Current Gap Register

| Surface | Current status | Starter requirement |
| --- | --- | --- |
| Install | Real root script exists: `bun install` | Keep same package manager and engine constraints |
| API dev | Real root script exists: `bun run dev:api` | Keep same command name |
| Admin dev | Real root script exists: `bun run dev:admin` | Keep same command name |
| Smoke seed | `bun run seed:smoke` writes local seed proof from fixture data | Wire real API seeding later |
| Public read | API workspace advertises local public route shape | Include copy/paste fetch example later |
| Media upload | Tiny media fixture is bundled | Wire real upload later |
| Plugin status | Trusted plugin status fixture is bundled | Wire real admin status panel later |
| Env example | `.env.example` lists local, auth, tenant, public, and AI placeholders | Keep values non-secret and copy/paste safe |

## Done Definition

This directory remains private workspace proof until `docs/public/quickstart.md` passes as written on a clean checkout and release approval allows public package docs.

## Cloudflare Deploy Checklist

This starter does not perform deploy proof yet. Before claiming Cloudflare deployment support, collect receipts for:

- Wrangler login and account selection.
- D1 database and migration binding setup.
- Worker env vars and secrets configured outside `.env.example`.
- Admin/API build passing in the generated app.
- Local smoke passing before deploy.
- Remote public read smoke passing against the deployed Worker URL.

Keep deployed proof separate from local starter proof.

## D1 Migration Checklist

This starter does not run D1 migrations. Before wiring a generated app to a real EdgeCMS API, collect receipts for:

- Local D1 database created for the target Worker.
- `wrangler d1 migrations apply DB --local` passes from the API workspace or documented project root command.
- Remote D1 database ID and binding are configured in the Worker environment before remote migration.
- `wrangler d1 migrations apply DB --remote` is run only against the intended Cloudflare account/env.
- Smoke seed runs after local migrations and before public-read smoke.
- Rollback expectation is documented in the release receipt; do not imply automatic rollback unless a tested rollback path exists.

Keep migration proof separate from starter smoke proof.
