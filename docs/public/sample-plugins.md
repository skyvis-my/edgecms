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
