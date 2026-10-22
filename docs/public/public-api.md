# Public API

This guide describes the routes that serve published content and public assets: URLs, query parameters, response and error shapes, and cache headers. It is for frontend developers reading EdgeCMS content without admin credentials.

Public routes return published content only, scoped to one tenant. They are read-only and need no authentication.

## Routes

Use the tenant-scoped routes:

```text
GET /api/tenants/:tenantSlug/public/:collectionSlug
GET /api/tenants/:tenantSlug/public/:collectionSlug/:entryIdOrSlug
GET /api/tenants/:tenantSlug/public/singleton/:collectionSlug
GET /api/tenants/:tenantSlug/public/assets/:assetId
GET /api/tenants/:tenantSlug/public/assets/:assetId/:variant
GET /api/tenants/:tenantSlug/public/assets/:assetId/:variant/:format
```

The Worker rewrites `/api/tenants/:tenantSlug/public/*` to `/api/tenants/:tenantSlug/api/public/*` before routing, so both forms work. The examples and smoke tests use the `/api/public` form.

Global routes without a tenant also exist for single-tenant deployments:

```text
GET /api/public/:collectionSlug
GET /api/public/:collectionSlug/:entryIdOrSlug
GET /api/public/singleton/:collectionSlug
GET /api/public/assets/:assetId
GET /api/public/assets/:assetId/:variant
GET /api/public/assets/:assetId/:variant/:format
```

If a list route finds no collection with that slug, it tries a singleton with the same slug before returning `404`.

## Query parameters

| Parameter | Routes | Behavior |
| --- | --- | --- |
| `locale` | All content routes | Locale to read. Defaults to `en`. |
| `page` | List | 1-based page number. Defaults to `1`. |
| `perPage` | List | Page size. Defaults to `20`, maximum `100`. |
| `sort` | List | Comma-separated fields; prefix with `-` for descending, for example `sort=-createdAt,slug`. |
| `filter[field]` or `filter[field][operator]` | List | Filters. See [Filters](#filters). |
| `populate` | Entry | Relation fields to populate. |
| `depth` | Entry | Relation population depth, `1` to `3`. Defaults to `1`. |

## Filters

Top-level fields you can filter on: `slug`, `createdAt`, `updatedAt`, `status`. Custom fields use the path `data.<field>`, for example `filter[data.category]=news`. Any other field returns a validation error, so you cannot probe arbitrary columns.

Operators: `eq` (default), `neq`, `gt`, `gte`, `lt`, `lte`, `contains`, `in`, `not_in`, `exists`.

```text
/api/tenants/smoke/api/public/posts?filter[data.category]=news&filter[createdAt][gte]=2026-01-01&sort=-createdAt
```

Limits:

- At most 10 filter conditions per request.
- `in` and `not_in` take a comma-separated list of at most 50 values.
- `contains` values are at most 100 characters. A collection can restrict which `data.*` fields accept `contains`.
- `status` only accepts `published`. `filter[status]=draft` (or `review`, `scheduled`, `archived`) returns `Public status filters only support published content.`

Sortable fields: `createdAt`, `updatedAt`, `slug`, and `data.<field>`. Prefer the top-level fields; sorting on `data.*` cannot use an index.

## Responses

A successful content read returns the payload directly, with no envelope. Errors are simple objects:

```json
{ "error": "Entry not found" }
```

Validation errors add `details`:

```json
{
  "error": "Invalid filter parameters",
  "details": ["Field \"id\" is not filterable."]
}
```

The response shape is not versioned yet. Parse pagination metadata defensively and treat the smoke response for your collection as the reference for the current list shape.

## Errors

| Case | Response | Cache | What to do |
| --- | --- | --- | --- |
| Not found | `{ "error": "Entry not found" }` | `no-store` | Render a 404 or fallback content. |
| Invalid filters | `400`, `{ "error": "Invalid filter parameters", "details": [...] }` | `no-store` | Remove the unsupported filter. Do not retry unchanged. |
| Non-`published` status filter | Validation error | `no-store` | Use a server-side preview flow instead. |
| Wrong tenant | Not found or an authorization error, depending on the route | `no-store` | Check the tenant slug. |
| Tenant `pending` or `disabled` | `403 TENANT_UNAVAILABLE` | | See [Hosting seams](hosting-seams.md#tenant-states). |

## Cache headers

Successful reads set:

```text
Cache-Control: public, max-age=<browser ttl>, stale-while-revalidate=300, stale-if-error=86400
CDN-Cache-Control: public, max-age=<cdn ttl>, stale-while-revalidate=3600, stale-if-error=86400
Cache-Tag: collection:<slug>,locale:<locale>[,entry:<entry id or slug>]
Vary: Accept-Encoding
```

Misses and validation failures set:

```text
Cache-Control: no-store
CDN-Cache-Control: no-store
```

Public read cache entries are kept per tenant, collection, requested locale and filter hash, and hold published content only.

## Revalidating your frontend

Use signed webhooks to refresh frontend caches after a publish. Each delivery carries `x-edgecms-signature` and `x-webhook-signature`, both `sha256=<hex digest>`: an HMAC-SHA256 of the raw JSON body.

Destinations must use HTTPS on port 443, contain no credentials, and not point at a local or private host. If `WEBHOOK_ALLOWED_HOSTS` is set, the host must match it.

Publish events carry frontend paths and cache tags in their metadata:

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

A webhook dry run checks tenant scope, the destination policy and signing, then records a delivery without sending it. See [Webhooks](webhooks.md) and [Frontend integration](frontend-integration.md).

## Locales

Request a specific `locale` and handle missing localized content yourself. The public API does not fall back to another locale.

The shared schema package defines a fallback policy shape (`requestedLocale`, `fallbackLocale`, `fallbackEnabled`), a resolver for it, and a locale completeness matrix: required fields plus missing fields per locale, where any missing required field marks the locale incomplete. No public route or admin screen uses these yet. If fallback behavior is added, the public route tests and this guide change together.

## Relations and repeatable blocks

Relation population is opt-in: pass `populate` with relation field names and keep `depth` low. Related entries can be missing because they are unpublished, belong to another tenant, or were left out by the public route. Treat a missing relation as absent content, not as a reason to retry. Population is not recursive for every relation shape.

Repeatable, block-like content uses `array` fields with `itemFields`, optional `minItems` and optional `maxItems`. This is a structured field, not a full component or dynamic-zone system.

## Field types

| Field type | Stored as | Notes for frontends |
| --- | --- | --- |
| `text` | Text | Filter with `filter[data.fieldName]`. |
| `richtext` | Rich text payload | Sanitize before rendering. |
| `number` | Number | Avoid string comparisons in filters. |
| `boolean` | Boolean | Treat a missing value differently from `false`. |
| `date` | Serialized date string | Handle time zones explicitly. |
| `media` | Asset reference and metadata | Load files from public asset routes, not admin media routes. |
| `relation` | Relation reference, populated on request | Use `populate` and `depth`. |
| `json` | Arbitrary JSON | Validate it at runtime in your app. |
| `array` | Repeatable values or blocks | Item shape comes from `itemFields`. |

There are no workflow fields and no field types loaded from untrusted code. Plugins can add field types only through the trusted [Plugin SDK](plugin-sdk.md). See [Content model](content-model.md) for how fields are defined.

### Field options

Each field has type-specific `options`. Developer Export copies them, and the admin and API interpret them. Relation field:

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

Repeatable array field:

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

`options` is metadata, not an extension mechanism. Validate new option shapes in code before relying on them.

## Public assets

Asset routes serve files from R2 for published assets. They accept optional image transform parameters:

| Parameter | Values |
| --- | --- |
| `w` or `width` | 1 to 4096 |
| `h` or `height` | 1 to 4096 |
| `fit` | `scale-down`, `contain`, `cover`, `crop`, `pad` |
| `format` or `f` | `auto`, `webp`, `avif`, `jpeg`, `png`, `json` |

With transform parameters, the Worker asks Cloudflare image resizing for the result. If that is unavailable (for example in local development), it serves the stored file instead. The `x-image-transform` response header is `cf-edge`, `fallback` or `none`. Transform cost, cache keys and tenant isolation for resized images have no dedicated tests yet. See [Media](media.md).

The shared schema package also defines media contracts that no public route uses yet:

- Alt text, optional caption and optional credit per tenant asset.
- Focal point as normalized `x` and `y` values from `0` to `1`.
- Tenant upload policy with maximum bytes and allowed MIME types.
- Public asset cache headers with browser and CDN `max-age` and immutable caching.
- A signed private asset access policy with tenant, asset, expiry and a signing secret reference. There is no public route for private assets.

## Preview and drafts

Draft preview routes are not public. Resolve drafts in server code through an authenticated admin or API flow, and never put preview secrets in a browser bundle.

`POST .../public/preview-token` signs short-lived preview token metadata (tenant, entry, collection, preview URL; TTL 60 seconds to 7 days, default 1 hour) with `PREVIEW_SECRET`, and `POST .../public/preview-token/verify` checks one. No route returns draft content for these tokens yet. A suspended tenant cannot issue them.

## API tokens for browsers

There is no browser-safe content API token. Use public routes for anonymous published reads and server-side admin or auth flows for anything protected.

- Token metadata can be used by backend and admin flows, but its secrets must stay out of browser code.
- Never use admin cookies, preview secrets or server-only tokens as public content keys in browser apps.

See [Auth and access](auth-and-access.md).

## Roles

Admin access is role-based. Tenant context is required for admin mutations, and a role on one tenant cannot change another tenant. Public content and asset routes stay read-only for every role.

| Role | Public content and assets | Collections | Entries | Assets | Trusted plugin panels | Settings |
| --- | --- | --- | --- | --- | --- | --- |
| `viewer` | Read published | Read | Read | Read | Read installed state | No |
| `editor` | Read published | Read | Change | Change | Read installed state | No |
| `admin` | Read published | Change | Change | Change | Manage trusted plugin state | Limited tenant admin |
| `owner` | Read published | Change | Change | Change | Manage trusted plugin state | Tenant owner |

This matrix is enforced by shared helpers and tests. There is no generated role editor in the admin.

## Editorial workflow

Only `published` entries are publicly readable. `draft`, `review`, `scheduled` and `archived` entries are not.

The shared schema package defines tenant-scoped request shapes for:

- Duplicating an entry.
- Saving a draft with an optimistic version number.
- Server-only preview token metadata.
- Review assignments.
- Scheduled publish and unpublish windows. An unpublish time must be after the publish time.
- Restoring a version, and diffing two versions. Both name explicit versions.

Workflow rules in the helpers: publishing is valid from `review` or `scheduled`, and a published entry can only move to `archived`.

Draft saves use optimistic versioning: the client sends its base version, and the server rejects the save when the server draft is newer. The autosave helper records tenant slug, entry id, client version, server version and an `accepted` or `conflict` result. The admin entry form saves dirty drafts in the background every 30 seconds and warns when the server draft is newer.

There is no release calendar and no bulk publish or unpublish of a release. A release can be planned as a set of reviewed entries with schedule windows and explicit restore or diff steps.

## Content model handoff

Developer Export in the admin produces deterministic TypeScript from a collection. Use it for code review, starter or plugin examples, and schema discussions. It is not an import API, a migration runner or a deploy step.

- Review exported configs before changing the backend schema.
- Check field types, relation options, localization and singleton settings against what the API supports.
- Add tests for the public response shape before your frontend depends on new fields.
- An export does not mean production content was migrated.
- Import preview is read-only. It reports additions, changes and removals but never applies migrations or deletes content.

## REST, GraphQL and OpenAPI

REST is the primary public interface, and these docs and examples use it.

A read-only GraphQL endpoint is also available:

```text
GET  /api/graphql
POST /api/graphql
GET  /api/tenants/:tenantSlug/graphql
POST /api/tenants/:tenantSlug/graphql
```

The schema is generated per tenant from its collections: each collection gets a list field (`locale`, `page`, `perPage` up to 100, `sort`) and a single-entry field (`id` or `slug`, `locale`). Resolvers return published entries only. Queries are limited to depth 3 and complexity 50. A `GET` with no `query` (or with `Accept: text/html`) returns the GraphiQL playground; open it to see the exact field names. Its feature set does not match other CMS GraphQL APIs.

The Worker serves Elysia's OpenAPI document at `/api/docs`. It covers the routes that declare schemas, not every public and admin response. A generated client for all routes needs route schema coverage, a tenant and auth review, and a decision on error envelopes first.

## Testing your integration

Before you rely on a public route in production:

1. Create a draft through the admin or API, publish it, then fetch it through the public API.
2. Check that tenant A cannot read tenant B content or tenant B cache snapshots.
3. Check that drafts are hidden from public reads.
4. Check locale behavior and that cache keys differ per locale.
5. Check the `Cache-Control`, `CDN-Cache-Control` and `Cache-Tag` headers.
6. Check the error shape and the `no-store` headers on misses and validation failures.

To time public reads locally:

```bash
bun run perf:public-read:local -- --path /api/tenants/smoke/api/public/smoke-posts/<entry-slug> --expected-kind detail
```

This reports p50, p95 and pass or fail for your local machine only. To measure a deployed Worker, run `perf:public-read:remote` with `EDGE_CMS_URL` set to its URL.
