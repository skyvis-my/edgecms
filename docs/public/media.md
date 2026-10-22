# Media

How EdgeCMS stores uploaded files in R2, keeps their metadata in D1, and serves them on public routes.

Code: `apps/api/src/assets/`, `apps/api/src/public/public.controller.ts`, `apps/admin/src/features/assets/`. PRD items: `MD-01` to `MD-05`, `HS-05` (usage), `HS-06` (limits), `HS-14` (AI switch).

## Routes

Admin routes are tenant-scoped. Both path forms work; the short one is rewritten to the long one:

```text
/api/tenants/:tenantSlug/api/admin/assets/...
/api/tenants/:tenantSlug/admin/assets/...
```

```text
POST   .../admin/assets/upload              upload one file (JSON or multipart)
GET    .../admin/assets                     list live assets with variants
GET    .../admin/assets/config              this tenant's upload limits
GET    .../admin/assets/usage               stored bytes summary
GET    .../admin/assets/:assetId            one asset
PUT    .../admin/assets/:assetId            rename { filename }
DELETE .../admin/assets/:assetId            soft delete
POST   .../admin/assets/delete              soft delete many { ids: [] }
POST   .../admin/assets/search              search { query, limit?, folder?, mimeTypePrefix? }
POST   .../admin/assets/gc                  purge old soft-deleted assets { olderThanDays?, limit? }
DELETE .../admin/assets/:assetId/permanent  hard delete now
```

Reads need a tenant role that can read admin routes (`owner`, `admin`, `editor`, `member`); writes need `owner`, `admin` or `editor`, plus a CSRF token. See [Authentication And Access](auth-and-access.md). Writes count against the `admin_mutation` rate limit (60 per minute by default).

The same controller is also mounted without a tenant at `/api/admin/assets`. There, list, get, usage, search and gc return `400 TENANT_REQUIRED`, while upload and delete use a shared `global` scope. Use the tenant-scoped paths.

## Upload flow

### From the admin

The media manager prepares images in the browser before upload (`media-optimizer.ts`):

1. Reads the tenant limits from `GET .../admin/assets/config`.
2. If the image's longest edge is over the tenant's max dimension, or the file is over the byte limit, it resizes the original to the max dimension and re-encodes it as WebP. Quality starts at the slider value (default 80) and drops in 0.1 steps to 0.35 until it fits; if it still does not fit, the upload stops with an error.
3. Builds four variants, each scaled so its longest edge is at most:

   | Variant | Longest edge |
   | --- | --- |
   | `thumbnail` | 150 px |
   | `small` | 480 px |
   | `medium` | 1024 px |
   | `large` | 2048 px |

   Each variant is never larger than the tenant's max dimension or the source image.
4. Encodes every variant as WebP, and also as AVIF when the browser's canvas can encode AVIF. If the browser cannot encode WebP, the upload fails.
5. Sends the original and the variants in one JSON request.

Non-image files are uploaded as-is with no variants.

Current gaps against `MD-01`:

- Encoding uses the browser's Canvas API (`canvas.toDataURL`). The `@jsquash/avif`, `@jsquash/webp` and `@jsquash/resize` packages are listed in `apps/admin/package.json` but are not imported anywhere, so no jSquash WASM runs today.
- AVIF output depends on the browser. Where canvas cannot encode AVIF, only WebP variants are stored.

### From the API (no browser)

```bash
curl -X POST "$EDGE_CMS_URL/api/tenants/acme/api/admin/assets/upload" \
  -H "Cookie: $SESSION_COOKIES" \
  -H "x-csrf-token: $CSRF" \
  -F "file=@hero.jpg" \
  -F "filename=blog/hero.jpg" \
  -F "width=3000" -F "height=2000"
```

Multipart fields: `file` (required), `filename`, `mimeType`, `width`, `height`, `blurhash`, and `variants` (a JSON string). The JSON form takes the same fields with the file as `contentBase64`:

```json
{
  "filename": "blog/hero.webp",
  "mimeType": "image/webp",
  "contentBase64": "<base64>",
  "width": 2048,
  "height": 1365,
  "blurhash": "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
  "variants": [
    { "variant": "medium", "format": "webp", "width": 1024, "height": 683, "contentBase64": "<base64>" }
  ]
}
```

The Worker does not resize, re-encode or decode images. It stores the original and whatever variants the caller sends. An API upload without `variants` stores only the original, and the public variant routes then serve the original (see [Public asset routes](#public-asset-routes)). `image-pipeline.ts` defines a variant plan but nothing calls it.

Responses:

| Status | Code | When |
| --- | --- | --- |
| `201` | | Stored. Body is `{ "success": true, "data": <asset with variants> }`. |
| `400` | `BAD_REQUEST` | Missing `filename`, `mimeType` or `contentBase64`, or no multipart `file`. |
| `402` / `429` | host limit code | The host's limit policy refused the `media_bytes` increase (`HS-06`). |
| `413` | `PAYLOAD_TOO_LARGE` | Original is over the tenant byte limit. |
| `415` | `UNSUPPORTED_MEDIA_TYPE` | Type not allowed, or a blocked type or extension. Also returned for a request body that is neither JSON nor multipart. |
| `503` | `ASSET_STORAGE_FAILED` | R2 write failed. |
| `500` | `ASSET_UPLOAD_FAILED` | Anything else. |

If the D1 write fails after the R2 write, the uploaded objects are deleted again so storage does not leak.

## Per-tenant limits (MD-05)

Stored on the tenant row. A super-admin sets them with `POST /api/admin/tenants` or `PUT /api/admin/tenants/:tenantSlug`:

```json
{
  "mediaUploadMaxBytes": 10485760,
  "mediaUploadMaxDimension": 4096,
  "mediaAllowedMimeTypes": ["image/*", "application/pdf"]
}
```

| Limit | Default | Enforced by |
| --- | --- | --- |
| `mediaUploadMaxBytes` | 5 MB (5,242,880 bytes) | API: `413` on the original file. Variant bytes are not counted against it. |
| `mediaUploadMaxDimension` | 2048 px | Admin only: the browser resizes to it. The API stores but does not check `width`/`height`. |
| `mediaAllowedMimeTypes` | see below | API: `415`. |

Default allowed types: `image/*`, `audio/*`, `video/*`, `application/pdf`, `text/plain`, `text/yaml`, `text/csv`, `application/json`, and Word, Excel and PowerPoint (`.doc`, `.docx`, `.xls`, `.xlsx`, `.ppt`, `.pptx`).

Always blocked, whatever the tenant list says:

- Types: `image/svg+xml`, `text/html`, `application/xhtml+xml`, `text/xml`, JavaScript types, shell and PHP types, Windows executables.
- Extensions: `svg`, `html`, `htm`, `js`, `mjs`, `cjs`, `ts`, `tsx`, `jsx`, `exe`, `dll`, `msi`, `bat`, `cmd`, `sh`, `bash`, `ps1`, `php`, `jsp`, `asp`, `aspx`, `jar`, `war`, `wasm`, `apk`, `dmg`, `pkg`, `bin`, and a few more in `file-policy.ts`.
- Wildcards other than `image/*`, `audio/*` and `video/*` are dropped from the tenant list.

When a file arrives as `application/octet-stream`, the type is guessed from its extension.

## R2 layout (MD-02)

All objects go into the `MEDIA` bucket under a tenant prefix. Keys contain a fresh UUID per asset, so they never change.

```text
tenants/<tenantId>/assets/<assetId>/original/<safe-filename>
tenants/<tenantId>/assets/<assetId>/variants/<variant>.<format>
```

`<safe-filename>` replaces every character outside `a-z A-Z 0-9 . _ -` with `-`. Uploads without a tenant use `tenants/global/...`.

## Metadata (MD-03)

D1 tables `assets` and `asset_variants`:

| `assets` column | Notes |
| --- | --- |
| `id`, `tenant_id` | UUID; tenant scope (`global` without a tenant). |
| `filename` | May contain `/` to place the file in a folder, e.g. `blog/hero.jpg`. Renaming moves it. |
| `mime_type`, `size` | Resolved type; original size in bytes. |
| `width`, `height` | As sent by the uploader, or the largest variant's size. |
| `blurhash` | Stored if the uploader sends one. |
| `original_key` | R2 key of the original. |
| `created_by`, `created_at`, `updated_at`, `deleted_at` | `deleted_at` marks a soft delete. |

Each `asset_variants` row has `variant`, `format`, `width`, `height`, `file_size` and `object_key`.

Gaps: the admin uploader does not compute a blurhash, so `blurhash` stays empty unless an API caller provides one. The asset table has no alt text, caption, credit or focal point columns; the helpers described under [Media Metadata And Policy](public-api.md#media-metadata-and-policy) are contract-level only.

## Public asset routes

No sign-in needed. They keep working while a tenant is `suspended`.

```text
GET /api/tenants/:tenantSlug/public/assets/:assetId
GET /api/tenants/:tenantSlug/public/assets/:assetId/:variant
GET /api/tenants/:tenantSlug/public/assets/:assetId/:variant/:format
GET /api/tenants/:tenantSlug/public/assets/:assetId/:variant.:format
```

The same routes exist without the tenant prefix under `/api/public/assets/...` for single-tenant deployments.

**`/:assetId`** serves the original file.

**`/:assetId/:variant`** negotiates the format from the `Accept` header (`MD-03`):

1. `Accept` contains `image/avif`: the AVIF variant, else the WebP variant.
2. `Accept` contains `image/webp` (and not AVIF): the WebP variant.
3. Otherwise, or when the variant does not exist: the original.

**`/:assetId/:variant/:format`** (or `medium.webp`) serves exactly that stored variant. If it does not exist, it falls back to the negotiation above.

Successful responses carry:

```text
Cache-Control: public, max-age=31536000, immutable
CDN-Cache-Control: public, max-age=31536000
Accept-Ranges: bytes
x-edgecms-cache: hit
```

`Range: bytes=start-end` returns `206` with `Content-Range`. A missing asset returns `404` with `Cache-Control: no-store`.

Known issue: negotiated responses do not send `Vary: Accept`. A shared cache can hand an AVIF response to a client that asked without `image/avif`. Prefer the explicit `/:variant/:format` form behind a CDN.

### Resize parameters

The routes accept `w`/`width`, `h`/`height` (1 to 4096), `fit` (`scale-down`, `contain`, `cover`, `crop`, `pad`) and `format`/`f` (`auto`, `webp`, `avif`, `jpeg`, `png`, `json`). With any of them, the Worker makes a subrequest with Cloudflare's `cf.image` resize options. This needs Cloudflare Image Resizing enabled on the zone, and it has not been verified on a deployment yet. Without it the Worker serves the stored file.

When the subrequest fails (always in local dev), the stored bytes are returned unchanged with `x-image-transform: fallback`. In that case a `format` value is still written into `Content-Type` even though the bytes were not converted, so `?format=png` on a JPEG returns JPEG bytes labelled `image/png`. Do not rely on `format` without Image Resizing.

`@edgecms/client` builds these URLs with `getAssetUrl()`; see [Client SDK](client-sdk.md#asset-urls).

## Soft delete and R2 garbage collection (MD-04)

**Soft delete** (`DELETE .../admin/assets/:assetId` or `POST .../admin/assets/delete`) sets `deleted_at`. The asset disappears from admin lists and public routes, and its bytes stop counting toward `media_bytes` usage. R2 objects are kept, so the row could be restored in D1. Already-cached public copies are not purged and may be served until they expire from browser and CDN caches.

**Garbage collection** (`POST .../admin/assets/gc`) hard-deletes this tenant's assets soft-deleted more than `olderThanDays` ago:

```json
{ "olderThanDays": 30, "limit": 50 }
```

`olderThanDays` is 1 to 365 (default 30); `limit` is 1 to 100 (default 50). The response is `{ "deletedIds": [], "r2Failures": [] }`.

**Permanent delete** (`DELETE .../admin/assets/:assetId/permanent`) does the same for one asset immediately, live or soft-deleted.

Hard deletes remove the D1 rows, then write every R2 key to the `r2_gc_outbox` table before deleting it. A key whose delete fails stays `pending` and is retried after 5 minutes. Each `gc` call also sweeps up to 50 pending keys. Nothing runs GC on a schedule: no cron trigger calls it, so call `gc` yourself (for example from an operator script).

Both `gc` and permanent delete are open to any role that can mutate tenant admin routes, including `editor`.

## Search

`POST .../admin/assets/search`:

```json
{ "query": "team photo", "limit": 20, "folder": "about", "mimeTypePrefix": "image/" }
```

`limit` is 1 to 50 (default 20). Results are live assets, each with an optional `semanticScore`.

Semantic matching runs only when all of these hold:

- the Worker has the `ASSET_VECTORS` Vectorize binding (configured in `apps/api/wrangler.toml`);
- `CF_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are set (embeddings come from the Workers AI model `@cf/baai/bge-base-en-v1.5` through the Cloudflare REST API);
- the tenant has AI turned on ([per-tenant AI switch, HS-14](ai-command-safety.md#per-tenant-ai-switch-hs-14)).

Only the file name, folder and MIME type are embedded, not the image content. Assets are indexed after upload and rename, and removed from the index on delete; this work runs after the response and failures are only logged.

When semantic matching is off, fails, or returns fewer than `limit` results, the rest is filled by a plain `LIKE` match on filename and MIME type.

## Checks

```bash
bun test --isolate apps/api/src/tests/assets apps/api/src/tests/public/public-assets-path-normalizer.test.ts
```
