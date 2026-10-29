# EdgeCMS

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/skyvis-my/edgecms)

EdgeCMS is an edge-native CMS with a React admin dashboard and Elysia API, designed for Cloudflare Workers, D1, KV, R2, Queues, Durable Objects, and tenant-aware public delivery.

Use EdgeCMS when you want a production CMS that runs close to users on Cloudflare instead of a Node-only starter. The local adoption path is intentionally small: install dependencies, start the API and admin, seed smoke data, publish one entry, and read it through tenant-scoped public delivery.

## Repository layout

```text
apps/
  admin/        React admin (Vite, TanStack Router, shadcn/ui)
  api/          Elysia API on Cloudflare Workers (Drizzle + D1, KV, R2, Queues, Durable Objects)
packages/
  client/       @edgecms/client: typed fetch and rich-text rendering for frontends
  runtime/      @edgecms/runtime: createApp() for consumer applications
  schemas/      @edgecms/schemas: shared TypeBox schemas
  plugin-sdk/   @edgecms/plugin-sdk: types for trusted plugins
  create-app/   create-edgecms-app starter CLI (npm-publishable)
templates/      starter template used by create-app
examples/       plugin and public-fetch examples
docs/           guides (docs/public), runbook, ADRs
scripts/        smoke, seed, release and docs checks
PRD.md          product requirements; every PR cites an ID
```

## Public vs SaaS boundary

This repo holds library code only: the self-hostable framework (`apps/*`, `packages/*`,
`templates/*`, `examples/*`, `docs/`). It ships placeholder Cloudflare IDs and no hosting
targets — deploy it to your own account via the Deploy button or `docs/deployment-runbook.md`.

Hosted service code (real account IDs, `STAGING_URL`/`PRODUCTION_URL` deploy workflows,
billing, signup, plan limits, marketing website) lives in the private
`skyvis-my/edgecms-saas` repo, which merges this repo as `upstream`. Never commit SaaS
secrets or hosting targets here.

## Quickstart

For the full local path from checkout to first public read, see `docs/public/quickstart.md`.

Install:

```bash
bun install
```

Run interactively in two terminals:

```bash
bun run dev:api    # API on http://localhost:8787
bun run dev:admin  # Admin on http://localhost:5173
```

Apply local database migrations and seed smoke data:

```bash
bun run db:migrate:local
bun run db:seed:smoke
bun run smoke:e2e:local
```

For live local API/admin proof, run `bun run smoke:e2e:local-live -- --live-persisted` with the smoke credentials from the quickstart.

## Scripts

| Command | Description |
|---------|-------------|
| `bun run dev` | Start all apps in development mode |
| `bun run dev:admin` | Start admin dashboard only |
| `bun run dev:api` | Start API server only |
| `bun run build` | Build all apps |
| `bun run check:all` | Run merge-marker, typecheck, test, and lint gates |
| `bun run clean` | Clean all build artifacts |

## Quality Gates

Run the canonical gate before merging:

```bash
bun run check:all
```

Equivalent individual commands:

```bash
bun run typecheck
bun run test:api
bun run test:admin
bun run lint
```

## Docs

Start with the [quickstart](docs/public/quickstart.md), then the [guide index](docs/public/README.md): content model, public API, client SDK, commands, auth, media, webhooks, MCP, plugins and deployment.

Publishable packages (`@edgecms/client`, `@edgecms/schemas`, `@edgecms/runtime`, `@edgecms/plugin-sdk`, `create-edgecms-app`) use Changesets + `bun run publish:packages`. See [docs/public/publishing-packages.md](docs/public/publishing-packages.md).

## Configuration

Set Worker secrets per environment with `wrangler secret put <NAME> --env <env>`.

| Secret | Needed for |
| --- | --- |
| `BETTER_AUTH_SECRET`, `JWT_HS256_SECRET` | Sessions and API tokens (required) |
| `BASE_URL`, `CORS_ALLOWED_ORIGINS` | The deployment's own URL and allowed origins (required) |
| `SUPER_ADMIN_EMAILS` | Operators; each account needs a verified email (required) |
| `SIGNUP_POLICY` | `open` (default), `invite-only` or `disabled` |
| `SUPER_ADMIN_REQUIRE_MFA`, `AUTH_EMAIL_SENDER` | MFA for super-admins; email verification and invites |
| `QWEN_API_KEY`, `GEMINI_API_KEY`, `AI_GATEWAY_URL` | AI features (off per tenant until enabled) |
| `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET`, `ENTRA_TENANT_ID` | Optional Microsoft sign-in |
| `CF_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Optional dedicated per-tenant databases |

The [deployment runbook](docs/deployment-runbook.md) has the full list, bindings and rollback steps.

## License

[MIT](LICENSE). Third-party code is listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
