import { join } from 'node:path'

/**
 * Fetcher that serves the built admin SPA from disk (ASSETS binding stand-in).
 * SPA fallback: unknown paths → index.html.
 */
export function createStaticAssetsFetcher(distDir: string): Fetcher {
  return {
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const request =
        input instanceof Request ? input : new Request(String(input), init)
      const url = new URL(request.url)
      let pathname = decodeURIComponent(url.pathname)
      if (pathname.endsWith('/')) pathname = `${pathname}index.html`
      if (pathname === '/') pathname = '/index.html'

      const candidate = join(distDir, pathname.replace(/^\/+/, ''))
      // Prevent path escape
      if (!candidate.startsWith(distDir)) {
        return new Response('Forbidden', { status: 403 })
      }

      let file = Bun.file(candidate)
      if (!(await file.exists())) {
        file = Bun.file(join(distDir, 'index.html'))
        if (!(await file.exists())) {
          return new Response('Admin SPA not found. Build apps/admin first.', { status: 404 })
        }
      }

      const headers = new Headers()
      if (file.type) headers.set('content-type', file.type)
      headers.set('cache-control', pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache')
      return new Response(file, { status: 200, headers })
    },
  } as Fetcher
}
