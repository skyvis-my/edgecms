# @edgecms/client

Standalone, zero-dependency client package for EdgeCMS public delivery, semantic ProseMirror AST rendering, and live draft preview.

## Features

- **Zero Runtime Dependencies**: Works in any modern JavaScript environment (Next.js, Remix, Astro, SvelteKit, Cloudflare Workers, Node.js, Bun, browser).
- **Type-safe Query Builder**: Query collections, singletons, entries, and public assets with full TypeScript autocompletion.
- **TipTap / ProseMirror AST-to-HTML**: Convert rich text JSON documents into semantic, accessible, sanitized HTML.
- **`<EdgeContent />` Component**: Render React components directly from JSON AST with optional custom component overrides.
- **Live Draft Preview Bridge**: Instant real-time draft synchronization via `window.postMessage` without database persistence.

## Installation

```bash
bun add @edgecms/client
# or
npm install @edgecms/client
```

## Usage

```typescript
import { createEdgeCmsClient, renderContentToHtml } from '@edgecms/client'

const client = createEdgeCmsClient({
  baseUrl: 'https://api.example.com',
  tenantSlug: 'acme',
})

// Query collection
const posts = await client.collection('posts').list({ page: 1, perPage: 10 })

// Query single entry
const article = await client.collection('posts').get('welcome-post')

// Convert TipTap content to HTML
const html = renderContentToHtml(article.content)
```

### React Component

```tsx
import { EdgeContent } from '@edgecms/client/react'

export function PostPage({ post }) {
  return (
    <article>
      <h1>{post.title}</h1>
      <EdgeContent content={post.content} />
    </article>
  )
}
```
