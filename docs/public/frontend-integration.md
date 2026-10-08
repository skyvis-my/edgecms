# Frontend Integration

Frontend apps should consume EdgeCMS through public delivery routes, not admin routes.

Set these values in server-side env:

```bash
EDGE_CMS_URL=http://localhost:8787
EDGE_CMS_TENANT=smoke
```

## Plain Fetch

Repo sample: `examples/public-fetch/plain-fetch.ts` contains a tested URL builder for tenant-scoped collection and entry reads.

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

For locale-aware frontends, keep the requested locale explicit and treat fallback as a visible caller decision:

```ts
const res = await fetch(
  `${EDGE_CMS_URL}/api/tenants/${tenantSlug}/api/public/${collectionSlug}?locale=ms&fallbackLocale=en`,
)
```

The repo sample keeps `locale` and `fallbackLocale` separate so cache tags, analytics, and missing-content handling can still identify the requested locale. It also exposes `buildPublicReadCacheTags({ collectionSlug, locale })` for frontend caches that need tags derived from the requested locale.

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

Keep pagination parsing tolerant until the public response envelope is versioned. Use the collection docs or smoke response as the source of truth for the current list shape.

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

Only request relation population for collections that have relation fields and test coverage. Frontend apps should tolerate missing related entries.

Keep `depth` shallow and collection-specific. Treat missing relation targets as absent content, not as a retry loop, because related entries can be unpublished, tenant-filtered, or intentionally omitted by the public route.

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

## Preview Mode

Preview mode should use a signed token or equivalent server-only secret. Do not expose admin credentials or preview secrets in browser bundles.

Preview fetching should terminate in server code that can hold the secret. Browser bundles should keep using anonymous public routes for published content only.

Recommended preview flow:

1. Admin/editor requests preview through an authenticated server route.
2. Server validates tenant, entry id, draft status, and signed token metadata.
3. Server resolves draft content and renders or proxies it without exposing the preview secret to browser bundles.
4. Public frontend code continues to call anonymous public routes for published content only.

## Revalidation

Use webhook-driven revalidation after publish:

1. Author publishes entry.
2. EdgeCMS emits webhook or plugin hook.
3. Frontend app validates signature.
4. Frontend app revalidates route or cache tag.

### Next.js Revalidation Route

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

### Astro Revalidation Endpoint

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

### Plain Fetch Revalidation Handler

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

Run webhook dry-run before enabling a destination. Dry-run records signature and policy validation without sending an outbound request.

## Verification

- Confirm frontend app reads only public routes.
- Confirm tenant slug is explicit.
- Confirm list pagination uses explicit `page` and `perPage`.
- Confirm relation examples are used only for collections with relation fields.
- Confirm preview secrets stay server-side.
- Confirm publish triggers frontend refresh.
