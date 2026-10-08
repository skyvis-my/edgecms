# Agent Repo Map

Use this map when an agent needs to make a focused EdgeCMS change.

## Core Surfaces

- Admin app: `apps/admin/src/features`
- API worker: `apps/api/src`
- Shared schemas: `packages/schemas/src`
- Plugin SDK: `packages/plugin-sdk/src`
- Starter package: `packages/create-app`
- Public docs: `docs/public`
- Release and utility scripts: `scripts`
- Smoke/starter seed proof: `scripts/seed-smoke-db.ts`, `scripts/seed-smoke-db.test.ts`, `templates/starter/scripts/seed.ts`
- Docs claim proof: `scripts/docs-claim-scan.ts`, `scripts/docs-quality.test.ts`

## Common Proof Commands

- Schemas: `bun test packages/schemas`
- API focused test: `bun test apps/api/src/tests/<surface>/<file>.test.ts`
- Admin focused test: `bun test apps/admin/src/features/<surface>/<file>.test.tsx`
- Scripts: `bun test scripts/*.test.ts`
- Docs claims/links: `bun run check:docs`

## Boundaries

- Public plugin routes stay blocked unless tenant, auth, and cache tests exist.
- NPM publish and deployed proof require operator approval/receipts.
- Docs can describe deferrals, but must not claim unavailable runtime behavior.
