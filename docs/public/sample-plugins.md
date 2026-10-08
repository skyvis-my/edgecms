# EdgeCMS Sample Plugins

Sample plugins should prove the extension contract with small, useful behavior. They should stay trusted-catalog based until the plugin SDK boundary is stable.

## Audit Trace

Purpose: record command lifecycle activity for operators.

Example module: `examples/plugins/audit-trace.plugin.ts`

Capabilities:

- `beforeCommand`
- `afterCommand`
- `beforeAiCommand`
- Admin health route
- Operations admin menu item

Tests:

- Loads when trusted and enabled.
- Does not run when disabled.
- Exposes health route only under admin plugin route space.
- Hook timeout does not block the request path.

## SEO Metadata

Purpose: add SEO field support and AI-assisted metadata generation for entries.

Example module: `examples/plugins/seo-metadata.plugin.ts`

Capabilities:

- Custom `seo-preview` field type
- AI tool that generates update-entry commands
- Content admin menu item
- Admin health route

Tests:

- Field type appears in loaded plugin fields.
- AI tool produces valid command envelopes.
- Duplicate AI tool names are ignored or rejected deterministically.
- Unsafe admin menu paths are blocked.

## Form Capture

Purpose: provide a practical extension without turning forms into core CMS scope.

Status: deferred. EdgeCMS does not load public plugin routes in this tranche. Form Capture must wait for a reviewed public plugin namespace with tenant isolation, auth policy, cache behavior, and route-prefix tests.

Capabilities:

- Public validation-only submission route, deferred
- Tenant-scoped public route mount through existing tenant route group, deferred
- Payload validation for `formId`, `email`, and `fields`
- Optional Turnstile validation, deferred
- Stored submission entry or plugin-owned table, deferred
- Webhook dispatch on submission, deferred
- Admin settings/status page, deferred

Tests:

- Rejects invalid payloads.
- Blocks public plugin routes until the namespace is approved.
- Preserves tenant route-group context when mounted under `/api/tenants/:tenantSlug`.
- Blocks admin namespace access for the public submission route.

## Preview Revalidation

Purpose: help frontend integrators refresh cache after publish.

Example module: `examples/plugins/preview-revalidation.plugin.ts`

Capabilities:

- `afterCommand` hook for publish-lifecycle integration
- Admin health route
- Admin dry-run route: `/api/admin/plugins/preview-revalidation/dry-run`
- Webhook destination policy validation
- Existing webhook HMAC signing via `signPayload`

Tests:

- Signs dry-run requests.
- Does not return the signing secret.
- Rejects untrusted destinations.
- Keeps public plugin routes deferred.
- Leaves runtime retry and queue dispatch with the existing webhook delivery system.

## Acceptance Bar

Each sample plugin needs:

- Trusted catalog entry.
- Focused tests.
- Admin panel status such as loaded, disabled, or blocked.
- Docs for setup, behavior, and verification.
- Example module or spec under `examples/plugins`.
- Route descriptors typed with `PluginRouteDescriptor` when routes are documented.
- No cross-plugin shared abstraction unless two plugins already use it.
