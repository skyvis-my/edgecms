import { Type, createSchema } from './typebox'

export const contentApiTokenMode = createSchema(
  Type.Union([Type.Literal('unsupported'), Type.Literal('server-only')])
)

export const permissionSurface = createSchema(
  Type.Union([
    Type.Literal('admin:collections'),
    Type.Literal('admin:entries'),
    Type.Literal('admin:assets'),
    Type.Literal('admin:plugins'),
    Type.Literal('admin:settings'),
    Type.Literal('public:content'),
    Type.Literal('public:assets'),
  ])
)

export const roleCapabilityMatrix = createSchema(
  Type.Object({
    role: Type.Union([
      Type.Literal('viewer'),
      Type.Literal('editor'),
      Type.Literal('admin'),
      Type.Literal('owner'),
    ]),
    surface: permissionSurface,
    canRead: Type.Boolean(),
    canMutate: Type.Boolean(),
    canManage: Type.Boolean(),
  })
)

export const mediaAltTextMetadata = createSchema(
  Type.Object({
    tenantSlug: Type.String({ minLength: 1 }),
    assetId: Type.String({ minLength: 1 }),
    altText: Type.String({ minLength: 1 }),
    caption: Type.Optional(Type.String()),
    credit: Type.Optional(Type.String()),
  })
)

export const mediaFocalPointMetadata = createSchema(
  Type.Object({
    tenantSlug: Type.String({ minLength: 1 }),
    assetId: Type.String({ minLength: 1 }),
    x: Type.Number({ minimum: 0, maximum: 1 }),
    y: Type.Number({ minimum: 0, maximum: 1 }),
  })
)

export const mediaUploadPolicy = createSchema(
  Type.Object({
    tenantSlug: Type.String({ minLength: 1 }),
    maxUploadBytes: Type.Number({ minimum: 1 }),
    allowedMimeTypes: Type.Array(Type.String({ minLength: 1 })),
  })
)

export const publicAssetCachePolicy = createSchema(
  Type.Object({
    cacheControl: Type.String({ minLength: 1 }),
    cdnCacheControl: Type.String({ minLength: 1 }),
    immutable: Type.Boolean(),
  })
)

export const signedAssetAccessPolicy = createSchema(
  Type.Object({
    tenantSlug: Type.String({ minLength: 1 }),
    assetId: Type.String({ minLength: 1 }),
    private: Type.Boolean(),
    expiresAt: Type.String({ minLength: 1 }),
    signatureRef: Type.String({ minLength: 1 }),
  })
)

export const versionRetentionPolicy = createSchema(
  Type.Object({
    tenantSlug: Type.String({ minLength: 1 }),
    retainVersions: Type.Number({ minimum: 1 }),
    archiveAfterDays: Type.Number({ minimum: 1 }),
  })
)

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
