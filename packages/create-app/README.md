# create-edgecms-app

Private workspace CLI for generating an EdgeCMS starter app from the local template.

```bash
bun packages/create-app/src/index.ts my-edgecms-app
```

## Usage

```bash
create-edgecms-app <target-dir> [--template starter] [--force]
```

- `--template starter` is the only supported template.
- Existing non-empty target directories are refused unless `--force` is passed.
- Generated projects validate without Cloudflare credentials.
- Generated projects include `bun run validate` for typecheck plus smoke proof.

This package is private and not published to npm yet. Treat the command above as
local workspace proof, not an external install path.

## Publish Readiness Gate

Do not document external install commands such as `npm create edgecms-app` or `bun create edgecms-app` until all checks below have direct receipts:

- `bun test packages/create-app`
- `bun run --filter create-edgecms-app typecheck`
- `bun run --filter create-edgecms-app check:package`
- A generated starter runs its own smoke script successfully.
- A generated starter typechecks both `apps/api` and `apps/admin`.
- `templates/starter/README.md` still states that deploy proof and external package install are not shipped.

NPM publication also needs explicit release approval and registry credentials. A dry-run tarball is package-shape proof only.

## CI Candidate

The package-ready CI check should run the same local proof before any publish job exists:

```bash
bun test packages/create-app
bun run --filter create-edgecms-app typecheck
bun run --filter create-edgecms-app check:package
```

Keep publication as a separate, manually approved release step.
