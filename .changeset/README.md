# Changesets

SemVer for published packages: `@edgecms/client`, `@edgecms/schemas`, `@edgecms/runtime`, `@edgecms/plugin-sdk`, `create-edgecms-app`.

## Workflow

1. On a PR that changes a publishable package, add a changeset:

```bash
bunx changeset
```

2. Merge the PR. On release, version packages:

```bash
bun run version-packages
```

That bumps versions in the fixed set, updates `CHANGELOG` entries Changesets owns, and deletes consumed changeset files. Keep root / apps / `CHANGELOG.md` aligned with the package version (see `check:release:library`).

3. Publish (needs `NPM_TOKEN` for a real push):

```bash
bun run publish:packages:dry-run   # always safe
bun run publish:packages           # requires NPM_TOKEN / NODE_AUTH_TOKEN
```

Or dispatch **Publish Packages** on GitHub Actions (`dry_run: false` after secrets are set). Without `NPM_TOKEN`, the workflow qualifies packs and stops.

## First publish

Packages start at `0.2.0`. First npm publish is intentional operator action after dry-run passes — not automatic on every merge.
