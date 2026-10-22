# Frontend integration

This guide shows how a frontend app reads published EdgeCMS content and refreshes its cache when an editor publishes. It is for developers building sites with plain `fetch`, Next.js or Astro.

Read content through the public routes described in [Public API](public-api.md). Never call admin routes from a frontend. For a typed client, see [Client SDK](client-sdk.md).

## Configure the app

Set these in server-side environment variables:

```bash
EDGE_CMS_URL=http://localhost:8787
EDGE_CMS_TENANT=smoke
```

## Fetch content with plain fetch

`examples/public-fetch/plain-fetch.ts` contains a tested URL builder (`buildPublicReadUrl`) and fetch helper (`fetchPublishedEntry`) for tenant-scoped list and entry reads.

```ts
const tenantSlug = 'smoke'
const collectionSlug = 'smoke-posts'

const res = await fetch(
  `${EDGE_CMS_URL}/api/tenants/${tenantSlug}/api/public/${collectionSlug}?locale=en`,
)

if (!res.ok) {
  throw new Error(`EdgeCMS request failed: ${res.status}`)
}

const body = await res.json()
```

### Locales

Always pass `locale` explicitly. The API returns content for that locale only and does not fall back to another one. If you want a fallback, request the fallback locale yourself when the first read is missing content.

The example helper accepts a `fallbackLocale` option and adds it to the URL when it differs from `locale`. The API currently ignores that parameter; the helper keeps it so your caching, analytics and missing-content handling can still see which locale was requested. `buildPublicReadCacheTags({ collectionSlug, locale })` returns frontend cache tags for a requested locale, such as `edgecms:collection:posts` and `edgecms:locale:en`.

### Pagination

```ts
const page = 1
const perPage = 12
const res = await fetch(
  `${EDGE_CMS_URL}/api/tenants/${tenantSlug}/api/public/${collectionSlug}?locale=en&page=${page}&perPage=${perPage}`,
)

if (!res.ok) {
  throw new Error(`EdgeCMS page request failed: ${res.status}`)
}

const pageBody = await res.json()
```

`perPage` defaults to 20 and is capped at 100. The list response shape is not versioned yet, so parse pagination metadata defensively.

### Relations

```ts
const res = await fetch(
  `${EDGE_CMS_URL}/api/tenants/${tenantSlug}/api/public/${collectionSlug}/hello-edgecms?locale=en&populate=author&depth=1`,
)

if (!res.ok) {
  throw new Error(`EdgeCMS relation request failed: ${res.status}`)
}

const entryWithAuthor = await res.json()
```

Only populate fields that are relation fields in the collection. Keep `depth` low (it is capped at 3). A related entry can be missing because it is unpublished, belongs to another tenant, or was left out by the public route; render it as absent content and do not retry.

## Next.js

```ts
export async function getEdgeCmsEntries(collectionSlug: string) {
  const res = await fetch(
    `${process.env.EDGE_CMS_URL}/api/tenants/${process.env.EDGE_CMS_TENANT}/api/public/${collectionSlug}?locale=en`,
    {
      next: { tags: [`edgecms:collection:${collectionSlug}`, 'edgecms:locale:en'] },
    },
  )

  if (!res.ok) {
    throw new Error(`EdgeCMS request failed: ${res.status}`)
  }

  return res.json()
}
```

## Astro

```ts
const res = await fetch(
  `${import.meta.env.EDGE_CMS_URL}/api/tenants/${import.meta.env.EDGE_CMS_TENANT}/api/public/posts?locale=en`,
)
const posts = await res.json()
```

## Preview drafts

Draft preview routes are not public. Fetch drafts only in server code that can hold a secret, and keep browser code on the anonymous public routes.

1. An editor requests a preview through an authenticated server route in your app.
2. Your server checks the tenant, entry id, draft status and a signed preview token.
3. Your server loads the draft through an authenticated EdgeCMS flow and renders or proxies it, without sending the secret to the browser.
4. Browser code keeps calling the public routes for published content.

Never put admin credentials or preview secrets in a browser bundle.

## Revalidate after publish

1. An editor publishes an entry.
2. EdgeCMS sends a signed webhook (or a plugin hook runs).
3. Your app checks the signature.
4. Your app revalidates the paths or cache tags in the event.

Webhooks sign the raw body with HMAC-SHA256 and send `x-edgecms-signature: sha256=<hex digest>`. Publish events list paths in `data.metadata.revalidate.paths` and tags in `data.metadata.revalidate.tags`. Run a webhook dry run before enabling a destination; it checks the destination policy and signing without sending a request. See [Webhooks](webhooks.md).

### Next.js route handler

```ts
import { createHmac, timingSafeEqual } from 'node:crypto'
import { revalidatePath, revalidateTag } from 'next/cache'
import { NextResponse } from 'next/server'

function verifySignature(rawBody: string, signature: string, secret: string) {
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`
  return signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
}

export async function POST(request: Request) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-edgecms-signature') ?? ''

  if (!verifySignature(rawBody, signature, process.env.EDGECMS_WEBHOOK_SECRET!)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const payload = JSON.parse(rawBody)
  for (const path of payload.data?.metadata?.revalidate?.paths ?? []) {
    revalidatePath(path)
  }
  for (const tag of payload.data?.metadata?.revalidate?.tags ?? []) {
    revalidateTag(`edgecms:${tag}`)
  }

  return NextResponse.json({ ok: true })
}
```

### Astro endpoint

```ts
import type { APIRoute } from 'astro'
import { createHmac, timingSafeEqual } from 'node:crypto'

export const POST: APIRoute = async ({ request, locals }) => {
  const rawBody = await request.text()
  const signature = request.headers.get('x-edgecms-signature') ?? ''
  const expected = `sha256=${createHmac('sha256', locals.runtime.env.EDGECMS_WEBHOOK_SECRET).update(rawBody).digest('hex')}`

  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return new Response('Invalid signature', { status: 401 })
  }

  const payload = JSON.parse(rawBody)
  await locals.runtime.env.PUBLIC_CACHE.delete(`edgecms:${payload.data?.after?.slug}`)
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'content-type': 'application/json' },
  })
}
```

### Plain handler

```ts
import { createHmac, timingSafeEqual } from 'node:crypto'

export async function handleEdgeCmsWebhook(request: Request, secret: string) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-edgecms-signature') ?? ''
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`

  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return new Response('Invalid signature', { status: 401 })
  }

  const payload = JSON.parse(rawBody)
  await Promise.all(
    (payload.data?.metadata?.revalidate?.paths ?? []).map((path: string) =>
      fetch(`https://frontend.example.com/internal/revalidate?path=${encodeURIComponent(path)}`, {
        method: 'POST',
      }),
    ),
  )

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'content-type': 'application/json' },
  })
}
```

## Checklist

- The app reads only public routes.
- Every request names the tenant slug.
- List requests pass `page` and `perPage`.
- Relation population is used only on collections with relation fields.
- Preview secrets stay on the server.
- Publishing an entry refreshes the frontend.
