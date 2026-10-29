# Publishing `@edgecms/*` packages

Public packages from this repo:

| Package | Path | Notes |
| --- | --- | --- |
| `@edgecms/client` | `packages/client` | ESM + types in `dist/` |
| `@edgecms/schemas` | `packages/schemas` | TypeScript source (`src/`) |
| `@edgecms/runtime` | `packages/runtime` | Worker bootstrap + Eden types |
| `@edgecms/plugin-sdk` | `packages/plugin-sdk` | Plugin authoring contracts |
| `create-edgecms-app` | `packages/create-app` | Scaffold CLI |

All use SemVer via [Changesets](../../.changeset/README.md) (fixed version set). Access is public (`publishConfig.access: public`).

## Local dry-run (no secrets)

```bash
bun install
bun run check:package
bun run publish:packages:dry-run
```

Each package also runs `npm pack --dry-run` inside `check`.

## CI publish

Workflow: [`.github/workflows/publish-packages.yml`](../../.github/workflows/publish-packages.yml).

- Manual dispatch with `dry_run: true` (default) → qualify only.
- Manual dispatch with `dry_run: false`, or a GitHub Release `published` event → publish when `NPM_TOKEN` is set.
- If `NPM_TOKEN` is missing, the job notices and runs dry-run instead of failing.

Set the secret once:

```bash
gh secret set NPM_TOKEN -R skyvis-my/edgecms --body "<npm automation token>"
```

The token needs publish rights on the `@edgecms` npm org (create the org/scope on npmjs.com first if it does not exist).

## Manual publish without Actions

```bash
export NPM_TOKEN=…   # or NODE_AUTH_TOKEN
bun run version-packages   # if Changesets pending
bun run check:release:library
bun run check:package
bun run publish:packages
```

`scripts/publish-packages.ts` publishes the fixed set with `--access public`.

## Consumers

After the first successful publish:

```bash
bun add @edgecms/client@^0.2.0
bun add @edgecms/schemas@^0.2.0
```

Until then, pack locally:

```bash
cd packages/client && npm pack
bun add ./edgecms-client-0.2.0.tgz
```

Hosted product (`skyvis-my/edgecms-saas`) pins these packages (registry or `file:` vendor tarballs during cutover) instead of treating in-tree workspaces as the long-term base. Git `upstream` merges remain optional for app/framework source.
