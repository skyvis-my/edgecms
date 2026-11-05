# Sample plugins

This guide describes the example plugins in `examples/plugins`: what each does, what it registers and what its tests cover. Read it alongside the [Plugin SDK](plugin-sdk.md) when you write your own plugin.

All samples are trusted-catalog plugins with admin-only routes.

## Audit Trace

Records command lifecycle activity for operators.

Module: `examples/plugins/audit-trace.plugin.ts`

Registers:

- `beforeCommand`, `afterCommand` and `beforeAiCommand` hooks.
- An admin health route.
- An Operations admin menu item.

Tests check that it:

- Loads when trusted and enabled.
- Does not run when disabled.
- Exposes its health route only under the admin plugin route space.
- Does not block the request when a hook times out.

## SEO Metadata

Adds an SEO field type and AI-assisted metadata generation for entries.

Module: `examples/plugins/seo-metadata.plugin.ts`

Registers:

- A custom `seo-preview` field type.
- An AI tool that generates `updateEntry` commands.
- A Content admin menu item.
- An admin health route.

Tests check that:

- The field type appears in the loaded plugin fields.
- The AI tool produces valid command envelopes.
- Duplicate AI tool names are ignored or rejected deterministically.
- Unsafe admin menu paths are blocked.

## Preview Revalidation

Helps frontends refresh their cache after a publish.

Module: `examples/plugins/preview-revalidation.plugin.ts`

Registers:

- An `afterCommand` hook for the publish lifecycle.
- An admin health route.
- An admin dry-run route: `/api/admin/plugins/preview-revalidation/dry-run`.

The dry run checks the destination against the webhook destination policy and signs the request with the existing webhook HMAC signer (`signPayload`). It never returns the signing secret. Retries and queue dispatch stay with the regular webhook delivery system. See [Webhooks](webhooks.md).

Tests check that it:

- Signs dry-run requests.
- Does not return the signing secret.
- Rejects untrusted destinations.
- Registers no public plugin route.

## Host Plan (admin contributions)

Shows how a host adds a plan and usage page, a dashboard panel and a banner to the admin (HS-10). It has no API catalog entry and changes no content.

Module: `examples/plugins/host-admin-contributions.plugin.ts`. A runnable React version lives in `apps/admin/src/features/plugins/admin-contributions/samples/host-plan-sample.tsx` and is off by default; start the admin with `VITE_EDGECMS_SAMPLE_HOST_PLUGIN=true` to see it. Its usage numbers are sample data.

Contributes:

- A `Plan & usage` page under the `Host` sidebar group, for tenant admins and owners.
- A `Plan usage` panel on the dashboard and in settings.
- A dismissible warning banner with a link to these docs.

Tests check that it:

- Passes catalog validation.
- Hides manage-level items from tenant members and superadmin-only items from everyone else.
- Hides contributions from a plugin the API reports as disabled.
- Renders banner text as plain text with a safe link, and remembers dismissal.

See [Admin contributions](plugin-sdk.md#admin-contributions-hs-10).

## Media Renditions (contract example)

Shows every EX-02 contract field: a supported EdgeCMS range, a dependency on `audit-trace` with a version range, and two required bindings (an R2 bucket and a secret). It is illustrative only: it has no catalog entry and does no media work.

Module: `examples/plugins/contract-dependencies.plugin.ts`.

The loader tests in `apps/api/src/tests/plugins/plugin-contract-composition.test.ts` check the same shapes: the plugin is blocked when the version, dependency or a binding is missing, and its dependency loads first when everything is present.

See [Extension contract](plugin-sdk.md#extension-contract-ex-02).

## Form Capture (not built)

A form submission plugin is planned but not built, because it needs a public route and EdgeCMS does not load public plugin routes. It waits for a reviewed public plugin namespace with tenant isolation, auth policy, cache behavior and route-prefix tests.

Planned scope:

- A public, validation-only submission route, mounted under the tenant route group `/api/tenants/:tenantSlug`.
- Payload validation for `formId`, `email` and `fields`.
- Optional Turnstile validation.
- Submissions stored as entries or in a plugin-owned table.
- A webhook on each submission.
- An admin settings and status page.

Its tests will need to check that it rejects invalid payloads, stays blocked until the public namespace is approved, keeps the tenant route-group context, and cannot reach the admin namespace from the public route.

## What every sample needs

- A trusted catalog entry.
- Focused tests.
- An admin panel status: loaded, disabled or blocked.
- Docs covering setup, behavior and how to verify it.
- An example module or spec under `examples/plugins`.
- Routes described with `PluginRouteDescriptor` when they are documented.
- No shared abstraction across plugins unless two plugins already use it.
