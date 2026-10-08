import type { VariantName } from './r2-keys'
import { buildVariantKey } from './r2-keys'

export interface PlannedVariant {
  variant: VariantName
  format: 'avif' | 'webp' | 'original'
  key: string
  width?: number
  height?: number
  size?: number
}

export interface ImagePipelineInput {
  tenantId?: string
  assetId: string
  mimeType: string
  bytes: Uint8Array
  width?: number
  height?: number
  maxDimension?: number
}

export interface ImagePipeline {
  planVariants(input: ImagePipelineInput): PlannedVariant[]
}

const PRD_VARIANTS: Array<{ variant: VariantName; max: number }> = [
  { variant: 'thumbnail', max: 150 },
  { variant: 'small', max: 480 },
  { variant: 'medium', max: 1024 },
  { variant: 'large', max: 2048 },
]
const DEFAULT_MAX_DIMENSION = 2048

function scaleDimensions(
  width: number | undefined,
  height: number | undefined,
  max: number
): { width?: number; height?: number } {
  if (!width || !height) return {}
  const longestEdge = Math.max(width, height)
  if (longestEdge <= max) {
    return { width, height }
  }
  const scale = max / longestEdge
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

export const imagePipeline: ImagePipeline = {
  planVariants(input) {
    const isImage = input.mimeType.startsWith('image/')
    if (!isImage) {
      return [
        {
          variant: 'original',
          format: 'original',
          key: buildVariantKey(input.tenantId, input.assetId, 'original', 'bin'),
          size: input.bytes.byteLength,
          width: input.width,
          height: input.height,
        },
      ]
    }

    const variants: PlannedVariant[] = [
      {
        variant: 'original',
        format: 'original',
        key: buildVariantKey(input.tenantId, input.assetId, 'original', 'orig'),
        size: input.bytes.byteLength,
        width: input.width,
        height: input.height,
      },
    ]

    const maxDimension = input.maxDimension ?? DEFAULT_MAX_DIMENSION

    for (const variant of PRD_VARIANTS) {
      const variantMax = variant.variant === 'large' ? maxDimension : Math.min(variant.max, maxDimension)
      const dimensions = scaleDimensions(input.width, input.height, variantMax)
      variants.push({
        variant: variant.variant,
        format: 'avif',
        key: buildVariantKey(input.tenantId, input.assetId, variant.variant, 'avif'),
        ...dimensions,
      })
      variants.push({
        variant: variant.variant,
        format: 'webp',
        key: buildVariantKey(input.tenantId, input.assetId, variant.variant, 'webp'),
        ...dimensions,
      })
    }

    return variants
  },
}
