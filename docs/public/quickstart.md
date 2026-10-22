# Quickstart

This guide takes you from a fresh checkout to reading a published entry through the public API on your machine. It is for developers trying EdgeCMS locally before they model their own content or deploy it.

## What you need

- Bun `1.4.x` (the repo pins `bun@1.4.2`).
- Wrangler, run through `bunx`, for local Worker and D1 commands.
- A checkout of the repo. Run every command from the repo root unless a step says otherwise.

Check your tools:

```bash
bun --version
bunx wrangler --version
```

## Install

1. Install dependencies:

   ```bash
   bun install
   ```

2. Check that the checkout is clean of merge markers. The command exits `0` on success.

   ```bash
   bun run check:merge-markers
   ```

## Create the local database and sample data

1. Apply the local D1 migrations:

   ```bash
   bun run db:migrate:local
   ```

   This runs `wrangler d1 migrations apply DB --local` from `apps/api`. The tables land in `apps/api/.wrangler/state`, the same store `bun run dev:api` reads.

2. Seed a sample admin, tenant and collection:

   ```bash
   bun run db:seed:smoke
   ```

   The output includes `Smoke seed applied.` and the tenant and collection slugs. The defaults are:

   | Value | Default |
   | --- | --- |
   | Admin email | `smoke.admin@example.com` |
   | Admin password | `SmokePassw0rd!` |
   | Tenant slug | `smoke` |
   | Collection slug | `smoke-posts` |

   To use other slugs:

   ```bash
   bun run db:seed:smoke -- --tenant-slug demo --collection-slug posts
   ```

The seed is idempotent. Running it again keeps the same tenant, owner membership, collection and admin credentials instead of creating duplicates. It applies pending local migrations first unless you pass `--skip-migrations`. It does not create assets or plugin state.

## Start the API and admin

1. In one terminal, start the API:

   ```bash
   bun run dev:api
   ```

2. In a second terminal, start the admin:

   ```bash
   bun run dev:admin
   ```

3. Open `http://localhost:5173`, sign in as the seeded admin, then go to `http://localhost:5173/tenants/smoke/collections/smoke-posts/entries` to see the seeded collection.

| Service | URL |
| --- | --- |
| API | `http://localhost:8787` |
| Admin | `http://localhost:5173` |

Vite proxies `/api` from the admin to the API. If the API runs on another port, set `EDGECMS_API_PROXY_TARGET`.

On first run, `dev:api` prepares the checkout through `scripts/prepare-local-dev.ts`:

- It writes `apps/api/.dev.vars` with generated `BETTER_AUTH_SECRET` and `JWT_HS256_SECRET` values and `SUPER_ADMIN_EMAILS=smoke.admin@example.com`. Existing keys are kept. The file is gitignored.
- It creates a placeholder `apps/admin/dist/index.html` if no admin build exists, because the Worker's static assets binding needs the directory. Run `bun run build:admin` to serve the real admin from the Worker instead.

## Publish and read your first entry

1. In the admin, open the tenant and the `smoke-posts` collection (or create your own collection or singleton).
2. Create an entry.
3. Check its SEO fields, locale, media and schedule, then publish it.
4. Read it through the public API:

   ```bash
   curl http://localhost:8787/api/tenants/smoke/api/public/smoke-posts/<entry-slug>
   ```

A successful read includes `Cache-Control`, `CDN-Cache-Control` and `Cache-Tag` headers. Misses and invalid filters return `no-store`.

Public routes are tenant-scoped. Both forms below reach the same handler; the Worker rewrites the first to the second:

```text
/api/tenants/:tenantSlug/public/:collectionSlug/:entrySlug
/api/tenants/:tenantSlug/api/public/:collectionSlug/:entrySlug
```

Draft content is never returned by public routes. `filter[status]=published` is accepted on list routes; `filter[status]=draft` returns a validation error. Do not use admin collection or entry routes for public delivery. See [Public API](public-api.md) for the full route list.

## Run the smoke tests

| What it checks | Command |
| --- | --- |
| Admin UI against mocked API responses | `bun run smoke:e2e:local` |
| Starts local API and admin, then runs live API smoke checks | `bun run smoke:e2e:local-live` |
| Publishes content, reads it through the public API and uploads media, using the seeded data | see below |
| The sign-in and entry list path above, against running services | see below |

Run `smoke:e2e:local-live` from a clean terminal while port `8787` is free; it starts its own processes. Keep your dev terminals for browsing.

Live persisted smoke, after seeding:

```bash
E2E_ADMIN_EMAIL=smoke.admin@example.com \
E2E_ADMIN_PASSWORD='SmokePassw0rd!' \
E2E_TENANT_SLUG=smoke \
E2E_COLLECTION_SLUG=smoke-posts \
bun run smoke:e2e:local-live -- --live-persisted
```

Quickstart path against your running dev servers:

```bash
cd apps/admin
BASE_URL=http://localhost:5173 E2E_LIVE_PERSISTED=1 bunx playwright test e2e/live-quickstart.spec.ts
```

## Migrations

Run local D1 migrations through the API workspace:

```bash
bun run --filter edgecms-api db:migrate:local
```

Remote migrations are a separate deployment step; see the [Deployment runbook](../deployment-runbook.md). The Worker does not read migration files at request time. Generate migrations with Drizzle, review them, and apply them as part of a release.

## Cloudflare bindings

The Worker needs these bindings locally and when deployed. `apps/api/wrangler.toml` holds the current names and per-environment sections.

| Binding | Type | Used for |
| --- | --- | --- |
| `DB` | D1 database | CMS state and migrations |
| `CACHE` | KV namespace | Cache metadata and snapshots |
| `MEDIA` | R2 bucket | Media assets |
| `WEBHOOK_QUEUE` | Queue | Webhook and background delivery |
| `PUBLISH_SCHEDULER` | Durable Object | Scheduled publishing |
| `ASSETS` | Static assets | The built admin SPA |
| `ASSET_VECTORS` | Vectorize index (optional) | Semantic search |

## Deploy with the Cloudflare button

The Workers Deploy button creates a Worker from the public repository in your Cloudflare account:

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/skyvis-my/edgecms)

It sets up the D1 database, KV cache and R2 media bucket bindings. For a staged setup with secrets, migrations and rollback, follow the [Deployment runbook](../deployment-runbook.md).

## Export a collection as code

The collection create and edit form has a Developer Export panel that copies the current schema as TypeScript.

1. Create or edit a collection in the admin.
2. Open Developer Export and copy the TypeScript config.
3. Paste it into your starter or plugin code for review.
4. Run the relevant schema, API and admin tests before you change the backend to match.

The export is one-way. EdgeCMS cannot import it back into the database, and it does not run migrations. Import preview is read-only: it counts additions, changes and removals but never applies migrations or deletes data.

## Set up frontend revalidation

1. Create a webhook with an HTTPS destination. For local testing, use a public HTTPS tunnel and set `WEBHOOK_ALLOWED_HOSTS` to the exact host or parent domain.
2. Send a dry run first. It checks tenant scope, the destination policy and signing without sending a request.
3. Publish an entry. Your handler receives an `entry.published` event with `data.metadata.revalidate.paths` or `data.metadata.revalidate.tags`.

See [Frontend integration](frontend-integration.md) for handler code and [Webhooks](webhooks.md) for the event format.

## Check performance locally

```bash
bun run perf:public-read:local -- --path /api/tenants/smoke/api/public/smoke-posts/<entry-slug> --expected-kind detail
```

This reports local p50 and p95 timings. It says nothing about deployed latency, cold starts or global edge performance.

To measure a deployed Worker, pass its URL and a known published path:

```bash
EDGE_CMS_URL=https://<deployed-worker> bun run perf:public-read:remote -- --path /api/tenants/smoke/api/public/smoke-posts/<entry-slug>
```

Record remote results with the URL, path, time, p95 and command, for example:

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

## Run the full check suite

Before you open a pull request:

```bash
bun run check:all
```

For a release candidate:

```bash
bun run check:release
```

`check:release` fails while the staging or production D1 and KV IDs in `apps/api/wrangler.toml` are placeholders, and while the deploy workflows it expects are missing. That is deployment setup, not a problem with your local install. For a framework release without hosting, run `bun run check:release:library`.

## Starter app

`packages/create-app` contains a private workspace `create-edgecms-app` CLI. It is not published to npm or installable outside this repo yet. `templates/starter/README.md` lists what a starter must do before it ships.

Inside a generated starter, `bun run seed:smoke`, `bun run smoke` and `bun run validate` run the starter checks. The starter smoke checks that `.env.example` defines `EDGE_CMS_URL`, `EDGE_CMS_ADMIN_URL`, `EDGE_CMS_TENANT` and `EDGE_CMS_COLLECTION` before it reports the public read path.

A future starter should let a new developer, in one sitting: install, start the API and admin, seed an admin user, tenant and collection, publish content, read it through the public API, upload media, and see one trusted plugin in the admin plugin panel.

## Next steps

- [Content model](content-model.md)
- [Public API](public-api.md)
- [Plugin SDK](plugin-sdk.md) and [Sample plugins](sample-plugins.md)
- [Operations guide](../operations-guide.md)
- [Deployment runbook](../deployment-runbook.md)
