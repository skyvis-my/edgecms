# Deployment runbook

This runbook deploys EdgeCMS to your own Cloudflare account: provisioning resources, setting secrets, applying migrations, deploying the Worker, checking it, and rolling back. It is for operators running staging and production environments. For a local setup, start with the [Quickstart](public/quickstart.md).

## Prerequisites

| Requirement | Version | Notes |
| --- | --- | --- |
| Cloudflare account | | Workers Paid plan, needed for Durable Objects, Queues and Vectorize |
| Wrangler | 4.x | Run with `bunx wrangler`, or install globally and run `wrangler login` |
| Bun | 1.4.x | The repo pins `bun@1.4.2` |
| Git | 2.x | To clone the repository |

Check your setup:

```bash
bunx wrangler --version
bun --version
bunx wrangler whoami
```

## Where configuration lives

| File | Used by |
| --- | --- |
| `apps/api/wrangler.toml` | `wrangler` commands (migrations, secrets, rollback) and `bun run check:release` |
| `apps/api/cloudflare.config.ts` | `bun run deploy`, `deploy:staging` and `deploy:production`, which run the `cf` CLI with `--mode <env>` |

Both files define a default environment plus `staging` and `production`, and both ship with placeholder IDs. Replace the placeholders in both files after you provision resources.

## Provision resources

Run these once per environment (`staging` and `production`). Replace `<env>` with the environment name. Run Wrangler commands from `apps/api`.

1. Create the D1 database and note the returned `database_id`:

   ```bash
   bunx wrangler d1 create edgecms-db-<env>
   ```

2. Create the KV namespace and note the returned ID:

   ```bash
   bunx wrangler kv namespace create CACHE --env <env>
   ```

3. Create the R2 bucket:

   ```bash
   bunx wrangler r2 bucket create edgecms-media-<env>
   ```

4. Create the webhook delivery queue:

   ```bash
   bunx wrangler queues create edgecms-webhook-queue-<env>
   ```

5. Create the Vectorize index for semantic search. The dimensions and metric must match the embedding model EdgeCMS uses:

   ```bash
   bunx wrangler vectorize create edgecms-assets-vectors-<env> --dimensions 768 --metric cosine
   ```

6. Replace the placeholder IDs with the real ones:

   - In `apps/api/wrangler.toml`: `STAGING_DATABASE_ID`, `STAGING_KV_NAMESPACE_ID`, `PRODUCTION_DATABASE_ID`, `PRODUCTION_KV_NAMESPACE_ID`.
   - In `apps/api/cloudflare.config.ts`: `STAGING_CLOUDFLARE_ACCOUNT_ID`, `STAGING_D1_DATABASE_ID`, `STAGING_KV_NAMESPACE_ID` and the matching `PRODUCTION_*` values.

   Keep `migrations_dir = "drizzle/migrations"` on each environment's D1 binding in `wrangler.toml`:

   ```toml
   [[env.<env>.d1_databases]]
   binding = "DB"
   database_name = "edgecms-db-<env>"
   database_id = "<returned-database-id>"
   migrations_dir = "drizzle/migrations"

   [[env.<env>.kv_namespaces]]
   binding = "CACHE"
   id = "<returned-namespace-id>"
   ```

The `PublishScheduler` Durable Object needs no provisioning command. It is created on deploy from its binding and migration tag. `wrangler.toml` declares it at the top level and, for staging, as a SQLite-backed class (new Cloudflare accounts only allow SQLite-backed Durable Objects):

```toml
[[migrations]]
tag = "v1"
new_classes = ["PublishScheduler"]

[[env.staging.migrations]]
tag = "v1"
new_sqlite_classes = ["PublishScheduler"]
```

## Set secrets

Secrets are stored in Cloudflare and injected at runtime; never commit them. Set each one per environment. Wrangler prompts for the value:

```bash
cd apps/api
bunx wrangler secret put <SECRET_NAME> --env <env>
```

| Secret | Purpose | Required |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` | Signs Better Auth sessions and tokens | Yes |
| `JWT_HS256_SECRET` | HS256 key for API JWT verification | Yes |
| `SUPER_ADMIN_EMAILS` | Comma-separated super-admin emails; each account needs a verified email | Yes |
| `CORS_ALLOWED_ORIGINS` | Comma-separated allowed origins, for example `https://cms.example.com` | Yes |
| `BASE_URL` | Canonical URL of the deployment, for example `https://cms.example.com` | Yes |
| `QWEN_API_KEY` | Qwen (DashScope) key for AI features | If AI is used |
| `GEMINI_API_KEY` | Google Gemini key, the fallback AI provider | If AI is used |
| `AI_GATEWAY_URL` | Cloudflare AI Gateway endpoint | If AI is used |
| `CF_API_TOKEN` | Cloudflare API token for dedicated per-tenant D1/KV/R2 provisioning, Workers AI embeddings for semantic search, and CDN cache purge by tag | No |
| `CLOUDFLARE_ACCOUNT_ID` | Account for dedicated tenant provisioning and Workers AI embeddings | No |
| `CLOUDFLARE_ZONE_ID` | Zone for CDN cache purge by tag (with `CF_API_TOKEN`) | No |
| `EDGECMS_API_KEY` or `MCP_API_KEY` | API key for the [MCP server](public/mcp-server.md) | No |
| `PREVIEW_SECRET` | Signs preview tokens; falls back to `BETTER_AUTH_SECRET` | No |
| `WEBHOOK_ALLOWED_HOSTS` | Allow-list for webhook destination hosts | No |
| `ENABLE_AI_IMPORT_REVIEW` | Set to `true` to turn on the AI import review beta endpoints | No |
| `AUDIT_RETENTION_DAYS` | Audit retention in days; values under 365 are raised to 365 | No (default 365) |

Without `CF_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, the Worker runs normally: dedicated tenant provisioning is unavailable, asset search falls back to keyword search, and CDN purge is skipped.

Example for production:

```bash
cd apps/api
ENV=production

bunx wrangler secret put BETTER_AUTH_SECRET --env $ENV
bunx wrangler secret put JWT_HS256_SECRET --env $ENV
bunx wrangler secret put SUPER_ADMIN_EMAILS --env $ENV
bunx wrangler secret put CORS_ALLOWED_ORIGINS --env $ENV
bunx wrangler secret put BASE_URL --env $ENV
# If AI is used:
# bunx wrangler secret put QWEN_API_KEY --env $ENV
# bunx wrangler secret put GEMINI_API_KEY --env $ENV
# bunx wrangler secret put AI_GATEWAY_URL --env $ENV
```

List what is set:

```bash
bunx wrangler secret list --env <env>
```

## Configure sign-up, email verification and MFA

These settings are read when the Worker starts, from Worker variables or secrets, or from `configureAuthPolicies()` in a custom Worker entry. Request input never changes them.

| Variable | Values | Default | Effect |
| --- | --- | --- | --- |
| `SIGNUP_POLICY` | `open`, `invite-only`, `disabled` | `open` | Who may create an account |
| `AUTH_EMAIL_SENDER` | `console` | unset | Development only: writes verification and invite emails to the Worker log |
| `SUPER_ADMIN_REQUIRE_MFA` | `true`, `false` | `false` | Super-admins (by role or `SUPER_ADMIN_EMAILS`) need a two-factor sign-in on every admin route |

For new deployments, set `SIGNUP_POLICY=disabled` and `SUPER_ADMIN_REQUIRE_MFA=true`. The default stays `open` so existing self-hosted deployments keep working after an upgrade.

```bash
bunx wrangler secret put SIGNUP_POLICY --env production
bunx wrangler secret put SUPER_ADMIN_REQUIRE_MFA --env production
```

- **First account.** Under `disabled` and `invite-only`, the first account of an empty database can still be created, so you can sign up the first operator on a fresh install. Do it right after deploying.
- **Invites.** With `invite-only`, a super-admin creates an invite with `POST /api/admin/invites` and a body such as `{ "email": "...", "tenantSlug": "acme", "tenantRole": "admin" }`. The response contains the token once and a `signUpPath` (`/sign-up?invite=...`). An invite is bound to one email, works once, expires (default 72 hours) and can grant membership of one tenant. List invites with `GET /api/admin/invites` and revoke one with `DELETE /api/admin/invites/:id`. The policy also blocks new accounts from Microsoft and Google sign-in.
- **Email verification.** When an email sender is configured, email/password accounts must verify their address before they can sign in. Existing unverified accounts get a new link on their next sign-in attempt. EdgeCMS ships no email provider; pass your own in code: `configureAuthPolicies({ emailSender: { send: async ({ to, subject, text }) => { /* your provider */ } } })`.
- **MFA.** Users turn on two-factor authentication (authenticator app and recovery codes) under **Settings → Profile**. A super-admin can require it for a tenant with `PUT /api/admin/tenants/:slug` and `{ "requireMfa": true }`; that tenant's admin and MCP routes then return `403 MFA_REQUIRED` for sessions without a second factor. Microsoft and Google sign-ins get no EdgeCMS second-factor challenge, so with MFA required those users must sign in with their password and authenticator code.

### Super-admins listed in `SUPER_ADMIN_EMAILS`

A listed address grants super-admin only when the account's email is verified. It can only be registered when verification is enforced (an email sender is configured) or through Microsoft or Google sign-in with a verified email. Accounts with the `superadmin` role are unaffected.

When you upgrade an existing deployment, an operator account created before this check is usually unverified and loses super-admin. Fix it in one of two ways:

- Configure an email sender. Signing in then sends a verification link.
- After confirming the account is yours (you can sign in with its password), mark it verified:

  ```bash
  cd apps/api
  bunx wrangler d1 execute DB --remote --env production --command "UPDATE user SET emailVerified = 1 WHERE email = 'you@example.com'"
  ```

## Apply migrations

Apply migrations before you deploy a version that depends on them. Migration `0034_auth_seams.sql` adds two-factor tables and a `session.mfaVerified` column; sign-in fails until it is applied.

```bash
cd apps/api
bunx wrangler d1 migrations apply DB --remote --env staging
bunx wrangler d1 migrations apply DB --remote --env production
```

Check which migrations are applied:

```bash
bunx wrangler d1 migrations list DB --remote --env <env>
```

For local development:

```bash
cd apps/api
bun run db:migrate:local
```

## Build

The Worker serves the admin SPA as static assets, so build the admin before deploying:

```bash
bun install
bun run build          # all workspaces, including the admin and API
```

Or only the admin:

```bash
bun run build:admin    # Vite build to apps/admin/dist/
```

## Deploy

| Environment | Command (from `apps/api`) | Worker |
| --- | --- | --- |
| Staging | `bun run deploy:staging` | `edgecms-api-staging` |
| Production | `bun run deploy:production` | `edgecms-api-production` |
| Default | `bun run deploy` | `edgecms-api` |

Each command bundles the Worker with `scripts/build-worker.ts` into `dist/worker.js`, then runs `cf deploy --mode <env>`, which uploads the Worker and the static assets from `apps/admin/dist/`.

### Deployment checklist

1. Run the local checks: `bun run check:all`.
2. Build: `bun run build`.
3. Apply migrations: `cd apps/api && bunx wrangler d1 migrations apply DB --remote --env <env>`.
4. Deploy: `cd apps/api && bun run deploy:<env>`.
5. Check health: `curl https://<worker-url>/api/health`.
6. Run the remote smoke test: `BASE_URL=https://<worker-url> bun run smoke:e2e:remote`.
7. On a fresh install, create the first operator account.

## Smoke tests

Playwright smoke tests run locally or by hand; CI does not run them. Run them before merging UI changes and after each deploy.

| Scope | Command |
| --- | --- |
| Admin against mocked API responses | `bun run smoke:e2e:local` |
| Local admin and API | `bun run smoke:e2e:local-live` |
| Seed the local smoke tenant, user and collection | `bun run db:seed:smoke` |
| Local publish, public read and media upload | `E2E_ADMIN_EMAIL=smoke.admin@example.com E2E_ADMIN_PASSWORD=<seed-password> E2E_TENANT_SLUG=smoke E2E_COLLECTION_SLUG=smoke-posts bun run smoke:e2e:local-live -- --live-persisted` |
| A deployed Worker | `BASE_URL=https://<worker-url> bun run smoke:e2e:remote` |
| Publish, public read and media upload on a deployed Worker | `E2E_ADMIN_EMAIL=<email> E2E_ADMIN_PASSWORD=<password> E2E_TENANT_SLUG=<slug> E2E_COLLECTION_SLUG=<collection> BASE_URL=https://<worker-url> bun run smoke:e2e:remote -- --live-persisted` |
| Broader local UI smoke | `bun run smoke:e2e:full` |

Before the specs, the runner checks merge markers, typechecks and builds the admin, installs Playwright Chromium and runs a health check for the mode. It exits non-zero on failed specs, browser page errors, console errors, visible 500 or 503 error pages, or a failed `/api/health` check, then prints a JSON summary.

The default remote smoke checks health and the deployed admin UI. The live persisted run is the one that confirms first publish, public API read and media upload against real data.

## CI and release checks

The repository ships two workflows in `.github/workflows/`:

| Workflow | Trigger | Runs |
| --- | --- | --- |
| `ci.yml` | Push or pull request to `main`, manual dispatch | PRD reference check, merge markers, lint, `check:docs`, typecheck, `check:tests` |
| `publish-packages.yml` | Manual dispatch, with a dry-run option | `check:release:library`, `check:package`, package publish |

It does not ship deploy workflows. `bun run check:release` checks a hosted deployment and fails until:

- The placeholder D1 and KV IDs in `apps/api/wrangler.toml` are replaced.
- `.github/workflows/deploy-staging.yml` and `deploy-production.yml` exist and run `check:release` before `bun run deploy:staging` and `bun run deploy:production`.

`bun run check:release:library` skips those two checks and verifies a framework release: package versions, `CHANGELOG.md`, the `wrangler.toml` environments and the deploy script target.

If you add your own deploy workflows, give them these GitHub secrets and variables:

| Name | Kind | Purpose |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | Secret | Authenticates Wrangler in GitHub Actions |
| `CLOUDFLARE_ACCOUNT_ID` | Secret | Selects the Cloudflare account |
| `STAGING_URL` | Variable | Deployed staging URL, for the smoke test |
| `PRODUCTION_URL` | Variable | Deployed production URL, for the smoke test |

Runtime secrets such as `BETTER_AUTH_SECRET`, `JWT_HS256_SECRET`, `SUPER_ADMIN_EMAILS`, `CORS_ALLOWED_ORIGINS` and `BASE_URL` still belong in Cloudflare, set with `wrangler secret put --env <env>`.

## Roll back

Cloudflare keeps previous Worker versions, so a code rollback takes seconds.

1. List recent deployments:

   ```bash
   cd apps/api
   bunx wrangler deployments list --env <env>
   ```

2. Roll back to the previous version, or to a specific version id from the list:

   ```bash
   bunx wrangler rollback --env <env>
   bunx wrangler rollback <version-id> --env <env>
   ```

3. Check the result:

   ```bash
   curl https://<worker-url>/api/health
   bunx wrangler deployments list --env <env>
   ```

### Rolling back the database

A Worker rollback does not revert D1. If a deployment included a migration you need to undo:

1. Roll back the Worker first, so the new code stops running.
2. Write a reverse migration: change the schema back, generate a migration, review it and apply it.

   ```bash
   cd apps/api
   bun run db:generate
   bunx wrangler d1 migrations apply DB --remote --env <env>
   ```

3. Or restore the database to a point before the migration with D1 Time Travel; see the [Operations guide](./operations-guide.md).

## Custom domains

1. Make sure the domain, or a parent zone, is active in Cloudflare DNS.
2. Add the domain to the Worker, either in the Cloudflare dashboard (Worker → Settings → Domains & Routes → Add → Custom domain) or in `wrangler.toml` under the environment:

   ```toml
   [env.production]
   routes = [{ pattern = "cms.example.com", custom_domain = true }]
   ```

3. Cloudflare creates the DNS record and issues a TLS certificate.

To use a route instead, add a proxied DNS record for the hostname (for example a `CNAME` named `cms` pointing to `edgecms-api-production.<account>.workers.dev`), then add the route pattern `cms.example.com/*` to the Worker.

A typical setup uses one subdomain per environment:

| Environment | Domain |
| --- | --- |
| Staging | `cms-staging.example.com` |
| Production | `cms.example.com` |

Cloudflare's free certificates cover one subdomain level, so prefer `cms-staging.example.com` over `cms.staging.example.com`.

After adding a domain:

- Update `BASE_URL` and `CORS_ALLOWED_ORIGINS` to the new origin.
- Turn on "Always Use HTTPS" for the zone.
- Consider setting the minimum TLS version to 1.2 under SSL/TLS settings.
