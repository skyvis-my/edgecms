# Postgres migrations (OSS / Docker / Kubernetes)

Cloudflare Workers continue to use `../migrations` (SQLite / D1).

This directory is for the **optional** Postgres backend used by:

- `DATABASE_DRIVER=postgres`
- `bun --config bunfig.hosting.toml run src/hosting/migrate.ts`
- `deploy/docker/docker-compose.yml` (postgres service)

## Baseline

`0000_baseline.sql` is generated from the SQLite migration history:

```bash
cd apps/api
bun scripts/generate-postgres-baseline.ts
```

It is a heuristic translation (quoted identifiers, deferred FKs, AUTOINCREMENT → BIGSERIAL). Review before production. New D1 migrations should be followed by regenerating (or adding an incremental `0001_*.sql` here) before shipping the OSS path.

## Apply

```bash
export DATABASE_DRIVER=postgres
export DATABASE_URL=postgres://edgecms:edgecms@127.0.0.1:5432/edgecms
export BETTER_AUTH_SECRET="$(openssl rand -base64 48)"
bun --config bunfig.hosting.toml run src/hosting/migrate.ts
```

Applied files are recorded in `edgecms_schema_migrations`.
