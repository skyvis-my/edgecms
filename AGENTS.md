# EdgeCMS Project Context

## Project Overview

**EdgeCMS** is a full-stack Content Management System designed to run on the Edge. It utilizes a monorepo structure to house both the React-based administrative dashboard and the ElysiaJS-powered backend API, deployed on Cloudflare Workers.

*   **Type:** Full-stack Monorepo (Bun Workspaces)
*   **Primary Language:** TypeScript
*   **Package Manager:** Bun

## Architecture & Tech Stack

The project is split into two primary workspaces:

### 1. Admin Dashboard (`apps/admin`)
*   **Framework:** React 19 + Vite
*   **UI Library:** shadcn/ui + Tailwind CSS v4
*   **Routing:** TanStack Router
*   **State/Data:** TanStack Query, Zustand
*   **Charts:** Recharts
*   **API Client:** `@elysiajs/eden` (Type-safe client for Elysia)

### 2. API (`apps/api`)
*   **Runtime:** Cloudflare Workers
*   **Framework:** ElysiaJS
*   **Database:** Drizzle ORM + Cloudflare D1 (SQLite)
*   **Storage:** Cloudflare R2 (Media), KV (Cache)
*   **Search:** Cloudflare Vectorize (Semantic Search)
*   **Background Jobs:** Cloudflare Queues (Webhooks), Durable Objects (Scheduling)
*   **Deployment:** The API worker serves the Admin SPA static assets in addition to API routes (`/api/*`).

## Building and Running

The project uses `bun` for all lifecycle scripts.

### Core Commands

| Action | Command | Description |
| :--- | :--- | :--- |
| **Install** | `bun install` | Install dependencies for all workspaces |
| **Dev (All)** | `bun run dev` | Start both Admin (Vite) and API (Wrangler) in dev mode |
| **Dev (Admin)** | `bun run dev:admin` | Start only the Admin dashboard |
| **Dev (API)** | `bun run dev:api` | Start only the API server |
| **Build** | `bun run build` | Build all workspaces (Admin -> `dist`, API -> worker) |
| **Check All** | `bun run check:all` | Run all quality gates (Types, Tests, Lint) |
| **Clean** | `bun run clean` | Remove `node_modules` and build artifacts |

### Database Management (Drizzle)

Commands must be run from `apps/api` or via filter:

*   **Generate Migrations:** `bun run --filter edgecms-api db:generate`
*   **Migrate (Local):** `bun run --filter edgecms-api db:migrate:local`
*   **Studio (Local):** `bun run --filter edgecms-api db:studio:local`

## Project Structure

```text
/
├── apps/
│   ├── admin/              # Frontend Workspace
│   │   ├── src/
│   │   │   ├── components/ # Shared UI components (shadcn)
│   │   │   ├── features/   # Feature-based modules (auth, dashboard, etc.)
│   │   │   ├── lib/        # Core utilities (api-client, auth-client)
│   │   │   └── routes/     # TanStack Router definitions
│   │   └── vite.config.ts  # Vite configuration (proxy to API)
│   │
│   └── api/                # Backend Workspace
│       ├── src/
│       │   ├── main.ts     # Entry point & app definition
│       │   ├── contract.ts # Eden treaty/contract definition
│       │   └── ...         # Feature modules (mirroring admin features mostly)
│       ├── drizzle/        # Database schemas and migrations
│       └── wrangler.toml   # Cloudflare Worker configuration & bindings
│
├── package.json            # Root workspace & scripts
└── bun.lock                # Lockfile
```

## Key Configuration

*   **`apps/api/wrangler.toml`**: Defines Cloudflare bindings.
    *   **DB**: `edgecms-db` (D1)
    *   **CACHE**: KV Namespace
    *   **MEDIA**: `edgecms-media` (R2)
    *   **ASSETS**: Serves `../admin/dist`
*   **`apps/admin/vite.config.ts`**:
    *   Proxies `/api` to `http://localhost:8787` (the local Wrangler dev server).
    *   Uses `@tanstack/router-plugin/vite`.

## Development Conventions

*   **Linting:** `oxlint` is used for fast linting (`bun run lint`).
*   **Testing:**
    *   Unit/Integration: `bun test` (Vitest-compatible).
    *   E2E: Playwright (`apps/admin/e2e`).
*   **Type Safety:** Strict TypeScript is enforced. `bun run typecheck` runs `tsc`.
*   **Code Quality:** Use `bun run check:all` before pushing. It runs merge-marker checks, typechecks, tests, and linter.
*   **Imports:** Admin app forbids direct `axios` usage; use the typed API client (`@/lib/api-client`).
*   **Best Practices:** See `docs/best-practices.md` for project-wide patterns and `docs/elysia-typescript-backend-api-best-practices.md` for ElysiaJS + TypeScript backend API standards.

## Agentic Workflow

Implement one bounded ticket at a time. Do not freestyle architecture, add future-ticket features, or refactor unrelated systems.

Before coding, define:

*   **Goal:** User-visible behavior or system invariant being changed.
*   **Allowed areas:** Files/modules expected to change.
*   **Do not touch:** Related surfaces outside scope.
*   **Risks:** Tenant isolation, auth, data loss, edge runtime, cost, latency, UX, and release risks.
*   **Verification:** Narrowest useful commands and any manual/browser checks.

High-stakes changes include auth, tenant boundaries, AI command execution, content publishing, asset storage, migrations, Cloudflare Worker behavior, cost-sensitive paths, public admin workflows, and release/deployment changes. Review findings on these are release gates, not brainstorming notes. Findings must come before feature ideas, cite concrete files/routes/functions, and include evidence. Any unresolved High severity finding blocks completion unless the user explicitly accepts the risk.

For risky fixes, use adversarial hypothesis-driven TDD:

1. Write down concrete breakage hypotheses in the PR description.
2. Convert the highest-value hypothesis into one failing public-behavior test.
3. Make it pass with the smallest scoped change.
4. Repeat only when the next hypothesis still justifies the blast radius.

Every ticket run should end with:

*   Summary of changes
*   Files changed
*   Commands run
*   Build/test results
*   Manual verification performed, when relevant
*   Docs updated or docs still needed
*   Risks and follow-up tickets
