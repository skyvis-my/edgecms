import { describe, expect, it } from 'bun:test'
import {
  buildPublicCacheTags,
  buildLocaleCacheKey,
  buildLocaleCompletenessMatrix,
  buildRevalidationTargets,
  hasRevalidationTarget,
  hasLocalizedRequiredFieldGaps,
  isAllowedPublicFilter,
  isLocaleComplete,
  localeCompletenessRow,
  localeCacheKeyParts,
  localeFallbackPolicy,
  meetsPublicReadThreshold,
  missingRequiredLocalizedFields,
  publicFilterAllowlist,
  publicCacheTagParts,
  publicReadPerfFixture,
  publicReadPerfThreshold,
  revalidationPayloadContract,
  rejectsUnsupportedPublicFilter,
  resolvePublicReadLocale,
  shouldFallbackLocale,
} from '../public-delivery'

describe('@edgecms/schemas public delivery', () => {
  it('validates locale fallback policy', () => {
    const policy = localeFallbackPolicy({
      tenantSlug: 'acme',
      requestedLocale: 'ms',
      fallbackLocale: 'en',
      fallbackEnabled: true,
    })

    expect(shouldFallbackLocale(policy)).toBe(true)
  })

  it('resolves public read locale without hiding fallback decisions', () => {
    const policy = localeFallbackPolicy({
      tenantSlug: 'acme',
      requestedLocale: 'ms',
      fallbackLocale: 'en',
      fallbackEnabled: true,
    })
    const disabled = localeFallbackPolicy({
      tenantSlug: 'acme',
      requestedLocale: 'ms',
      fallbackLocale: 'en',
      fallbackEnabled: false,
    })

    expect(resolvePublicReadLocale(policy, ['en'])).toBe('en')
    expect(resolvePublicReadLocale(policy, ['ms', 'en'])).toBe('ms')
    expect(resolvePublicReadLocale(disabled, ['en'])).toBeNull()
  })

  it('validates locale completeness matrix rows', () => {
    const complete = localeCompletenessRow({
      locale: 'en',
      requiredFields: ['title', 'body'],
      missingFields: [],
    })
    const incomplete = localeCompletenessRow({
      locale: 'ms',
      requiredFields: ['title', 'body'],
      missingFields: ['body'],
    })

    expect(isLocaleComplete(complete)).toBe(true)
    expect(isLocaleComplete(incomplete)).toBe(false)
  })

  it('identifies missing required localized fields before publish', () => {
    expect(
      missingRequiredLocalizedFields(['title', 'body', 'summary'], {
        title: 'Hello',
        body: 'Localized body',
      }),
    ).toEqual(['summary'])
  })

  it('builds locale completeness rows from localized entry data', () => {
    const rows = buildLocaleCompletenessMatrix(['title', 'body'], {
      en: { title: 'Hello', body: 'Body' },
      ms: { title: 'Helo' },
    })

    expect(rows).toEqual([
      { locale: 'en', requiredFields: ['title', 'body'], missingFields: [] },
      { locale: 'ms', requiredFields: ['title', 'body'], missingFields: ['body'] },
    ])
    expect(hasLocalizedRequiredFieldGaps(rows)).toBe(true)
  })

  it('includes tenant, locale, status, and filter hash in public cache keys', () => {
    const parts = localeCacheKeyParts({
      tenantSlug: 'acme',
      collectionSlug: 'posts',
      requestedLocale: 'ms',
      status: 'published',
      filterHash: 'qabc123',
    })

    expect(buildLocaleCacheKey(parts)).toBe(
      'public-read|tenant:acme|collection:posts|locale:ms|status:published|filters:qabc123'
    )
  })

  it('validates public filter allowlist docs contract', () => {
    const allowlist = publicFilterAllowlist({
      topLevelFields: ['slug', 'createdAt', 'updatedAt', 'status'],
      dataFieldPattern: '^data\\.[A-Za-z0-9_-]+(?:\\.[A-Za-z0-9_-]+)*$',
    })

    expect(isAllowedPublicFilter(allowlist, 'slug')).toBe(true)
    expect(isAllowedPublicFilter(allowlist, 'data.category')).toBe(true)
    expect(isAllowedPublicFilter(allowlist, 'id')).toBe(false)
    expect(rejectsUnsupportedPublicFilter(allowlist, 'id')).toBe(true)
  })

  it('validates revalidation payload contract', () => {
    const payload = revalidationPayloadContract({
      tenantSlug: 'acme',
      collectionSlug: 'posts',
      event: 'entry.published',
      paths: ['/blog/hello-world'],
      tags: ['collection:posts', 'entry:entry-1', 'locale:en'],
    })

    expect(hasRevalidationTarget(payload)).toBe(true)
    expect(payload).toMatchObject({ tenantSlug: 'acme', collectionSlug: 'posts' })
    expect(buildRevalidationTargets(payload)).toEqual({
      tenantSlug: 'acme',
      collectionSlug: 'posts',
      paths: ['/blog/hello-world'],
      tags: ['collection:posts', 'entry:entry-1', 'locale:en'],
    })
  })

  it('builds public cache tags for collection, locale, and entry revalidation', () => {
    const parts = publicCacheTagParts({
      collectionSlug: 'posts',
      locale: 'en',
      entryId: 'entry-1',
    })

    expect(buildPublicCacheTags(parts)).toEqual(['collection:posts', 'locale:en', 'entry:entry-1'])
  })

  it('validates public read performance fixture path', () => {
    const fixture = publicReadPerfFixture({
      tenantSlug: 'smoke',
      collectionSlug: 'posts',
      entrySlug: 'hello-world',
      path: '/api/tenants/smoke/api/public/posts/hello-world',
    })

    expect(fixture.path).toContain('/api/tenants/smoke')
  })

  it('validates public read performance threshold result', () => {
    const passing = publicReadPerfThreshold({ mode: 'local', p95Ms: 32, thresholdMs: 50 })
    const failing = publicReadPerfThreshold({ mode: 'remote', p95Ms: 180, thresholdMs: 100 })

    expect(meetsPublicReadThreshold(passing)).toBe(true)
    expect(meetsPublicReadThreshold(failing)).toBe(false)
  })
})
