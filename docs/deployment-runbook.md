# EdgeCMS Deployment Runbook

This document covers end-to-end deployment of EdgeCMS, from initial resource provisioning through production deployment and rollback procedures.

## Prerequisites

Before deploying EdgeCMS, ensure the following are installed and configured:

| Prerequisite | Minimum Version | Notes |
|---|---|---|
| Cloudflare account | — | With Workers Paid plan (required for Durable Objects, Queues, Vectorize) |
| Wrangler CLI | >= 4.x | `npm install -g wrangler` then `wrangler login` |
| Bun | >= 1.1 | [bun.sh](https://bun.sh) — used as the package manager and runtime |
| Git | >= 2.x | For cloning the repository |

Verify your setup:

```bash
wrangler --version
bun --version
wrangler whoami          # Confirm authenticated Cloudflare account
```

## Resource Provisioning

All Cloudflare resources must be created before the first deployment. Run the commands below for each target environment (`staging` and `production`). Replace `<env>` with the environment name.

### D1 Database

```bash
# Create the database
wrangler d1 create edgecms-db-<env>

# Note the database_id from the output and update wrangler.toml:
#   [[env.<env>.d1_databases]]
#   database_id = "<returned-database-id>"
#   migrations_dir = "drizzle/migrations"
```

### KV Namespace

```bash
# Create the KV namespace
wrangler kv namespace create CACHE --env <env>

# Note the namespace ID from the output and update wrangler.toml:
#   [[env.<env>.kv_namespaces]]
#   id = "<returned-namespace-id>"
```

### R2 Bucket

```bash
# Create the R2 bucket
wrangler r2 bucket create edgecms-media-<env>
```

### Queues

```bash
# Create the webhook delivery queue
wrangler queues create edgecms-webhook-queue-<env>
```

### Vectorize Index

```bash
# Create the vector index for semantic media search
# Dimensions and metric must match the embedding model used by EdgeCMS
wrangler vectorize create edgecms-assets-vectors-<env> \
  --dimensions 768 \
  --metric cosine
```

### Durable Objects

Durable Objects (e.g., `PublishScheduler`) are declared in `wrangler.toml` and do not require separate provisioning commands. They are created automatically when the Worker is deployed with the corresponding bindings and migration tags.

Ensure the `[[migrations]]` table is present in the top-level config:

```toml
[[migrations]]
tag = "v1"
new_classes = ["PublishScheduler"]
```

### After Provisioning

After creating all resources, update `wrangler.toml` with the actual IDs returned by each provisioning command. The placeholder values (`STAGING_DATABASE_ID`, `STAGING_KV_NAMESPACE_ID`, `PRODUCTION_DATABASE_ID`, `PRODUCTION_KV_NAMESPACE_ID`) must be replaced with real identifiers.

## Secret Management

Secrets are stored securely in Cloudflare and injected at runtime. They are **not** committed to source control.

Set secrets per environment using:

```bash
wrangler secret put <SECRET_NAME> --env <env>
```

### Required Secrets

| Secret | Description | Required |
|---|---|---|
| `BETTER_AUTH_SECRET` | Signing key for better-auth sessions and tokens | Yes |
| `JWT_HS256_SECRET` | HS256 key for public API JWT verification | Yes |
| `CF_API_TOKEN` | Cloudflare API token for runtime D1/KV/R2 provisioning | Yes |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID (used by runtime provisioning) | Yes |
| `SUPER_ADMIN_EMAILS` | Comma-separated list of super-admin email addresses | Yes |
| `CORS_ALLOWED_ORIGINS` | Comma-separated allowed origins (e.g., `https://cms.example.com`) | Yes |
| `BASE_URL` | Canonical base URL of the deployment (e.g., `https://cms.example.com`) | Yes |
| `QWEN_API_KEY` | Qwen (DashScope) API key for AI features | Yes (if AI enabled) |
| `GEMINI_API_KEY` | Google Gemini API key (fallback AI provider) | Yes (if AI enabled) |
| `AI_GATEWAY_URL` | Cloudflare AI Gateway endpoint URL | Yes (if AI enabled) |
| `ENABLE_AI_IMPORT_REVIEW` | Enables post-launch AI import review beta endpoints | No for `0.1.0`; yes only for beta |

### Example: Setting All Secrets for Production

```bash
ENV=production

wrangler secret put BETTER_AUTH_SECRET --env $ENV
wrangler secret put JWT_HS256_SECRET --env $ENV
wrangler secret put CF_API_TOKEN --env $ENV
wrangler secret put CLOUDFLARE_ACCOUNT_ID --env $ENV
wrangler secret put SUPER_ADMIN_EMAILS --env $ENV
wrangler secret put CORS_ALLOWED_ORIGINS --env $ENV
wrangler secret put BASE_URL --env $ENV
wrangler secret put QWEN_API_KEY --env $ENV
wrangler secret put GEMINI_API_KEY --env $ENV
wrangler secret put AI_GATEWAY_URL --env $ENV
# Post-launch beta only:
# wrangler secret put ENABLE_AI_IMPORT_REVIEW --env $ENV
```

Each command will prompt you interactively for the secret value.

### Listing Secrets

```bash
wrangler secret list --env <env>
```

## GitHub Actions Deployment

Deployment workflows live in `.github/workflows/`:

| Workflow | Trigger | Target | Gates |
|---|---|---|---|
| `deploy-staging.yml` | Push to `main` (when `STAGING_URL` is set) or manual dispatch | `vars.STAGING_URL` | CI, release readiness, build, D1 migrations, deploy, health smoke, PRD smoke |
| `deploy-production.yml` | Manual dispatch or `v*` tag | `vars.PRODUCTION_URL` | CI, production environment approval, release readiness, build, D1 migrations, deploy, health smoke, PRD smoke |

Configure these GitHub environment or repository secrets before using the workflows:

| Secret | Purpose |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Authenticates Wrangler in GitHub Actions |
| `CLOUDFLARE_ACCOUNT_ID` | Selects the Cloudflare account for Wrangler |

Set repository variables `STAGING_URL` and `PRODUCTION_URL` to your deployed Worker URLs, and replace the `STAGING_*` / `PRODUCTION_*` placeholder IDs in `apps/api/wrangler.toml` with your own D1 and KV IDs. `bun run check:release` fails until those placeholders are replaced.

Runtime Worker secrets such as `BETTER_AUTH_SECRET`, `JWT_HS256_SECRET`, `SUPER_ADMIN_EMAILS`, `CORS_ALLOWED_ORIGINS`, and `BASE_URL` still belong in Cloudflare via `wrangler secret put --env <env>`. GitHub Actions does not write those runtime secrets during deploy.

## E2E Smoke Checks

Use the root smoke runner instead of remembering individual Playwright commands:

| Scope | Command |
|---|---|
| Local mocked admin smoke | `bun run smoke:e2e:local` |
| Local admin + Wrangler API smoke | `bun run smoke:e2e:local-live` |
| Seed local smoke tenant/user/collection | `bun run db:seed:smoke` |
| Local persisted smoke | `E2E_ADMIN_EMAIL=smoke.admin@example.com E2E_ADMIN_PASSWORD=<seed-password> E2E_TENANT_SLUG=smoke E2E_COLLECTION_SLUG=smoke-posts bun run smoke:e2e:local-live -- --live-persisted` |
| Custom deployed URL | `BASE_URL=https://<worker-url> bun run smoke:e2e:remote` |
| Staging deployment | `STAGING_URL=https://<worker-url> bun run smoke:e2e:staging` |
| Production deployment | `PRODUCTION_URL=https://<worker-url> bun run smoke:e2e:production` |
| Optional live persisted staging check | `E2E_ADMIN_EMAIL=<email> E2E_ADMIN_PASSWORD=<password> E2E_TENANT_SLUG=<slug> E2E_COLLECTION_SLUG=<collection> STAGING_URL=https://<worker-url> bun run smoke:e2e:staging -- --live-persisted` |
| Broader local UI smoke | `bun run smoke:e2e:full` |

The runner performs merge-marker, admin typecheck, admin build, Playwright Chromium, and mode-specific health checks before the smoke specs. It exits non-zero on failed specs, browser page errors, console errors, visible 500/503 error pages, or a failed `/api/health` check, then prints a compact JSON summary.

Default remote smoke validates health and deployed admin UI regressions. The optional live persisted smoke is the P1 gate for first publish, public API read, and media upload against real backend state.

## Database Migrations

Migrations must be applied **before** (or immediately after) deploying a new version that depends on schema changes.

```bash
cd apps/api

# Apply migrations to the remote D1 database for the target environment
bunx wrangler d1 migrations apply DB --remote --env staging
bunx wrangler d1 migrations apply DB --remote --env production
```

To verify migration status:

```bash
wrangler d1 migrations list DB --env <env>
```

### Local Development Migrations

For local development against the local D1 emulator:

```bash
cd apps/api
bun run db:migrate:local
```

## Build

The admin SPA must be built before deployment since the Worker serves it via static assets.

```bash
# From the repository root
bun install
bun run build           # Builds both admin SPA and API
```

Or build individually:

```bash
bun run build:admin     # Vite build -> apps/admin/dist/
```

## Deployment

### Staging

```bash
cd apps/api
bun run deploy:staging
```

This runs `wrangler deploy --env staging`, which:
1. Bundles the Worker from `src/main.ts`
2. Uploads static assets from `apps/admin/dist/`
3. Deploys to the `edgecms-api-staging` Worker

### Production

```bash
cd apps/api
bun run deploy:production
```

This runs `wrangler deploy --env production`, deploying to the `edgecms-api-production` Worker.

### Default Environment (Development)

```bash
cd apps/api
bun run deploy
```

### Full Deployment Checklist

1. Ensure local gates pass: `bun run check:all`
2. Build deploy artifacts: `bun run build`
3. Apply database migrations: `cd apps/api && bunx wrangler d1 migrations apply DB --remote --env <env>`
4. Deploy the Worker: `cd apps/api && bun run deploy:<env>`
5. Verify the health endpoint: `node -e "fetch('https://<worker-url>/api/health').then(r=>r.json()).then(console.log)"`
6. Run the deploy smoke: `BASE_URL=https://<worker-url> bun run smoke:e2e:remote`

## Rollback Procedures

Cloudflare Workers supports instant rollback to the previous deployment version.

### Quick Rollback

```bash
# List recent deployments
wrangler deployments list --env <env>

# Roll back to the previous version
wrangler rollback --env <env>
```

`wrangler rollback` reverts to the immediately preceding deployment. The Worker starts serving the old version within seconds.

### Rollback with a Specific Version

```bash
# List deployments to find the target version ID
wrangler deployments list --env <env>

# Roll back to a specific deployment
wrangler rollback --env <env> --version-id <deployment-id>
```

### Database Rollback Considerations

Worker rollback does **not** revert D1 database changes. If a deployment included a migration that must be undone:

1. Roll back the Worker first to stop the new code from running.
2. Write and apply a reverse migration manually:
   ```bash
   cd apps/api
   # Edit the schema to revert changes, then generate a new migration
   bun run db:generate
   bun run db:migrate:remote -- --env <env>
   ```
3. Alternatively, use D1 Time Travel to restore the database to a point before the migration (see the [Operations Guide](./operations-guide.md) for details).

### Rollback Verification

After rolling back, verify:

```bash
# Health check
curl https://<worker-url>/api/health

# Check the active deployment
wrangler deployments list --env <env>
```

## DNS and Custom Domain Setup

### Adding a Custom Domain

1. Ensure the domain (or a parent zone) is active in Cloudflare DNS.
2. Add a custom domain to the Worker:
   ```bash
   wrangler domains add <your-domain.com> --env <env>
   ```
3. Cloudflare will automatically configure a DNS CNAME record and provision a TLS certificate.

### Manual DNS Configuration

If you prefer manual DNS setup:

1. Go to the Cloudflare dashboard for your zone.
2. Add a CNAME record pointing to your Worker's `*.workers.dev` subdomain:
   ```
   Type:  CNAME
   Name:  cms              (or your subdomain)
   Target: edgecms-api-production.<account>.workers.dev
   Proxy: Proxied (orange cloud)
   ```
3. In the Worker settings, add the custom domain as a route pattern:
   ```
   cms.example.com/*
   ```

### Environment-Specific Domains

A typical setup uses separate subdomains per environment:

| Environment | Domain |
|---|---|
| Staging | `cms-staging.example.com` |
| Production | `cms.example.com` |

### TLS and Security

- Cloudflare automatically provisions and renews TLS certificates for custom domains.
- Enable "Always Use HTTPS" in the Cloudflare dashboard for the zone.
- Consider enabling "Minimum TLS Version: 1.2" under SSL/TLS settings.
