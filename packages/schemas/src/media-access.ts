import { type } from 'arktype'

export const contentApiTokenMode = type("'unsupported' | 'server-only'")

export const permissionSurface = type(
  "'admin:collections' | 'admin:entries' | 'admin:assets' | 'admin:plugins' | 'admin:settings' | 'public:content' | 'public:assets'"
)

export const roleCapabilityMatrix = type({
  role: "'viewer' | 'editor' | 'admin' | 'owner'",
  surface: permissionSurface,
  canRead: 'boolean',
  canMutate: 'boolean',
  canManage: 'boolean',
})

export const mediaAltTextMetadata = type({
  tenantSlug: 'string > 0',
  assetId: 'string > 0',
  altText: 'string > 0',
  'caption?': 'string',
  'credit?': 'string',
})

export const mediaFocalPointMetadata = type({
  tenantSlug: 'string > 0',
  assetId: 'string > 0',
  x: 'number >= 0 <= 1',
  y: 'number >= 0 <= 1',
})

export const mediaUploadPolicy = type({
  tenantSlug: 'string > 0',
  maxUploadBytes: 'number > 0',
  allowedMimeTypes: type('string > 0').array(),
})

export const publicAssetCachePolicy = type({
  cacheControl: 'string > 0',
  cdnCacheControl: 'string > 0',
  immutable: 'boolean',
})

export const signedAssetAccessPolicy = type({
  tenantSlug: 'string > 0',
  assetId: 'string > 0',
  private: 'boolean',
  expiresAt: 'string.date.iso',
  signatureRef: 'string > 0',
})

export const versionRetentionPolicy = type({
  tenantSlug: 'string > 0',
  retainVersions: 'number > 0',
  archiveAfterDays: 'number > 0',
})

export type ContentApiTokenMode = typeof contentApiTokenMode.infer
export type PermissionSurface = typeof permissionSurface.infer
export type MediaUploadPolicy = typeof mediaUploadPolicy.infer
export type RoleCapability = typeof roleCapabilityMatrix.infer
export type MediaAltTextMetadata = typeof mediaAltTextMetadata.infer
export type MediaFocalPointMetadata = typeof mediaFocalPointMetadata.infer
export type PublicAssetCachePolicy = typeof publicAssetCachePolicy.infer

export function canExposeContentApiTokenToBrowser(mode: ContentApiTokenMode): boolean {
  return mode !== 'server-only' && mode !== 'unsupported'
}

export function canMutateSurface(capability: RoleCapability, tenantSlug: string | undefined): boolean {
  if (!tenantSlug) return false
  if (capability.surface.startsWith('public:')) return false
  return capability.canMutate
}

export function canMutateTenantSurface(
  capability: RoleCapability,
  actorTenantSlug: string | undefined,
  targetTenantSlug: string
): boolean {
  return actorTenantSlug === targetTenantSlug && canMutateSurface(capability, actorTenantSlug)
}

export function buildMediaMetadataSummary(
  metadata: MediaAltTextMetadata,
  focalPoint?: MediaFocalPointMetadata
): {
  tenantSlug: string
  assetId: string
  altText: string
  caption?: string
  credit?: string
  focalPoint?: { x: number; y: number }
} {
  return {
    tenantSlug: metadata.tenantSlug,
    assetId: metadata.assetId,
    altText: metadata.altText,
    caption: metadata.caption,
    credit: metadata.credit,
    focalPoint: focalPoint ? { x: focalPoint.x, y: focalPoint.y } : undefined,
  }
}

export function isAllowedMediaUpload(policy: MediaUploadPolicy, file: { size: number; mimeType: string }): boolean {
  return (
    file.size <= policy.maxUploadBytes &&
    policy.allowedMimeTypes.some((mimeType) =>
      mimeType.endsWith('/*')
        ? file.mimeType.startsWith(mimeType.slice(0, -1))
        : file.mimeType === mimeType
    )
  )
}

export function buildPublicAssetCacheHeaders(policy: PublicAssetCachePolicy): Record<string, string> {
  return {
    'Cache-Control': policy.cacheControl,
    'CDN-Cache-Control': policy.cdnCacheControl,
  }
}

export function hasPublicAssetCacheProof(policy: PublicAssetCachePolicy): boolean {
  return (
    policy.immutable &&
    policy.cacheControl.includes('max-age=') &&
    policy.cdnCacheControl.includes('max-age=')
  )
}

export function requiresSignedPrivateAssetAccess(policy: typeof signedAssetAccessPolicy.infer): boolean {
  return policy.private && policy.signatureRef.length > 0
}
