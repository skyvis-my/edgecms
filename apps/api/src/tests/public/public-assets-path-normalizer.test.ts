import { describe, expect, it } from 'bun:test'
import {
  rewritePublicAssetFormatRequest,
  applyPublicAssetFormatAliases,
} from '@/public/public-assets-path-normalizer'
import { getRequestUrl } from '@/shared/utils/request-url'

describe('public-assets-path-normalizer', () => {
  it('rewrites global public asset requests with dot format (length 6)', () => {
    const req = new Request('http://localhost/api/public/assets/ast123/thumbnail.webp')
    const rewritten = rewritePublicAssetFormatRequest(req)
    expect(rewritten.url).toBe('http://localhost/api/public/assets/ast123/thumbnail/webp')
    expect(getRequestUrl(rewritten).pathname).toBe('/api/public/assets/ast123/thumbnail/webp')
  })

  it('rewrites tenant scoped public asset requests without /api prefix (length 8)', () => {
    const req = new Request('http://localhost/api/tenants/acme/public/assets/ast123/banner.jpg')
    const rewritten = rewritePublicAssetFormatRequest(req)
    expect(rewritten.url).toBe('http://localhost/api/tenants/acme/public/assets/ast123/banner/jpg')
    expect(getRequestUrl(rewritten).pathname).toBe('/api/tenants/acme/public/assets/ast123/banner/jpg')
  })

  it('rewrites tenant scoped public asset requests with /api prefix (length 9)', () => {
    const req = new Request('http://localhost/api/tenants/acme/api/public/assets/ast123/banner.png')
    const rewritten = rewritePublicAssetFormatRequest(req)
    expect(rewritten.url).toBe('http://localhost/api/tenants/acme/api/public/assets/ast123/banner/png')
    expect(getRequestUrl(rewritten).pathname).toBe('/api/tenants/acme/api/public/assets/ast123/banner/png')
  })

  it('preserves query parameters during rewriting', () => {
    const req = new Request('http://localhost/api/public/assets/ast123/thumb.webp?width=400&q=80')
    const rewritten = rewritePublicAssetFormatRequest(req)
    expect(rewritten.url).toBe('http://localhost/api/public/assets/ast123/thumb/webp?width=400&q=80')
    expect(getRequestUrl(rewritten).search).toBe('?width=400&q=80')
  })

  it('ignores asset requests without extension format', () => {
    const req = new Request('http://localhost/api/public/assets/ast123/original')
    const rewritten = rewritePublicAssetFormatRequest(req)
    expect(rewritten).toBe(req)
  })

  it('ignores non-asset requests quickly without parsing', () => {
    const req = new Request('http://localhost/api/admin/collections')
    const rewritten = rewritePublicAssetFormatRequest(req)
    expect(rewritten).toBe(req)
  })

  it('works with applyPublicAssetFormatAliases wrapper', async () => {
    const mockApp = {
      handle: async (req: Request) => new Response(req.url),
      fetch: async (req: Request) => new Response(req.url),
    }

    const wrapped = applyPublicAssetFormatAliases(mockApp)
    const resHandle = await wrapped.handle(
      new Request('http://localhost/api/tenants/acme/public/assets/ast1/md.webp')
    )
    expect(await resHandle.text()).toBe(
      'http://localhost/api/tenants/acme/public/assets/ast1/md/webp'
    )

    const resFetch = (await wrapped.fetch(
      new Request('http://localhost/api/public/assets/ast2/lg.avif')
    )) as Response
    expect(await resFetch.text()).toBe('http://localhost/api/public/assets/ast2/lg/avif')
  })
})
