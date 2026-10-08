# EdgeCMS

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/skyvis-my/edgecms)

EdgeCMS is an edge-native CMS with a React admin dashboard and Elysia API, designed for Cloudflare Workers, D1, KV, R2, Queues, Durable Objects, and tenant-aware public delivery.

Use EdgeCMS when you want a production CMS that runs close to users on Cloudflare instead of a Node-only starter. The local adoption path is intentionally small: install dependencies, start the API and admin, seed smoke data, publish one entry, and read it through tenant-scoped public delivery.

## Structure

```
.
├── apps/
│   ├── admin/     # React + Vite + shadcn/ui admin dashboard
│   └── api/       # Elysia + Drizzle ORM backend API
├── package.json   # Root workspace configuration
└── README.md
```

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

Seed and verify smoke path:

```bash
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

## Public Docs

- Quickstart: `docs/public/quickstart.md`
- Public docs index: `docs/public/README.md`
- Public API: `docs/public/public-api.md`
- Frontend integration: `docs/public/frontend-integration.md`
- Plugin SDK: `docs/public/plugin-sdk.md`
- Sample plugins: `docs/public/sample-plugins.md`
- Starter template checklist: `templates/starter/README.md`

## Starter Status

`packages/create-app` contains a private workspace `create-edgecms-app` CLI for local starter proof. It is not published to npm, and `templates/starter/README.md` remains the acceptance checklist before any external install path is claimed.

## Tech Stack

- **Admin**: React 19, Vite, Tailwind CSS, shadcn/ui, TanStack Router
- **API**: Elysia, Drizzle ORM, Cloudflare D1/KV/R2, Durable Objects, Queues

## API Environment

Configure these for Phase 1 features (set via `wrangler secret put` / deploy env vars):

- `BETTER_AUTH_SECRET`
- `ENTRA_CLIENT_ID`
- `ENTRA_CLIENT_SECRET`
- `ENTRA_TENANT_ID`
- `QWEN_API_KEY`
- `GEMINI_API_KEY`
- `AI_GATEWAY_URL`
- `AI_GATEWAY_ROUTE_ID` (optional)
- `AI_GATEWAY_GUARDRAILS_PROFILE_ID` (optional)

## Package Manager

This project uses [Bun](https://bun.sh) workspaces.

## License

[MIT](LICENSE)
