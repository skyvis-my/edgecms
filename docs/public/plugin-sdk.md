# EdgeCMS Plugin SDK

EdgeCMS currently supports trusted runtime plugins. A plugin is loaded only when it is listed in the trusted catalog and enabled by runtime configuration plus KV state.

This is the first stable boundary for extensions. Do not treat arbitrary uploaded code as supported.

## Current Files

- `packages/plugin-sdk/src/index.ts`
- `apps/api/src/plugins/plugin-hooks.ts`
- `apps/api/src/plugins/plugin-registry.ts`
- `apps/api/src/plugins/plugin-loader.ts`
- `apps/api/src/plugins/trusted-plugin-catalog.ts`
- `apps/api/src/plugins/plugins.controller.ts`
- `apps/admin/src/features/plugins`
- `examples/plugins/preview-revalidation.plugin.ts`

## Package Boundary

Use `@edgecms/plugin-sdk` as the type-only authoring package for trusted plugins:

```ts
import type {
  LoadedPluginMetadata,
  PluginDefinition,
  PluginGeneratedCommand,
  PluginHookContext,
  PluginRouteDescriptor,
} from '@edgecms/plugin-sdk'
```

The SDK remains private until release approval, but the package shape is publish-ready. It emits ESM JavaScript and TypeScript declarations to `packages/plugin-sdk/dist`, and its package exports point at that build output.

Package invariants:

- Dependency-free.
- `private: true` until manual publish approval.
- `types`, `exports`, and packed files resolve to `dist`.
- No imports from `apps/api` or Worker runtime modules.
- Runtime loading, validation, sandboxing, and route safety remain inside `apps/api/src/plugins`.

## Runtime Model

Plugins are declared by manifest name. The loader resolves each manifest against the trusted catalog, then registers only safe capabilities:

- Hooks
- AI tools
- Field types
- Admin plugin routes
- Admin menu items

Unknown plugins are marked `blocked`. Disabled plugins remain visible but do not register runtime behavior.

Manifest proof is fail-closed: a plugin is trusted only when it resolves from the trusted catalog. Manifest config alone cannot grant routes, hooks, fields, AI tools, admin menu items, or public access.
The shared release schema also records plugin permissions and hook timeout budget as local proof. A trusted manifest is considered safe only when it is enabled, sourced from the trusted catalog, includes explicit permissions, and keeps the hook timeout at or below the current local budget.

## Hook Contract

Supported hook names:

- `beforeCommand`
- `afterCommand`
- `beforeAiCommand`

Hook context:

```ts
type PluginHookContext = {
  requestId: string
  pathname: string
  method: string
  tenantScope?: string
  commandType?: string
  commandStatus?: 'success' | 'failed' | 'dry_run'
  commandId?: string
  actorSource?: string
  prompt?: string
  dryRun?: boolean
  commandCount?: number
}
```

Hooks receive a frozen context. They must be fast and side-effect aware. The registry uses a short timeout so plugin hooks cannot dominate the request path.

Timeout proof belongs in plugin registry tests. If a hook needs slow network or storage work, move it behind an async queue/background path instead of extending request-critical timeout.
The shared release schema keeps the default hook budget at 250 ms or lower for local proof. Raising that budget needs a focused registry test and latency rationale.

## Trusted Definition

A trusted plugin can define:

```ts
type PluginDefinition<
  TApp = unknown,
  TCommand extends PluginGeneratedCommand = PluginGeneratedCommand,
  TSchema = unknown,
> = {
  metadata?: {
    displayName: string
    description: string
    version: string
    author?: string
    category?: string
    permissions?: string[]
  }
  hooks: Partial<Record<PluginHookName, PluginHook>>
  aiTools?: PluginAiTool<TCommand, TSchema>[]
  routes?: Record<string, PluginRouteFactory<TApp>>
  fields?: PluginFieldType<TSchema>[]
  adminMenu?: PluginAdminMenuItem[]
}
```

`TrustedPluginDefinition` is kept as a type alias for API catalog compatibility.

## Authoring Example

```ts
import type { PluginDefinition } from '@edgecms/plugin-sdk'

type Command =
  | {
      type: 'updateEntry'
      payload: Record<string, unknown>
    }

declare const schema: unknown

export const plugin = {
  metadata: {
    displayName: 'SEO Metadata',
    description: 'Adds SEO metadata fields and AI commands.',
    version: '1.0.0',
    category: 'content',
    permissions: ['entries:update'],
  },
  hooks: {
    beforeCommand: async (ctx) => {
      ctx.requestId
    },
  },
  aiTools: [
    {
      name: 'generateSeoMetadata',
      description: 'Generate SEO metadata for an entry.',
      parameters: schema,
      toCommands: (args) => [{ type: 'updateEntry', payload: args }],
    },
  ],
} satisfies PluginDefinition<unknown, Command, typeof schema>
```

## Route Safety

Plugin routes must stay under documented plugin route spaces. Route factories are probed during load, and unsafe route paths are blocked.

Allowed route namespaces:

- Admin: `/api/admin/plugins/:pluginName/*`

SDK route descriptors can document intended route shape before runtime factories are wired:

```ts
const routes = [
  {
    name: 'health',
    kind: 'admin',
    path: '/api/admin/plugins/audit-trace/health',
  },
] satisfies PluginRouteDescriptor<'audit-trace'>[]
```

Use plugin routes for small plugin-owned admin endpoints, such as health checks, status reads, or plugin settings. Do not use them to bypass tenant isolation, auth middleware, or public delivery contracts.

Public plugin routes are deferred. Do not register `/api/public/plugins/:pluginName/*` until tenant isolation, auth policy, cache behavior, and route-prefix tests exist.

Preview Revalidation proves outbound signing through an admin-only dry-run route. It reuses the existing webhook destination policy and HMAC signer, and never exposes a public plugin route.

Sample plugins currently prove admin-only extension shapes:

- `examples/plugins/audit-trace.plugin.ts`: lifecycle hook and health-route proof.
- `examples/plugins/seo-metadata.plugin.ts`: SEO metadata field/tool proof.
- `examples/plugins/preview-revalidation.plugin.ts`: admin-only revalidation dry-run proof.

These examples are trusted-plugin examples only. They do not prove public plugin routes, marketplace installs, or untrusted plugin sandboxing.

## AI Tools

AI tools convert plugin-specific input into command envelopes. Tool input is cloned and frozen before command generation.

Rules:

- Validate parameters with ArkType.
- Return only supported command types.
- Keep tool names unique.
- Do not mutate args.
- Prefer dry-run-compatible commands.

## Admin Menu

Admin menu entries expose plugin-owned admin surfaces:

```ts
type TrustedPluginAdminMenuItem = {
  label: string
  path: string
  group?: string
}
```

Menu paths should point to plugin settings or plugin status pages. Plugin labels and paths must be deterministic.

## Enable And Disable

Plugin enabled state is stored in KV as:

```text
plugin:<pluginName>:enabled
```

The admin plugin panel reads plugin status from `/api/admin/plugins` and patches enabled state through the admin plugin controller.

The SDK exports `LoadedPluginMetadata`, `PluginAdminListResponse`, and `PluginAdminToggleResponse` so admin clients and trusted plugin docs share the loader response shape. `routes` lists all loaded route names; `adminRoutes` and `publicRoutes` split those names by safe namespace.

## Authoring Checklist

- Add plugin to `apps/api/src/plugins/trusted-plugin-catalog.ts`.
- Define metadata with version, category, and permissions.
- Register only needed hooks.
- Keep plugin routes under `/api/admin/plugins/:pluginName/*`.
- Add tests for loaded, disabled, and blocked states.
- Add route namespace tests for every plugin route.
- Add admin panel coverage when exposing menu items.
- Add docs in `docs/public/sample-plugins.md`.
- Add or update example modules under `examples/plugins`.

## Future Package Boundary

`@edgecms/plugin-sdk` now exposes the public type names for plugin authors through a built package artifact. Keep runtime loading in `apps/api`; the package should expose types only until a runtime helper earns its place.

## Package Verification

Run focused SDK checks before considering the package publish-ready:

```sh
/Users/nanfengcheong/.bun/bin/bun run --filter @edgecms/plugin-sdk build
/Users/nanfengcheong/.bun/bin/bun -e "await import('./packages/plugin-sdk/dist/index.js')"
cd packages/plugin-sdk && npm pack --dry-run
```

The local release gate remains private until manual approval. Passing these commands proves local package shape only; it is not npm publish, marketplace availability, public plugin-route support, or untrusted sandboxing proof.
