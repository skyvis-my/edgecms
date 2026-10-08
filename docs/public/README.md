# EdgeCMS Public Docs

Use these docs when evaluating or adopting EdgeCMS outside the internal release process. They describe real repo commands and current public delivery routes only.

## Start Here

- `docs/public/quickstart.md`: checkout-to-first-public-read path.
- `docs/public/public-api.md`: public content delivery contract.
- `docs/public/frontend-integration.md`: fetch examples for frontend apps.
- `docs/public/ai-command-safety.md`: AI command envelope, audit, and rejection boundaries.
- `docs/public/operations-security.md`: smoke fixtures, admin readiness, audit, rate-limit, security-header, and backup boundaries.
- `docs/public/agent-repo-map.md`: code surfaces and proof commands for agents.
- `examples/public-fetch/plain-fetch.ts`: minimal tenant-scoped public fetch helper.
- `docs/public/plugin-sdk.md`: trusted plugin authoring contract.
- `docs/public/sample-plugins.md`: sample plugin acceptance specs.
- `templates/starter/README.md`: acceptance checklist for a future starter template.

## Proof Index

- Starter proof: `packages/create-app` tests and `npm pack --dry-run --json`.
- Developer Export proof: focused admin collection export tests.
- Public delivery proof: `bun run smoke:e2e:local-live -- --live-persisted`.
- Performance proof: `bun run perf:public-read:local` for local behavior, `bun run perf:public-read:remote` only with an operator-provided deployed URL.
- Release proof: `bun run check:package` checks create-app and plugin SDK package gates; `bun run check:docs` runs docs claim/link checks.
- Claim hygiene proof: `bun test scripts/docs-quality.test.ts` and `bun run check:docs` reject unsupported publish, deploy, marketplace, OpenAPI, GraphQL, migration, backup, cache, and remote-performance claims.
- Plugin proof: trusted plugin SDK docs and package checks; public plugin routes remain deferred.
- Ops/admin proof: `bun test scripts/seed-smoke-db.test.ts packages/schemas/src/__tests__/ops-readiness.test.ts apps/admin/src/features/collections/collections.test.tsx apps/admin/src/features/entries/entry-edit.test.tsx apps/admin/src/features/entries/components/entry-form.layout.test.tsx apps/admin/src/features/entries/components/entry-form-schema.test.ts`.
- Data portability proof: current docs describe export and non-destructive import-preview boundaries only; no destructive import apply or parity claim.

`packages/create-app` is a private workspace `create-edgecms-app` proof package. It is not published or installable outside this repo yet. Starter docs remain checklist material until the repo quickstart passes on a clean checkout.

Missing external proof must stay explicit in release notes: deployed URL, remote migration receipt, production backup/export receipt, marketplace listing, npm publication, remote performance receipt, and public plugin route rollout are not proven by local docs checks.
