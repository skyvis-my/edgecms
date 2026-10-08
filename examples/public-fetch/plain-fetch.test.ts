import { describe, expect, it } from 'bun:test'
import { buildPublicReadCacheTags, buildPublicReadUrl } from './plain-fetch'

describe('public fetch example', () => {
  it('builds tenant-scoped collection URLs', () => {
    expect(
      buildPublicReadUrl({
        baseUrl: 'https://cms.example.test/',
        tenantSlug: 'acme',
        collectionSlug: 'posts',
        locale: 'en',
      })
    ).toBe('https://cms.example.test/api/tenants/acme/api/public/posts?locale=en')
  })

  it('builds locale fallback URLs without hiding the requested locale', () => {
    expect(
      buildPublicReadUrl({
        baseUrl: 'https://cms.example.test/',
        tenantSlug: 'acme',
        collectionSlug: 'posts',
        locale: 'ms',
        fallbackLocale: 'en',
      })
    ).toBe('https://cms.example.test/api/tenants/acme/api/public/posts?locale=ms&fallbackLocale=en')
  })

  it('builds tenant-scoped entry URLs', () => {
    expect(
      buildPublicReadUrl({
        baseUrl: 'https://cms.example.test',
        tenantSlug: 'acme',
        collectionSlug: 'posts',
        entrySlug: 'hello-world',
      })
    ).toBe('https://cms.example.test/api/tenants/acme/api/public/posts/hello-world')
  })

  it('builds frontend cache tags from the requested locale', () => {
    expect(buildPublicReadCacheTags({ collectionSlug: 'posts', locale: 'ms' })).toEqual([
      'edgecms:collection:posts',
      'edgecms:locale:ms',
    ])
  })
})
