# Plugin SDK

This guide explains how to write a trusted EdgeCMS plugin: hooks, AI tools, field types, admin routes, admin menu items and admin contributions (sidebar pages, panels and banners). It is for developers extending EdgeCMS in their own fork or deployment.

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
| `apps/admin/src/features/plugins/admin-contributions/catalog.ts` | Admin contribution catalog (HS-10) |
| `examples/plugins/` | Example plugins; see [Sample plugins](sample-plugins.md) |

## The SDK package

`@edgecms/plugin-sdk` is mostly types, plus the dependency-free admin contribution validators described in [Admin contributions](#admin-contributions-hs-10):

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

## Admin contributions (HS-10)

A trusted plugin can add to the admin without editing core admin code:

- **Navigation pages**: a sidebar link inside a tenant workspace and a page that renders the plugin's component.
- **Panels**: a card in a fixed slot, `dashboard` (the global dashboard) or `settings` (the settings layout).
- **Banners**: an `info` or `warning` message at the top of the admin, with an optional link, dismissible by default.

Contributions come from a build-time catalog in the admin source, `apps/admin/src/features/plugins/admin-contributions/catalog.ts`. The components are compiled into the admin bundle. There is no field for a remote script, an iframe URL or HTML, and banner text renders as plain text (P8).

```ts
import type { TrustedAdminContributionEntry } from '@edgecms/plugin-sdk'

export const hostPlan = {
  pluginName: 'acme-host-plan',
  requiresLoadedApiPlugin: true,
  contributions: {
    navItems: [
      { id: 'plan', label: 'Plan & usage', group: 'Host', access: 'tenant:manage', component: PlanPage },
    ],
    panels: [
      { id: 'usage', slot: 'dashboard', title: 'Plan usage', access: 'tenant:read', component: UsagePanel },
    ],
    banners: [
      {
        id: 'trial-ending',
        tone: 'warning',
        message: 'Your trial ends in 3 days.',
        access: 'tenant:manage',
        link: { label: 'Choose a plan', href: 'https://billing.example.com/plans' },
      },
    ],
  },
} satisfies TrustedAdminContributionEntry<AdminComponent>
```

The full example is `examples/plugins/host-admin-contributions.plugin.ts`. A runnable React sample ships in the admin and is off by default; start the admin with `VITE_EDGECMS_SAMPLE_HOST_PLUGIN=true` to see it. Its numbers are sample data.

### Routes

The admin derives each page's route from the plugin name and item id:

```text
/tenants/:tenantSlug/plugins/:pluginName/:id
```

A plugin cannot choose a path, so it cannot replace a core page. Navigation pages exist only inside a tenant workspace. Components receive `{ pluginName, tenantSlug }`.

### Access

Every contribution declares `access`. The admin hides a contribution unless the signed-in user holds that level:

| `access` | Inside a tenant | On global pages |
| --- | --- | --- |
| `tenant:read` | Any tenant member | Any signed-in user |
| `tenant:write` | Editors, admins, owners | Global admins |
| `tenant:manage` | Admins, owners | Global admins |
| `superadmin` | Super-admins | Super-admins |

Super-admins see everything. A custom tenant role gets `tenant:read`. The admin reads the tenant role from the RBAC access token. Contributions stay hidden until the role is known.

This is a display gate only. Any API route a contributed component calls must check permissions itself, as every admin route already does.

### Enabled state

If `GET /api/admin/plugins` reports the plugin as `disabled` or `blocked`, it contributes nothing. With `requiresLoadedApiPlugin: true`, contributions also stay hidden until the API reports the plugin as `loaded`. Without it, a plugin that exists only in the admin catalog still renders.

### Validation

The admin validates the catalog with `composeAdminContributions` when the module loads. Validation is all-or-nothing per plugin: a plugin with any issue contributes nothing and is logged as rejected. A test in the admin fails the build if the shipped catalog has a rejected plugin. Rules:

- `pluginName` and every `id` are lowercase slugs; ids are unique per kind within a plugin, and a plugin name may appear once.
- `access`, `slot` and `tone` must be one of the listed values.
- Labels and group names are 1 to 48 characters, panel titles up to 64, descriptions up to 160 and banner messages up to 280, with no control characters.
- Banner links are an admin path starting with `/` (not `//`) or an `https://` URL.
- Pages and panels need a bundled component.
- Unknown fields are rejected.
- Each plugin may add at most 8 navigation items, 4 panels and 3 banners.

`validateAdminContributionEntry` returns the same issues for one entry, each with a `path` and a `code`.

A contributed component that throws is contained: the admin shows a short notice in its place and keeps working.

Banner dismissal is stored in the browser's local storage, so it applies per browser, not per user.

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
7. Add admin panel coverage if it adds menu items or admin contributions.
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
