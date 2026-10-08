import type { UploadAssetInput } from './api'
import { resolveFileMimeType } from './file-policy'
import { buildAssetFilename } from './media-utils'

const VARIANTS = [
  { variant: 'thumbnail', maxDimension: 150 },
  { variant: 'small', maxDimension: 480 },
  { variant: 'medium', maxDimension: 1024 },
  { variant: 'large', maxDimension: 2048 },
] as const

const AVIF_QUALITY = 0.5
const DEFAULT_UPLOAD_MAX_BYTES = 5 * 1024 * 1024
const MIN_CAPPED_WEBP_QUALITY = 0.35

async function readImage(file: File): Promise<HTMLImageElement> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(file)
  })

  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onerror = () => reject(new Error(`Invalid image: ${file.name}`))
    image.onload = () => resolve(image)
    image.src = dataUrl
  })
}

function canvasToBase64(
  canvas: HTMLCanvasElement,
  format: 'webp' | 'avif',
  quality: number
): string | null {
  const mimeType = `image/${format}`
  const dataUrl = canvas.toDataURL(mimeType, quality)
  if (!dataUrl.startsWith(`data:${mimeType};`)) {
    return null
  }
  return dataUrl.split(',')[1] ?? null
}

function estimateBase64Bytes(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return Math.floor((base64.length * 3) / 4) - padding
}

function replaceExtension(filename: string, extension: string): string {
  const normalizedExtension = extension.startsWith('.') ? extension : `.${extension}`
  const lastSlash = filename.lastIndexOf('/')
  const slashPrefix = lastSlash >= 0 ? filename.slice(0, lastSlash + 1) : ''
  const basename = lastSlash >= 0 ? filename.slice(lastSlash + 1) : filename
  const extensionIndex = basename.lastIndexOf('.')
  const stem = extensionIndex > 0 ? basename.slice(0, extensionIndex) : basename
  return `${slashPrefix}${stem || 'upload'}${normalizedExtension}`
}

function canvasToCappedWebpBase64(
  canvas: HTMLCanvasElement,
  quality: number,
  maxUploadBytes: number
): string {
  let nextQuality = quality

  while (nextQuality >= MIN_CAPPED_WEBP_QUALITY) {
    const base64 = canvasToBase64(canvas, 'webp', nextQuality)
    if (base64 && estimateBase64Bytes(base64) <= maxUploadBytes) {
      return base64
    }
    nextQuality -= 0.1
  }

  throw new Error('Image remains above upload size cap after optimization')
}

function resizeToCanvas(
  image: HTMLImageElement,
  targetMaxDimension: number,
  maxDimension: number
): { canvas: HTMLCanvasElement; width: number; height: number } {
  const longestEdge = Math.max(image.width, image.height)
  const boundedMaxDimension = Math.min(targetMaxDimension, maxDimension, longestEdge)
  const scale = boundedMaxDimension / longestEdge
  const width = Math.max(1, Math.round(image.width * scale))
  const height = Math.max(1, Math.round(image.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Canvas 2D context unavailable')
  }
  ctx.drawImage(image, 0, 0, width, height)
  return { canvas, width, height }
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export async function optimizeImageForUpload(args: {
  file: File
  folderPath: string
  quality: number
  maxDimension: number
  maxUploadBytes?: number
}): Promise<UploadAssetInput> {
  const {
    file,
    folderPath,
    quality,
    maxDimension,
    maxUploadBytes = DEFAULT_UPLOAD_MAX_BYTES,
  } = args
  const mimeType = resolveFileMimeType(file) || 'application/octet-stream'
  if (!mimeType.startsWith('image/')) {
    return {
      filename: buildAssetFilename(folderPath, file.name),
      mimeType,
      contentBase64: await fileToBase64(file),
      variants: [],
    }
  }

  const image = await readImage(file)
  const originalFilename = buildAssetFilename(folderPath, file.name)
  const longestEdge = Math.max(image.width, image.height)
  const cappedOriginal =
    longestEdge > maxDimension || file.size > maxUploadBytes
      ? resizeToCanvas(image, maxDimension, maxDimension)
      : null
  const originalBase64 = cappedOriginal
    ? canvasToCappedWebpBase64(cappedOriginal.canvas, quality, maxUploadBytes)
    : await fileToBase64(file)
  const filename = cappedOriginal ? replaceExtension(originalFilename, 'webp') : originalFilename
  const uploadMimeType = cappedOriginal ? 'image/webp' : mimeType

  const variants: NonNullable<UploadAssetInput['variants']> = []

  for (const variantDef of VARIANTS) {
    const { canvas, width, height } = resizeToCanvas(image, variantDef.maxDimension, maxDimension)
    const webpBase64 = canvasToBase64(canvas, 'webp', quality)
    if (!webpBase64) {
      throw new Error('WebP encoder unavailable in this browser')
    }

    variants.push({
      variant: variantDef.variant,
      format: 'webp',
      width,
      height,
      contentBase64: webpBase64,
    })

    const avifBase64 = canvasToBase64(canvas, 'avif', AVIF_QUALITY)
    if (avifBase64) {
      variants.push({
        variant: variantDef.variant,
        format: 'avif',
        width,
        height,
        contentBase64: avifBase64,
      })
    }
  }

  return {
    filename,
    mimeType: uploadMimeType,
    contentBase64: originalBase64,
    width: cappedOriginal?.width ?? image.width,
    height: cappedOriginal?.height ?? image.height,
    variants,
  }
}
