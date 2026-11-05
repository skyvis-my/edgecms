# EdgeCMS Plugin SDK

Type-safe authoring contracts for trusted EdgeCMS plugins.

The package is publish-ready, but remains private until release approval. It emits ESM JavaScript and TypeScript declaration files to `dist`.

## Usage

```ts
import type { PluginDefinition } from '@edgecms/plugin-sdk'

export const plugin = {
  metadata: {
    displayName: 'SEO Metadata',
    description: 'Adds SEO metadata fields and AI commands.',
    version: '1.0.0',
  },
  edgecms: '>=0.2.0 <1.0.0',
  dependencies: { 'audit-trace': '^1.0.0' },
  bindings: [{ name: 'MEDIA', kind: 'r2' }],
  hooks: {
    beforeCommand: async (ctx) => {
      ctx.requestId
    },
  },
} satisfies PluginDefinition
```

## Boundary

- Dependency-free package.
- Type and helper boundary only.
- No imports from `apps/api`.
- Runtime loading, validation, sandboxing, and route safety stay in the EdgeCMS API worker.
- Route descriptors are type-only proof helpers; runtime route factories are still validated by the API loader.
- Admin list response types mirror `/api/admin/plugins`.
- Admin contribution types (`TrustedAdminContributionEntry`) and their validators (`validateAdminContributionEntry`, `composeAdminContributions`) are pure functions with no framework dependency (HS-10).
- Extension contract (EX-02): a definition can declare `edgecms` (supported framework versions), `dependencies` (other trusted plugins with version ranges) and `bindings` (D1, KV, R2, Queue or secret names). `composePluginContracts` checks them all, fails closed per plugin, detects dependency cycles and returns a deterministic load order. The API loader calls it at composition time.
- A small semver range matcher (`satisfiesSemverRange`, `isValidSemverRange`, `parseSemver`, `compareSemver`) that runs in a Worker. It supports `x`/`*`, `^`, `~`, comparators, hyphen ranges and `||`; anything it cannot parse never matches.

## Scripts

```sh
bun run build
bun run typecheck
bun run check
```
