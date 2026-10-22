# EdgeCMS admin

The React admin for EdgeCMS: content modelling, editing, publishing, media, users and tenant settings. The API Worker serves the built admin as static assets, so production has one origin; in development Vite proxies `/api` to the local API.

## Run it

From the repository root:

```bash
bun install
bun run dev:api     # API on http://localhost:8787
bun run dev:admin   # admin on http://localhost:5173
```

See the [quickstart](../../docs/public/quickstart.md) for migrations, seed data and the first sign-in.

## Scripts

| Command | What it does |
| --- | --- |
| `bun run dev` | Vite dev server with the `/api` proxy |
| `bun run build` | Typecheck and build to `dist/` (served by the API Worker) |
| `bun run typecheck` | `tsc -b` |
| `bun run lint` | oxlint |
| `bun run test` | Unit and component tests (`bun test`) |
| `bun run test:e2e` | Playwright suites in `e2e/` (run by hand; CI does not run Playwright) |

## Layout

| Path | Contents |
| --- | --- |
| `src/routes/` | TanStack Router file routes; `_authenticated/` needs a session |
| `src/features/` | Feature modules: auth, collections, entries, media, sync, tenants, … |
| `src/components/ui/` | shadcn/ui primitives (generated; excluded from lint) |
| `src/lib/` | Typed API client (Eden), auth client, utilities |
| `e2e/` | Playwright smoke and live suites |

Use the typed client in `@/lib/api-client`; direct `axios` calls are not allowed.

## Credits

The admin shell started from [shadcn-admin](https://github.com/satnaing/shadcn-admin) by Sat Naing (MIT). See [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).
