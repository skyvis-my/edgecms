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

## Scripts

```sh
bun run build
bun run typecheck
bun run check
```
