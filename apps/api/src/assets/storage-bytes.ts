import { resolveAssetMimeType } from './file-policy'

/** Decoded byte length of a base64 string, without decoding it. */
export function estimateDecodedSize(base64: string): number {
  const normalized = base64.trim()
  if (normalized.length === 0) return 0
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0
  return Math.floor((normalized.length * 3) / 4) - padding
}

/**
 * Bytes an upload will add to storage (HS-06 `media_bytes` check): the
 * original plus the variants the service keeps, which are images only.
 */
export function estimateUploadBytes(input: {
  filename: string
  mimeType: string
  contentBase64?: string
  contentBytes?: Uint8Array
  variants?: Array<{ contentBase64?: string; contentBytes?: Uint8Array }>
}): number {
  const isImage = resolveAssetMimeType(input.filename, input.mimeType).startsWith('image/')
  const variantBytes = isImage
    ? (input.variants ?? []).reduce(
        (sum, variant) =>
          sum +
          (variant.contentBytes
            ? variant.contentBytes.byteLength
            : variant.contentBase64
              ? estimateDecodedSize(variant.contentBase64)
              : 0),
        0
      )
    : 0
  const mainBytes = input.contentBytes
    ? input.contentBytes.byteLength
    : input.contentBase64
      ? estimateDecodedSize(input.contentBase64)
      : 0
  return mainBytes + variantBytes
}

/** Stored bytes of an asset row: original plus variants (HS-05 `media_bytes`). */
export function storedAssetBytes(asset: {
  size?: number | null
  variants?: Array<{ fileSize?: number | null }>
}): number {
  return (
    (asset.size ?? 0) +
    (asset.variants ?? []).reduce((sum, variant) => sum + (variant.fileSize ?? 0), 0)
  )
}
