# Plugin SDK

This guide explains how to write a trusted EdgeCMS plugin: hooks, AI tools, field types, admin routes and admin menu items. It is for developers extending EdgeCMS in their own fork or deployment.

EdgeCMS runs trusted plugins only. A plugin loads when it is listed in the trusted catalog in the API source and is enabled by runtime configuration and KV state. Uploading arbitrary plugin code is not supported, and there is no plugin marketplace.

## Where the code lives

| Path | Purpose |
| --- | --- |
| `packages/plugin-sdk/src/index.ts` | Authoring types (`@edgecms/plugin-sdk`) |
| `apps/api/src/plugins/trusted-plugin-catalog.ts` | The trusted catalog |
| `apps/api/src/plugins/plugin-loader.ts` | Resolves manifests against the catalog |
| `apps/api/src/plugins/plugin-registry.ts` | Runs hooks with a timeout; stores enabled state |
| `apps/api/src/plugins/plugin-hooks.ts` | Hook wiring |
| `apps/api/src/plugins/plugins.controller.ts` | Admin plugin API |
| `apps/admin/src/features/plugins` | Admin plugin panel |
| `examples/plugins/` | Example plugins; see [Sample plugins](sample-plugins.md) |

## The SDK package

`@edgecms/plugin-sdk` is a types-only package:

```ts
import type {
  LoadedPluginMetadata,
  PluginDefinition,
  PluginGeneratedCommand,
  PluginHookContext,
  PluginRouteDescriptor,
} from '@edgecms/plugin-sdk'
```

It builds ESM JavaScript and TypeScript declarations to `packages/plugin-sdk/dist`; `types`, `exports` and the packed files all point there. It has no dependencies and imports nothing from `apps/api` or Worker runtime modules. Loading, validation, sandboxing and route safety stay in `apps/api/src/plugins`.

The package is marked `private: true` and is not published to npm yet. Use it as a workspace dependency.

## How plugins load

1. You list plugins by name in the `EDGE_PLUGINS_JSON` Worker variable.
2. The loader looks up each name in the trusted catalog. Unknown names are marked `blocked`.
3. Disabled plugins stay visible in the admin but register nothing.
4. For an enabled, trusted plugin, the loader registers only these capabilities: hooks, AI tools, field types, admin routes and admin menu items.

`EDGE_PLUGINS_JSON` is a JSON array of manifests:

```json
[
  { "name": "audit-trace" },
  { "name": "seo-metadata", "enabled": true },
  { "name": "preview-revalidation", "enabled": false }
]
```

`enabled` defaults to `true`. Manifests can also carry `version`, `dependencies`, `requiredBindings`, `capabilities`, `coreVersionRange` and `sdkVersionRange`.

Loading fails closed: a manifest alone cannot grant routes, hooks, fields, AI tools, menu items or public access. Only the catalog entry can. The shared release schema treats a manifest as safe only when it is enabled, comes from the trusted catalog, lists explicit permissions, and keeps the hook timeout within the budget below.

## Hooks

| Hook | Runs |
| --- | --- |
| `beforeCommand` | Before a command executes |
| `afterCommand` | After a command executes |
| `beforeAiCommand` | Before an AI command request |

Hooks receive a frozen context:

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

Hooks run inside the request, under a timeout of 250 ms by default (`EDGE_PLUGIN_HOOK_TIMEOUT_MS` changes it). Keep them fast and aware of side effects. Move slow network or storage work to a queue instead of raising the timeout. If you do raise it, add a registry test and explain the latency cost.

## Plugin definition

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

`TrustedPluginDefinition` is an alias kept for the API catalog.

## Example

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

## Routes

Plugin routes must live under:

```text
/api/admin/plugins/:pluginName/*
```

The loader probes each route factory at load time and blocks unsafe paths. Use plugin routes for small admin endpoints such as health checks, status reads or plugin settings. They must not bypass tenant isolation, auth middleware or the public delivery rules.

Public plugin routes are not supported. Do not register `/api/public/plugins/:pluginName/*`; that needs tenant isolation, auth policy, cache behavior and route-prefix tests first.

Describe routes with `PluginRouteDescriptor` before wiring their factories:

```ts
const routes = [
  {
    name: 'health',
    kind: 'admin',
    path: '/api/admin/plugins/audit-trace/health',
  },
] satisfies PluginRouteDescriptor<'audit-trace'>[]
```

## AI tools

An AI tool turns plugin-specific input into command envelopes. Its input is cloned and frozen before `toCommands` runs.

- Validate parameters with ArkType.
- Return only supported command types. See [Commands](commands.md).
- Use unique tool names.
- Do not mutate `args`.
- Prefer commands that work as dry runs. See [AI command safety](ai-command-safety.md).

## Admin menu

```ts
type TrustedPluginAdminMenuItem = {
  label: string
  path: string
  group?: string
}
```

Point menu paths at plugin settings or status pages. Labels and paths must be deterministic.

## Enable and disable

Enabled state is stored in KV under:

```text
plugin:<pluginName>:enabled
```

The admin plugin panel lists plugins with `GET /api/admin/plugins` and toggles them with `PATCH /api/admin/plugins/:pluginName`.

The SDK exports `LoadedPluginMetadata`, `PluginAdminListResponse` and `PluginAdminToggleResponse` so admin clients share the loader's response shape. In that response, `routes` lists all loaded route names; `adminRoutes` and `publicRoutes` split them by namespace.

## Add a plugin

1. Add the plugin to `apps/api/src/plugins/trusted-plugin-catalog.ts`.
2. Give it metadata with version, category and permissions.
3. Register only the hooks it needs.
4. Keep its routes under `/api/admin/plugins/:pluginName/*`.
5. Add tests for the loaded, disabled and blocked states.
6. Add a namespace test for every route.
7. Add admin panel coverage if it adds menu items.
8. Document it in [Sample plugins](sample-plugins.md).
9. Add or update its example module in `examples/plugins`.
10. Add its name to `EDGE_PLUGINS_JSON`.

## Check the package

```bash
bun run --filter @edgecms/plugin-sdk build
bun -e "await import('./packages/plugin-sdk/dist/index.js')"
cd packages/plugin-sdk && npm pack --dry-run
```

These check the local package shape only. `bun run check:package` runs the same checks for all workspace packages.
