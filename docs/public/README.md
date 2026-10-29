# EdgeCMS developer guides

Guides for developers who run EdgeCMS, model content in it, or read its content from a frontend. EdgeCMS is an open-source headless CMS: an Elysia API on Cloudflare Workers with a React admin, storing data in D1, KV and R2.

## Start

- [Quickstart](quickstart.md): run the API and admin locally, seed sample data and read your first published entry.

## Build

- [Content model](content-model.md): collections, singletons, field types and locales.
- [Public API](public-api.md): routes, query parameters, response shapes, errors and cache headers for published content.
- [Frontend integration](frontend-integration.md): fetch examples for plain `fetch`, Next.js and Astro, plus revalidation handlers.
- [Client SDK](client-sdk.md): the typed `@edgecms/client` package.
- [Publishing packages](publishing-packages.md): Changesets, SemVer, npm dry-run / publish for `@edgecms/*`.
- [Commands](commands.md): the command envelope used for every content change.
- [Webhooks](webhooks.md): signed event delivery, destination rules and dry runs.
- [Media](media.md): uploads, asset variants and public asset routes.

## Secure

- [Auth and access](auth-and-access.md): sign-in, roles, API keys and tenant isolation.
- [Operations and security](operations-security.md): audit ledger, personal data requests, rate limits, security headers and backups.

## AI and agents

- [AI command safety](ai-command-safety.md): dry runs, preview receipts and the per-tenant AI switch.
- [MCP server](mcp-server.md): connect AI clients to EdgeCMS over the Model Context Protocol.

## Extend

- [Plugin SDK](plugin-sdk.md): write a trusted plugin with hooks, AI tools, fields and admin routes.
- [Sample plugins](sample-plugins.md): the example plugins in `examples/plugins`.
- [Hosting seams](hosting-seams.md): `createApp({ host })` policies for running EdgeCMS as a multi-customer service.

## Deploy

- [Deployment runbook](../deployment-runbook.md): provision Cloudflare resources, set secrets, migrate, deploy and roll back.
- [Operations guide](../operations-guide.md): health checks and day-to-day operations.

## Contributing

- [Agent repo map](agent-repo-map.md): where code lives and which focused tests to run. Written for coding agents.
- Starter template checklist: `templates/starter/README.md`. `create-edgecms-app` and `@edgecms/*` packages are publishable — see [publishing-packages.md](publishing-packages.md).
- Public fetch helper: `examples/public-fetch/plain-fetch.ts`.

Release checks run from the repo root:

```bash
bun run check:docs                      # docs claim scan and link check
bun test scripts/docs-quality.test.ts   # tests for the docs scripts
bun run check:package                   # create-app, plugin SDK, runtime and client package checks
bun run smoke:e2e:local-live -- --live-persisted   # publish, public read and media upload against local services
bun run perf:public-read:local          # local public read timing
```

Focused tests for the seed script, ops readiness schema and admin content screens:

```bash
bun test scripts/seed-smoke-db.test.ts packages/schemas/src/__tests__/ops-readiness.test.ts apps/admin/src/features/collections/collections.test.tsx apps/admin/src/features/entries/entry-edit.test.tsx apps/admin/src/features/entries/components/entry-form.layout.test.tsx apps/admin/src/features/entries/components/entry-form-schema.test.ts
```

`bun run check:docs` rejects docs that state unsupported capabilities, such as npm publication, a marketplace, GraphQL parity, generated OpenAPI for every route, production migrations or backups, and remote performance results. Results from a deployed Worker (URL, remote migrations, backups, remote performance, npm publication) come from the operator who ran them, not from these local checks.
