# Public API Guide

EdgeCMS public delivery exposes published content by tenant and locale without requiring admin implementation knowledge.

## Contract Goals

- Tenant isolation is mandatory.
- Public reads return published content only. No anonymous preview/draft public route is shipped yet.
- Locale selection must be deterministic.
- Cache behavior must be visible to integrators.
- Error shapes should be stable enough for frontend apps.

## Request Shape

Current global public API routes:

```text
/api/public/:collectionSlug
/api/public/:collectionSlug/:entryIdOrSlug
/api/public/singleton/:collectionSlug
/api/public/assets/:assetId/:variant
/api/public/assets/:assetId/:variant/:format
```

Canonical tenant-scoped public API routes:

```text
/api/tenants/:tenantSlug/public/:collectionSlug
/api/tenants/:tenantSlug/public/:collectionSlug/:entryIdOrSlug
/api/tenants/:tenantSlug/public/singleton/:collectionSlug
/api/tenants/:tenantSlug/public/assets/:assetId/:variant
/api/tenants/:tenantSlug/public/assets/:assetId/:variant/:format
```

The Worker normalizes canonical tenant routes to the internal grouped route:

```text
/api/tenants/:tenantSlug/api/public/*
```

Use tenant-scoped routes for frontend adoption docs and smoke checks.

## API Docs Boundary

The API worker mounts the Elysia OpenAPI plugin at `/api/docs` and tracks that route as an admin-CORS special-class route in the local API route manifest. This is scoped route documentation proof only. It is not a claim that every public/admin response has a complete generated OpenAPI contract.

Before expanding the OpenAPI claim, add focused API or manifest tests for the specific generated paths and response shapes being claimed. Keep frontend integration docs on the tenant-scoped REST routes above until a generated client or GraphQL-equivalent contract is designed, tested, and documented.

## Query Parameters

Recommended public parameters:

- `locale`: requested locale.
- `page`: pagination page for collection lists.
- `perPage`: pagination size for collection lists.
- `sort`: sort expression for collection lists.
- `filter[status]`: optional status filter. Public routes only accept `published`; draft and other status values are rejected.
- `filter[data.fieldName]`: custom-field filter for collection lists.
- `populate`: relation population for entry reads.
- `depth`: relation population depth for entry reads.

Pagination parameters apply to collection list routes:

- `page`: 1-based page number.
- `perPage`: page size selected by the caller.

Keep frontend code tolerant of pagination metadata changes until a stable response envelope is introduced.

## Field Type Matrix

Current collection export and public API docs cover these field types:

| Field type | Current support boundary | Public API note |
| --- | --- | --- |
| `text` | Supported as scalar text | Filter with `filter[data.fieldName]` only when backend marks the field filterable. |
| `richtext` | Supported as stored rich text payload | Render only after frontend sanitization appropriate to your app. |
| `number` | Supported as scalar number | Avoid string comparisons in frontend filters. |
| `boolean` | Supported as scalar boolean | Treat missing values separately from `false`. |
| `date` | Supported as serialized date/string value | Keep timezone handling in frontend code explicit. |
| `media` | Supported as asset reference/metadata | Fetch public asset routes, not admin media routes. |
| `relation` | Supported as relation reference when populated | Use `populate`/`depth` only where tested for the collection. |
| `json` | Supported as arbitrary JSON | Frontend apps own runtime validation. |
| `array` | Supported for repeatable values/block-like structures | Keep item shape documented with the collection. |

Unsupported workflow fields, marketplace plugin fields, and untrusted runtime field types are not shipped. Do not claim Strapi-level field ecosystem parity from this matrix.

## Dynamic Field Options

Field `options` are field-type-specific metadata copied by Developer Export and interpreted by admin/API code. Current examples:

```json
{
  "name": "author",
  "type": "relation",
  "required": false,
  "localizable": false,
  "options": {
    "targetCollectionId": "authors",
    "relationType": "one-to-many"
  }
}
```

For repeatable/block-like arrays:

```json
{
  "name": "blocks",
  "type": "array",
  "required": false,
  "localizable": false,
  "options": {
    "itemFields": [
      { "name": "label", "type": "text", "required": true, "localizable": false }
    ],
    "minItems": 0,
    "maxItems": 12
  }
}
```

Options are not an extension sandbox. Validate option shape in code before relying on new field behavior.

## Response Shape

Public content routes return the public payload directly on success. Error responses currently use simple objects:

```json
{
  "error": "Entry not found"
}
```

Keep frontend code tolerant of direct payloads plus simple error objects until a stable public response envelope is introduced.

## Relations And Repeatable Blocks

Relation population is opt-in with `populate` and bounded by `depth`. Only request relation fields that exist in the collection schema, and keep frontend code tolerant of missing, unpublished, or cross-tenant related entries. Do not assume recursive Strapi-style population for every relation shape.

Repeatable block-like content uses `array` fields with documented `itemFields`, optional `minItems`, and optional `maxItems`. This is a structured field contract for public payloads, not full Strapi component or dynamic-zone parity.

Validation errors can include `details`:

```json
{
  "error": "Invalid filter parameters",
  "details": ["Field \"id\" is not filterable."]
}
```

## Error Catalog

Current public clients should handle these response categories:

| Category | HTTP shape | Cache behavior | Frontend handling |
| --- | --- | --- | --- |
| Not found | `{ "error": "Entry not found" }` | `no-store` | Render 404 or fallback content. |
| Invalid filters | `{ "error": "Invalid filter parameters", "details": [...] }` | `no-store` | Remove unsupported filters; do not retry blindly. |
| Draft/unsupported status | Validation error for non-`published` status filters | `no-store` | Use admin/preview flow, not public routes. |
| Tenant mismatch | Not found or authorization-shaped error depending on route | `no-store` | Check tenant slug and do not probe other tenants. |

Do not treat this catalog as a stable envelope guarantee. It documents current tested public behavior until a versioned response envelope ships.

## Cache And Revalidation

Public reads should declare cache behavior through headers or response metadata. Publish actions should invalidate or refresh public caches without blocking the authoring request path.

Successful public content reads set:

```text
Cache-Control: public, max-age=<browser ttl>, stale-while-revalidate=300, stale-if-error=86400
CDN-Cache-Control: public, max-age=<cdn ttl>, stale-while-revalidate=3600, stale-if-error=86400
Cache-Tag: collection:<slug>,locale:<locale>[,entry:<entry id or slug>]
Vary: Accept-Encoding
```

Public misses and validation failures set:

```text
Cache-Control: no-store
CDN-Cache-Control: no-store
```

Use signed webhooks or queue-backed revalidation for external frontend apps. Webhook deliveries include both `x-edgecms-signature` and `x-webhook-signature` using `sha256=<hex digest>` HMAC-SHA256 over the JSON request body. Delivery URLs must pass the destination policy: HTTPS, no embedded credentials, standard port 443, no local/private hosts, and optional `WEBHOOK_ALLOWED_HOSTS` allow-list matching.

Revalidation events should carry frontend-facing paths or cache tags in event metadata:

```json
{
  "event": "entry.published",
  "data": {
    "after": { "id": "entry-1", "slug": "hello-world" },
    "metadata": {
      "syncChannel": "global",
      "revalidate": {
        "paths": ["/blog/hello-world"],
        "tags": ["collection:posts", "entry:entry-1", "locale:en"]
      }
    }
  }
}
```

Dry-run webhook delivery validates tenant scope, destination policy, and HMAC signing, then records a delivery without outbound fetch.

Shared schema proof can build collection, locale, and entry cache tags for revalidation payloads. Locale-scoped public read cache keys must include tenant slug, collection slug, requested locale, published status, and a filter hash. This is local contract proof only; it does not prove deployed purge behavior.

## Preview

Preview must stay server-side. Use an authenticated admin/API flow or signed server-only token to resolve draft content. Do not expose preview secrets to browser bundles, and do not treat public routes as anonymous draft preview routes.

## Content API Token Boundary

EdgeCMS does not expose a browser-safe content API token model in this tranche. Current frontend integrations should use public routes for anonymous published reads and server-side admin/auth flows for protected reads.

Token boundary rules:

- `unsupported`: no public token contract exists.
- `server-only`: token metadata can be used by backend/admin flows, but secrets must not be bundled into browser code.
- Browser apps must not use admin cookies, preview secrets, or server-only tokens as public content API keys.

## Roles And Permissions Matrix

Current permission proof is helper/schema-level and does not claim a full Strapi-style generated RBAC admin. Use this matrix as the documented policy boundary for docs and regression tests.

| Role | Public content/assets | Admin collections | Admin entries | Admin assets | Trusted plugin panels | Manage settings |
| --- | --- | --- | --- | --- | --- | --- |
| `viewer` | read published public content | read | read | read | read installed state | no |
| `editor` | read published public content | read | mutate | mutate | read installed state | no |
| `admin` | read published public content | mutate | mutate | mutate | manage trusted plugin state | limited tenant admin |
| `owner` | read published public content | mutate | mutate | mutate | manage trusted plugin state | tenant owner |

Tenant context is required before admin mutations. Public content and public asset surfaces remain read-only even if a local helper is given a mutating role.
Local schema proof also blocks cross-tenant admin mutations by comparing the actor tenant and target tenant before allowing a mutable admin surface.

## Media Metadata And Policy

Media parity work is contract-first before migration/UI changes. Current schema proof covers:

- Alt text, optional caption, and optional credit metadata per tenant asset.
- Focal point metadata as normalized `x`/`y` values from `0` to `1`.
- Tenant upload policy with max bytes and allowed MIME types.
- Public asset cache proof requiring browser and CDN `max-age` headers plus immutable asset behavior.
- Signed private asset access policy shape with tenant, asset, expiry, and signing-secret reference. This is a boundary contract only; EdgeCMS does not claim a public private-asset route in this tranche.

The media metadata helper can combine alt text, caption, credit, and focal point into a tenant-scoped asset summary for admin review. The public asset cache helper can derive `Cache-Control` and `CDN-Cache-Control` headers from the local policy shape. Both helpers are contract proof only.

Image transform parity remains a decision boundary. EdgeCMS serves generated/public variants where available and documents Cloudflare Images-style transforms as future work until transform behavior, cost, cache keys, and tenant isolation are tested.

## Editorial Workflow Boundary

Current workflow proof is schema-level and route-policy proof, not a full migrated editorial workflow UI. The shared schema package defines tenant-scoped requests for:

- Duplicate entry requests.
- Autosave draft requests with optimistic version numbers.
- Server-only preview token metadata.
- Review assignment metadata.
- Scheduled publish/unpublish windows.
- Version restore requests.
- Version diff requests.

Public delivery remains stricter than editorial workflow state. Only `published` content is public-readable; `draft`, `review`, `scheduled`, and `archived` are not public-readable through anonymous public routes.

Schedule windows must not unpublish at or before publish time. Version restore and diff operations must stay tenant-scoped and version-explicit.

Release batch planning is documented as a scoped editorial boundary only. A release can be described as reviewed entries plus schedule windows and version-explicit restore/diff plans, but this tranche does not ship Strapi Releases parity, a release calendar, or bulk publish/unpublish orchestration.

Autosave conflict handling is contract-level proof in `@edgecms/schemas`: clients send optimistic version numbers, and server-side handlers should reject saves when the client base version is older than the server draft version. Review transitions are also explicit: publishing is valid from reviewed or scheduled states, while published content can only move to archived through this helper boundary.
The autosave decision helper records tenant slug, entry id, client draft version, server draft version, and `accepted` or `conflict` result. This keeps the conflict boundary testable without claiming a shipped timed autosave UI.

## Content Model Handoff

Admin Developer Export can produce deterministic TypeScript from a visual collection model. Use that output for code review, starter examples, plugin examples, or schema discussions. It is not an import API, migration runner, or deploy mechanism.

Safe handoff rules:

- Keep exported configs in source review before backend schema changes.
- Confirm field types, relation options, localization, and singleton settings against current API support.
- Add or update tests for the public response shape before frontend apps rely on new fields.
- Do not treat exported config as proof that production content has been migrated.
- Keep import preview non-destructive: preview can report additions, changes, and removals, but cannot apply migrations or delete content without a separate approved migration path.

## API Format Decision

EdgeCMS is REST-first for current public delivery. Strapi's REST/GraphQL ecosystem is a useful comparison point, but EdgeCMS does not ship GraphQL public delivery in this tranche.

Current decision:

- Keep public docs and examples on REST routes.
- Add GraphQL only after a separate schema, auth, cache, and tenant-isolation design exists.
- Do not claim Strapi-level API ecosystem parity without generated schema proof and client examples.

## OpenAPI Boundary

The current public API docs are a hand-maintained contract guide backed by focused tests. EdgeCMS does not claim complete generated OpenAPI in this tranche. Generated OpenAPI should wait for route schema coverage, tenant/auth review, error envelope decisions, and docs claim-scan coverage.

## Locale Fallback Boundary

Locale reads should be deterministic. If fallback behavior changes, update public route tests and this guide together. Until fallback is proven by tests, frontend examples should request a specific `locale` and handle missing localized content explicitly.

Current contract proof covers a policy shape with:

- `requestedLocale`: caller-selected locale.
- `fallbackLocale`: tenant fallback locale.
- `fallbackEnabled`: whether fallback is allowed.

Locale completeness can be represented as required fields plus missing fields per locale. Treat rows with any missing required field as incomplete. This is a contract/test boundary for future admin matrix UI; it is not yet a shipped locale completeness screen.

Local schema proof also resolves requested locale versus fallback locale, builds a locale completeness matrix from localized entry data, and defines cache-key parts for tenant, collection, requested locale, published status, and filter hash. This proves the required dimensions for future admin/public route tests; it is not deployed cache proof.

## Public Filter Allowlist

Public filters intentionally avoid unrestricted entry-field probing. Current top-level public filter fields are:

- `slug`
- `createdAt`
- `updatedAt`
- `status`

Custom content fields must use the `data.<field>` path shape. Public status filters only support `published`; draft/review/scheduled/archived reads stay out of anonymous public routes.

## Public Read Performance Fixtures

Local performance proof needs a known tenant, collection, and entry path. Use:

```bash
bun run perf:public-read:local -- --path /api/tenants/smoke/api/public/smoke-posts/<entry-slug>
```

The local threshold report records p50/p95 and pass/fail for local behavior only. Remote proof requires `EDGE_CMS_URL` and an operator-provided deployed Worker URL.

## Verification

Before treating a public route as stable:

- Create draft content through admin/API, publish it, then fetch it through the public API.
- Test tenant A cannot read tenant B content or tenant B cache snapshots.
- Test drafts are hidden from public reads.
- Test locale behavior and locale-scoped cache keys.
- Test `Cache-Control`, `CDN-Cache-Control`, and `Cache-Tag` headers.
- Test public error shape and `no-store` headers on public misses/validation failures.
