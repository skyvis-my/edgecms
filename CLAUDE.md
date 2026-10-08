# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

EdgeCMS is an AI-native, offline-first headless CMS built for Cloudflare Workers. It uses a Bun workspace monorepo with two apps: a React admin SPA and an ElysiaJS API running on Workers.

## Commands

```bash
# Development
bun run dev              # Start both admin (5173) and API (8787) dev servers
bun run dev:admin        # Admin only
bun run dev:api          # API only (wrangler dev with local D1)

# Build
bun run build            # Build all workspaces
bun run build:admin      # Vite build → apps/admin/dist/

# Lint & Format (Oxlint)
bun run lint             # oxlint check .
bun run lint:fix         # oxlint check --write .
bun run format           # oxlint format --write .
bun run typecheck        # TypeScript check all workspaces

# Database (run from apps/api/)
cd apps/api
bun run db:generate      # Generate Drizzle migration from schema changes
bun run db:migrate:local # Apply migrations to local D1
bun run db:migrate:remote # Apply migrations to remote D1
bun run db:studio        # Drizzle Studio GUI

# Deploy (run from apps/api/)
bun run deploy           # Default environment
bun run deploy:staging
bun run deploy:production
```

## Architecture

### Monorepo Structure

```
apps/
  admin/    # React 19 + Vite 7 + TanStack Router + shadcn/ui
  api/      # ElysiaJS on Cloudflare Workers + D1 + Drizzle ORM
```

Both apps are served from a single Cloudflare Worker. The Worker handles `/api/*` routes via ElysiaJS; all other routes serve the admin SPA via Workers Static Assets with SPA fallback (configured in `wrangler.toml`).

### API (apps/api/)

**Stack:** ElysiaJS + CloudflareAdapter, Drizzle ORM on D1, better-auth, ArkType validation

**Cloudflare Bindings** (defined in `wrangler.toml`, typed in `src/main.ts` as `Env`):
- `DB` — D1 database
- `CACHE` — KV namespace
- `MEDIA` — R2 bucket
- `ASSETS` — Static file serving

**Feature slices** follow a strict 3-layer vertical pattern:
```
src/{feature}/
  {feature}.controller.ts   # ElysiaJS routes
  {feature}.service.ts       # Business logic
  {feature}.repository.ts    # D1 queries via Drizzle
```

Per-feature layer rules:
- Controllers must stay thin: parse HTTP input, call service, map HTTP status/response only.
- Services own business rules, orchestration, and data mapping.
- Repositories are the only layer that performs Drizzle/D1 queries.
- Do not place business logic or direct DB queries in controllers ("fat controller" is not allowed).

**Auth pattern:** D1 bindings require request context, so auth uses a per-request factory:
```typescript
const auth = createAuth(env.DB, { secret: env.BETTER_AUTH_SECRET })
```
Routes requiring auth use the `{ auth: true }` macro which resolves `user` and `session` on the context.

**Shared schemas** (`src/shared/schemas/`) use ArkType for API validation contracts. Path alias: `@edgecms/schemas`.

**Database:** Schema files in `src/database/schema/`, migrations in `drizzle/migrations/`. Tables: user, session, account, verification (auth), collections, entries, entry_versions (CMS).

### Admin (apps/admin/)

**Stack:** React 19, Vite 7, TanStack Router (file-based), TanStack Query, Zustand, shadcn/ui, Tailwind CSS 4, React Hook Form + Zod

**Routing:** File-based via TanStack Router. Auto-generated `routeTree.gen.ts` (excluded from linting). Protected routes live under `routes/_authenticated/` which checks better-auth session and wraps content in the AppSidebar layout.

**Auth client** (`src/lib/auth-client.ts`): Uses `better-auth/react` with relative base URL `/` (same-origin). Exports `useSession`, `signIn`, `signUp`, `signOut`.

**Path alias:** `@/*` → `./src/*` (both apps).

## Code Style

- **Oxlint** handles linting and formatting (no ESLint/Prettier)
- No semicolons (`semicolons: "asNeeded"`)
- Single quotes for JS/JSX
- Line width: 100
- `noUnusedVariables` and `noUnusedImports` are errors
- Array shorthand syntax (`string[]` not `Array<string>`)
- `apps/admin/src/components/ui/` is excluded from linting (shadcn/ui generated)
- `routeTree.gen.ts` is auto-generated — never edit manually
- **Best Practices:** See `docs/best-practices.md` for project-wide conventions and `docs/elysia-typescript-backend-api-best-practices.md` for ElysiaJS + TypeScript backend API standards.

## Key Constraints

- **Cloudflare Workers compatibility:** `compatibility_date >= 2025-06-01` required for ElysiaJS CloudflareAdapter. Use `nodejs_compat` flag.
- **Elysia redirect on Workers:** `redirect()` doesn't work — use `Response.redirect()` with absolute URLs.
- **D1 is SQLite:** Drizzle config uses `dialect: 'sqlite'` with `d1-http` driver. No Postgres types.
- **ArkType v2 patterns:** Use `type()` for schema definitions, `type.infer` for TS type extraction, string-based constraints like `"1 <= number.integer <= 100"`.
- **better-auth base path:** Server mounts at `/api/auth`, client uses relative base URL `/`.

## Testing

- **Framework:** Vitest for all unit and integration tests
- **File pattern:** Colocated test files using `*.test.ts` (backend) and `*.test.tsx` (frontend components)
- **Backend tests:** Place `{feature}.service.test.ts` and `{feature}.repository.test.ts` alongside source files in the feature directory
- **Frontend tests:** Place `{component}.test.tsx` alongside source files in the feature/component directory
- **Coverage:** All new code must have tests. Backfill tests for existing Phase 1-7 code
- **Test naming:** Use descriptive `describe`/`it` blocks: `describe('CollectionService')` → `it('creates a collection with valid fields')`
- **Mocking:** Use Vitest's built-in mocking for D1, KV, and R2 bindings. Use `miniflare` for integration tests requiring Workers runtime

## AI Prompt Organization

- AI system prompts and tool definitions stored as separate files in `apps/api/src/ai/prompts/`
- Tool definitions use ArkType schemas (not Zod) for unified schema consistency across UI, API, and AI
- Prompt files named by purpose: `system.ts`, `tools/{command-type}.ts`

## Multi-Tenant Routing

| Route Pattern | Scope | Purpose |
|---|---|---|
| `/api/admin/...` | Global super-admin | Tenant CRUD, global user management |
| `/api/tenants/:tenantSlug/admin/...` | Tenant-scoped admin | Collections, entries, commands, sync within tenant |
| `/api/tenants/:tenantSlug/public/...` | Tenant-scoped public | Cached public read API per tenant |
| `/api/auth/...` | Global | Authentication (shared across tenants) |

## Webhook Event Naming

- Dot-notation format: `{entity}.{action}` (e.g., `entry.created`, `entry.updated`, `entry.deleted`)
- Lifecycle events: `entry.published`, `entry.unpublished`, `entry.scheduled`
- Relation events: `relation.linked`, `relation.unlinked`
- Schema events: `collection.created`, `collection.updated`, `collection.deleted`
- Bulk events: `entry.bulk_updated`

## Cloudflare Bindings (Phase 2 additions)

- `WEBHOOK_QUEUE` — Cloudflare Queue for webhook delivery
- `CF_API_TOKEN` — Secret for Cloudflare API (runtime D1/KV/R2 provisioning)
- `AI_GATEWAY_URL` — Cloudflare AI Gateway endpoint
- `QWEN_API_KEY` — Qwen (DashScope) API key
- `GEMINI_API_KEY` — Google Gemini API key (fallback)
