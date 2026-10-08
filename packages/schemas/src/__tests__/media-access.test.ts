import { describe, expect, it } from 'bun:test'
import {
  buildMediaMetadataSummary,
  buildPublicAssetCacheHeaders,
  canExposeContentApiTokenToBrowser,
  canMutateSurface,
  canMutateTenantSurface,
  hasPublicAssetCacheProof,
  isAllowedMediaUpload,
  mediaAltTextMetadata,
  mediaFocalPointMetadata,
  mediaUploadPolicy,
  publicAssetCachePolicy,
  requiresSignedPrivateAssetAccess,
  roleCapabilityMatrix,
  signedAssetAccessPolicy,
  versionRetentionPolicy,
} from '../media-access'

describe('@edgecms/schemas media access', () => {
  it('validates version retention policy docs inputs', () => {
    const result = versionRetentionPolicy({
      tenantSlug: 'acme',
      retainVersions: 20,
      archiveAfterDays: 180,
    })

    expect(result).toMatchObject({ tenantSlug: 'acme', retainVersions: 20 })
  })

  it('keeps content API tokens out of browser contracts', () => {
    expect(canExposeContentApiTokenToBrowser('unsupported')).toBe(false)
    expect(canExposeContentApiTokenToBrowser('server-only')).toBe(false)
  })

  it('validates role capability matrix rows', () => {
    const result = roleCapabilityMatrix({
      role: 'editor',
      surface: 'admin:entries',
      canRead: true,
      canMutate: true,
      canManage: false,
    })

    expect(result).toMatchObject({ role: 'editor', surface: 'admin:entries' })
  })

  it('documents admin permission surfaces for content, media, plugins, and settings', () => {
    const surfaces = [
      'admin:collections',
      'admin:entries',
      'admin:assets',
      'admin:plugins',
      'admin:settings',
    ] as const

    const rows = surfaces.map((surface) =>
      roleCapabilityMatrix({
        role: surface === 'admin:settings' ? 'owner' : 'admin',
        surface,
        canRead: true,
        canMutate: surface !== 'admin:settings',
        canManage: surface === 'admin:plugins' || surface === 'admin:settings',
      })
    )

    expect(rows.map((row) => row.surface)).toEqual(surfaces)
    expect(rows.every((row) => canMutateSurface(row, 'acme') === row.canMutate)).toBe(true)
  })

  it('requires tenant context before mutating admin surfaces', () => {
    const capability = roleCapabilityMatrix({
      role: 'editor',
      surface: 'admin:assets',
      canRead: true,
      canMutate: true,
      canManage: false,
    })

    expect(canMutateSurface(capability, 'acme')).toBe(true)
    expect(canMutateSurface(capability, undefined)).toBe(false)
  })

  it('blocks cross-tenant admin surface mutation', () => {
    const capability = roleCapabilityMatrix({
      role: 'admin',
      surface: 'admin:assets',
      canRead: true,
      canMutate: true,
      canManage: true,
    })

    expect(canMutateTenantSurface(capability, 'tenant-a', 'tenant-a')).toBe(true)
    expect(canMutateTenantSurface(capability, 'tenant-a', 'tenant-b')).toBe(false)
  })

  it('never treats public surfaces as mutable', () => {
    const capability = roleCapabilityMatrix({
      role: 'admin',
      surface: 'public:content',
      canRead: true,
      canMutate: true,
      canManage: true,
    })

    expect(canMutateSurface(capability, 'acme')).toBe(false)
  })

  it('validates media alt text metadata', () => {
    const result = mediaAltTextMetadata({
      tenantSlug: 'acme',
      assetId: 'asset-1',
      altText: 'Hero image showing product dashboard',
      caption: 'Spring campaign',
      credit: 'Photo by design team',
    })

    expect(result).toMatchObject({ assetId: 'asset-1', credit: 'Photo by design team' })
  })

  it('validates media focal point metadata', () => {
    const result = mediaFocalPointMetadata({
      tenantSlug: 'acme',
      assetId: 'asset-1',
      x: 0.4,
      y: 0.6,
    })

    expect(result).toMatchObject({ x: 0.4, y: 0.6 })
    expect(mediaFocalPointMetadata({ tenantSlug: 'acme', assetId: 'asset-1', x: 2, y: 0.5 }))
      .toHaveProperty('issues')
  })

  it('builds media metadata summary with focal point', () => {
    const metadata = mediaAltTextMetadata({
      tenantSlug: 'acme',
      assetId: 'asset-1',
      altText: 'Hero image showing product dashboard',
      caption: 'Spring campaign',
      credit: 'Photo by design team',
    })
    const focalPoint = mediaFocalPointMetadata({
      tenantSlug: 'acme',
      assetId: 'asset-1',
      x: 0.4,
      y: 0.6,
    })

    expect(buildMediaMetadataSummary(metadata, focalPoint)).toMatchObject({
      tenantSlug: 'acme',
      assetId: 'asset-1',
      focalPoint: { x: 0.4, y: 0.6 },
    })
  })

  it('validates tenant media upload policy', () => {
    const result = mediaUploadPolicy({
      tenantSlug: 'acme',
      maxUploadBytes: 5 * 1024 * 1024,
      allowedMimeTypes: ['image/*', 'application/pdf'],
    })

    expect(result).toMatchObject({ tenantSlug: 'acme' })
    expect(isAllowedMediaUpload(result, { size: 1024, mimeType: 'image/png' })).toBe(true)
    expect(isAllowedMediaUpload(result, { size: 6 * 1024 * 1024, mimeType: 'image/png' })).toBe(false)
    expect(isAllowedMediaUpload(result, { size: 1024, mimeType: 'text/html' })).toBe(false)
  })

  it('validates public asset cache policy proof', () => {
    const result = publicAssetCachePolicy({
      cacheControl: 'public, max-age=31536000, immutable',
      cdnCacheControl: 'public, max-age=31536000',
      immutable: true,
    })

    expect(hasPublicAssetCacheProof(result)).toBe(true)
    expect(buildPublicAssetCacheHeaders(result)).toEqual({
      'Cache-Control': 'public, max-age=31536000, immutable',
      'CDN-Cache-Control': 'public, max-age=31536000',
    })
  })

  it('validates signed private asset access boundary without exposing a public route', () => {
    const policy = signedAssetAccessPolicy({
      tenantSlug: 'acme',
      assetId: 'asset-1',
      private: true,
      expiresAt: '2026-06-08T12:00:00.000Z',
      signatureRef: 'ASSET_SIGNING_SECRET',
    })

    expect(requiresSignedPrivateAssetAccess(policy)).toBe(true)
  })
})
