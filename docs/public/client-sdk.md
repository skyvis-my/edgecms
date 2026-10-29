# Client SDK (`@edgecms/client`)

`@edgecms/client` is a small TypeScript package for frontends that read EdgeCMS content. It wraps the public delivery routes, renders TipTap/ProseMirror rich text, and carries live draft updates from the admin editor into a preview iframe.

Source: [`packages/client/src`](../../packages/client/src). Tests: [`packages/client/src/__tests__`](../../packages/client/src/__tests__).

## Install

```bash
bun add @edgecms/client
```

Publish path, dry-run, and `NPM_TOKEN` notes: [publishing-packages.md](publishing-packages.md).

**Inside this monorepo** (how `apps/admin` uses it during local development):

```json
{
  "dependencies": {
    "@edgecms/client": "workspace:*"
  }
}
```

`bun install` runs the package's `postinstall`, which builds `packages/client/dist`. Rebuild after changing the source:

```bash
bun run --filter @edgecms/client build
bun run test:client
```

**Before the first npm publish** (or offline), pack a tarball:

```bash
cd packages/client
npm pack                      # writes edgecms-client-0.2.0.tgz
cd /path/to/your-app
npm install --ignore-scripts /path/to/edgecms-client-0.2.0.tgz
npm install react             # needed even if you only use the fetch client, see below
```

Two known gaps make the tarball awkward:

- `--ignore-scripts` is required. The `postinstall` script runs `node scripts/build.mjs`, but `scripts/` is not in the package `files` list, so a normal install fails with `MODULE_NOT_FOUND`.
- The root entry re-exports the React component and the `useDraftPreview` hook, so `import ... from '@edgecms/client'` needs `react` to be resolvable. The package lists React as an optional peer dependency, but the root import fails without it.

## Exports

From `@edgecms/client`:

| Export | Kind | Purpose |
| --- | --- | --- |
| `createEdgeCmsClient`, `EdgeCmsClient` | fetch client | Read collections, entries and singletons; build asset URLs; request preview tokens. |
| `renderContentToHtml` | function | TipTap/ProseMirror JSON (or a JSON string, or an HTML string) to HTML. |
| `sanitizeHtmlString` | function | Strips script, style, iframe, object, embed, svg and math tags, `on*` handlers and `javascript:`/`vbscript:`/`data:` URLs. |
| `EdgeContent` | React component | Renders the same rich-text JSON as React elements, with per-node overrides. |
| `sendDraftPreviewUpdate`, `sendPreviewReadyNotification`, `listenToDraftPreview` | functions | `window.postMessage` bridge for live draft preview. |
| `useDraftPreview` | React hook | Subscribes a preview page to draft updates. |
| `EDGECMS_PREVIEW_MESSAGE_TYPE`, `EDGECMS_PREVIEW_READY_TYPE` | constants | `'EDGECMS_PREVIEW_UPDATE'` and `'EDGECMS_PREVIEW_READY'`. |
| Types | types | `EdgeCmsClientConfig`, `CollectionListOptions`, `PaginatedListResponse`, `AssetUrlOptions`, `TipTapNode`, and others in [`types.ts`](../../packages/client/src/types.ts). |

From `@edgecms/client/react`: `EdgeContent` and its prop types only.

The package has no Section Builder export. See [Section Builder content](#section-builder-content) below.

## Fetch client

```ts
import { createEdgeCmsClient } from '@edgecms/client'

const cms = createEdgeCmsClient({
  baseUrl: process.env.EDGE_CMS_URL!, // e.g. http://localhost:8787
  tenantSlug: 'acme',
  defaultLocale: 'en',                // default 'en'
  // apiKey: '...',                   // sent as Authorization: Bearer <apiKey>
  // headers: { ... },                // merged into every request
  // fetch: customFetch,              // defaults to globalThis.fetch
})
```

`baseUrl` and `tenantSlug` are required; the constructor throws without them. A trailing slash on `baseUrl` is removed.

### Reads

```ts
const posts = await cms.collection('posts').list({
  page: 1,
  perPage: 10,
  sort: '-publishedAt',
  filter: { category: 'news' },
})

const post = await cms.collection('posts').get('welcome-post', { populate: 'author' })

const settings = await cms.collection('site-settings').getSingleton()
```

These call the tenant-scoped public routes (see [Public API Guide](public-api.md)):

```text
GET /api/tenants/:tenantSlug/public/:collectionSlug
GET /api/tenants/:tenantSlug/public/:collectionSlug/:entryIdOrSlug
GET /api/tenants/:tenantSlug/public/singleton/:collectionSlug
```

`/api/tenants/:tenantSlug/public/...` is an alias the API rewrites to `/api/tenants/:tenantSlug/api/public/...`, so both forms reach the same handler.

Query parameters sent by the client: `locale` (always, falling back to `defaultLocale`), `page`, `perPage`, `sort`, `depth`, `populate` (on `get`), and each `filter` key as its own parameter. Which filters the server accepts is set by the [public filter allowlist](public-api.md#public-filter-allowlist).

A non-2xx response throws an `Error` whose message includes the status and the response body, for example `EdgeCMS list request failed (404): ...`.

`list()` is typed as `PaginatedListResponse<T>` (`{ data, meta?, pagination? }`). Keep parsing tolerant, as [Frontend Integration](frontend-integration.md) recommends, until the public response envelope is versioned.

Public reads need no credentials. `apiKey` is only forwarded as a bearer header; the public read routes do not check it.

### Asset URLs

`getAssetUrl` builds a URL string and makes no request:

```ts
cms.getAssetUrl(asset.id)
// .../api/tenants/acme/public/assets/<id>/original

cms.getAssetUrl(asset.id, { variant: 'medium', format: 'webp' })
// .../api/tenants/acme/public/assets/<id>/medium.webp

cms.getAssetUrl(asset.id, { variant: 'large', width: 800, fit: 'cover' })
// .../api/tenants/acme/public/assets/<id>/large?w=800&fit=cover
```

What each form returns (format negotiation, fallbacks, transforms) is described in [Media](media.md#public-asset-routes).

### Preview tokens

```ts
const { token, expiresAt } = await cms.createPreviewToken({
  collectionSlug: 'posts',
  entrySlug: 'welcome-post',
  previewUrl: 'https://www.example.com/blog/welcome-post',
  ttlSeconds: 600,
})
```

This sends `POST /api/tenants/:tenantSlug/public/preview-token`. On the tenant-scoped path, a `POST` counts as a tenant admin mutation, so the caller must be signed in with a role that can mutate tenant admin routes (owner, admin or editor). Call it from server code or the admin, not from a public browser bundle.

`list`, `get` and `getSingleton` accept a `previewToken` option. The client sends it as the `previewToken` query parameter and the `x-edgecms-preview-token` header, but the public read handlers do not read either today: they return published content only. Draft content reaches a preview page through the postMessage bridge below, not through these reads. The [Preview](public-api.md#preview) rules in the Public API Guide still apply.

## Rich text

```ts
import { renderContentToHtml } from '@edgecms/client'

const html = renderContentToHtml(post.content)
```

Supported nodes: `doc`, `paragraph`, `heading` (levels 1-6), `blockquote`, `bulletList`, `orderedList`, `listItem`, `codeBlock`, `image`, `horizontalRule`, `hardBreak`, `text`. Supported marks: bold/`strong`, italic/`em`, strike/`s`, `code`, underline/`u`, `link`, `highlight`, `subscript`/`sub`, `superscript`/`sup`.

Text is HTML-escaped. Link and image URLs must start with `http://`, `https://`, `mailto:`, `tel:`, `/`, `#`, `./` or `../`; anything else becomes `#`. Links with `target="_blank"` get `rel="noopener noreferrer"`. Unknown nodes render their children.

Add your own nodes with `customRenderers` (from `serializer.test.ts`):

```ts
const html = renderContentToHtml(doc, {
  customRenderers: {
    callout: (node) => `<div class="callout-${node.attrs?.type}">${node.text}</div>`,
  },
})
```

A custom renderer's output is inserted as-is. Escape any text you put in it.

String input is handled two ways: a string that parses as a JSON object is rendered as a document; any other string is treated as HTML and passed through `sanitizeHtmlString`. That sanitizer is a set of regular expressions, not a full HTML parser. If you render HTML from untrusted authors, run it through a dedicated sanitizer as well.

## React component

```tsx
import { EdgeContent } from '@edgecms/client/react'

export function PostBody({ post }) {
  return <EdgeContent content={post.content} className="prose" />
}
```

Override node rendering with `components` (from `react.test.tsx`):

```tsx
<EdgeContent
  content={post.content}
  components={{
    heading: ({ level, children }) => <div className={`custom-h${level}`}>{children}</div>,
    codeBlock: ({ language, code }) => <pre data-lang={language}>{code}</pre>,
  }}
/>
```

Overridable keys: `paragraph`, `heading`, `blockquote`, `bulletList`, `orderedList`, `listItem`, `codeBlock`, `image`, `link`. A string `content` value is sanitized with `sanitizeHtmlString` and rendered as HTML.

## Live draft preview bridge

The admin entry editor streams the unsaved form to a preview iframe with `window.postMessage`. Nothing is written to the database for these updates.

Message shapes:

```json
{ "type": "EDGECMS_PREVIEW_UPDATE", "token": "<optional>", "payload": { "...": "..." } }
{ "type": "EDGECMS_PREVIEW_READY" }
```

The admin sends this payload (see `apps/admin/src/features/entries/components/entry-form.tsx`):

```json
{
  "slug": "welcome-post",
  "status": "draft",
  "data": { "title": "...", "content": { "type": "doc", "content": [] } },
  "locale": "en",
  "collectionSlug": "posts",
  "updatedAt": "2026-10-22T08:00:00.000Z"
}
```

In the preview page:

```tsx
import { useDraftPreview } from '@edgecms/client'

export function PostPreview({ published }) {
  const { data, isPreview } = useDraftPreview(published, {
    allowedOrigin: 'https://admin.example.com',
  })
  return <Post entry={data} draft={isPreview} />
}
```

Without React:

```ts
import { listenToDraftPreview } from '@edgecms/client'

const stop = listenToDraftPreview((draft) => render(draft), {
  allowedOrigin: 'https://admin.example.com',
})
```

`listenToDraftPreview` posts `EDGECMS_PREVIEW_READY` to `window.parent` when it starts. The admin answers by sending the current draft.

Security notes:

- Always set `allowedOrigin` to your admin's origin. Without it, the listener accepts messages from any window.
- The `token` option only rejects messages that carry a different token. A message with no token is still accepted.
- The admin posts drafts with `targetOrigin: '*'`, so whatever page is loaded in the preview iframe receives them. Point the tenant's preview URL only at sites you control.

## Section Builder content

The Section Builder is an admin field editor (`sections`, `blocks` or `section-builder` field types, in `apps/admin/src/features/entries/components/field-renderers/section-builder.tsx`). It stores an array of blocks typed in [`packages/schemas/src/block-sections.ts`](../../packages/schemas/src/block-sections.ts): `hero`, `features`, `textBlock`, `imageGallery`, `callToAction`, `faq`. Each block has an `id` and a `type`.

`@edgecms/client` does not render these blocks. Read the field from the entry and switch on `type` in your own components. Shared contracts live in `@edgecms/schemas` (also publishable).

## Checks

```bash
bun run test:client
bun run --filter @edgecms/client check   # build, private flag, zero dependencies, dist imports
```
