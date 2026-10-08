import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { optimizeImageForUpload } from './media-optimizer'

const ORIGINAL_FILE_READER = globalThis.FileReader
const ORIGINAL_IMAGE = globalThis.Image
const ORIGINAL_DOCUMENT = globalThis.document

let imageWidth = 4000
let imageHeight = 2000
let avifSupported = true

class MockFileReader {
  result: string | ArrayBuffer | null = null
  error: DOMException | null = null
  onload: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null
  onerror: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null

  readAsDataURL(file: Blob) {
    const mimeType = (file as File).type || 'application/octet-stream'
    this.result = `data:${mimeType};base64,${btoa('reader')}`
    queueMicrotask(() => {
      this.onload?.call(this as unknown as FileReader, {} as ProgressEvent<FileReader>)
    })
  }
}

class MockImage {
  onload: (() => void) | null = null
  onerror: ((error?: unknown) => void) | null = null
  width = imageWidth
  height = imageHeight

  set src(_value: string) {
    queueMicrotask(() => {
      this.onload?.()
    })
  }
}

function createMockCanvas(): HTMLCanvasElement {
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn().mockReturnValue({
      drawImage: vi.fn(),
    }),
    toDataURL: vi.fn((format: string, quality?: number) => {
      if (format === 'image/avif' && !avifSupported) {
        return `data:image/png;base64,${btoa('png-fallback')}`
      }
      return `data:${format};base64,${btoa(`${format}:${quality ?? ''}`)}`
    }),
  }
  return canvas as unknown as HTMLCanvasElement
}

describe('media-optimizer', () => {
  let createElementSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    avifSupported = true
    imageWidth = 4000
    imageHeight = 2000

    globalThis.FileReader = MockFileReader as unknown as typeof FileReader
    globalThis.Image = MockImage as unknown as typeof Image
    globalThis.document = {
      createElement: vi.fn(() => {
        throw new Error('Unexpected document.createElement call')
      }),
    } as unknown as Document

    const originalCreateElement = document.createElement.bind(document)
    createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      if (tagName === 'canvas') {
        return createMockCanvas()
      }
      return originalCreateElement(tagName)
    })
  })

  afterEach(() => {
    createElementSpy.mockRestore()
    globalThis.FileReader = ORIGINAL_FILE_READER
    globalThis.Image = ORIGINAL_IMAGE
    globalThis.document = ORIGINAL_DOCUMENT
  })

  it('produces PRD variant set with webp and optional avif formats', async () => {
    const file = new File(['binary-image'], 'hero-banner.jpg', { type: 'image/jpeg' })
    const optimized = await optimizeImageForUpload({
      file,
      folderPath: 'marketing/home',
      quality: 0.8,
      maxDimension: 2048,
    })

    const webpVariants = optimized.variants.filter((variant) => variant.format === 'webp')
    const avifVariants = optimized.variants.filter((variant) => variant.format === 'avif')

    expect(webpVariants.map((variant) => variant.variant)).toEqual([
      'thumbnail',
      'small',
      'medium',
      'large',
    ])
    expect(avifVariants.map((variant) => variant.variant)).toEqual([
      'thumbnail',
      'small',
      'medium',
      'large',
    ])
    expect(webpVariants.find((variant) => variant.variant === 'thumbnail')).toEqual(
      expect.objectContaining({ width: 150, height: 75 })
    )
    expect(webpVariants.find((variant) => variant.variant === 'large')).toEqual(
      expect.objectContaining({ width: 2048, height: 1024 })
    )
  })

  it('caps oversized original images before upload', async () => {
    const file = new File(['binary-image'], 'hero-banner.jpg', { type: 'image/jpeg' })

    const optimized = await optimizeImageForUpload({
      file,
      folderPath: 'marketing/home',
      quality: 0.8,
      maxDimension: 2048,
    })

    expect(optimized.filename).toBe('marketing/home/hero-banner.webp')
    expect(optimized.mimeType).toBe('image/webp')
    expect(optimized.width).toBe(2048)
    expect(optimized.height).toBe(1024)
    expect(optimized.contentBase64).toBe(btoa('image/webp:0.8'))
  })

  it('uses configured image dimension cap for originals and large variants', async () => {
    const file = new File(['binary-image'], 'hero-banner.jpg', { type: 'image/jpeg' })

    const optimized = await optimizeImageForUpload({
      file,
      folderPath: 'marketing/home',
      quality: 0.8,
      maxDimension: 1200,
    })

    expect(optimized.width).toBe(1200)
    expect(optimized.height).toBe(600)
    expect(optimized.variants.find((variant) => variant.variant === 'large')).toEqual(
      expect.objectContaining({ width: 1200, height: 600 })
    )
  })

  it('preserves original payload when image is already within caps', async () => {
    imageWidth = 800
    imageHeight = 600
    const file = new File(['small-image'], 'logo.png', { type: 'image/png' })

    const optimized = await optimizeImageForUpload({
      file,
      folderPath: '',
      quality: 0.8,
      maxDimension: 2048,
    })

    expect(optimized.filename).toBe('logo.png')
    expect(optimized.mimeType).toBe('image/png')
    expect(optimized.width).toBe(800)
    expect(optimized.height).toBe(600)
    expect(optimized.contentBase64).toBe(btoa('small-image'))
  })

  it('passes common non-image files through without image variants', async () => {
    const file = new File(['%PDF-1.7'], 'menu.pdf', { type: 'application/pdf' })

    const optimized = await optimizeImageForUpload({
      file,
      folderPath: 'docs',
      quality: 0.8,
      maxDimension: 2048,
    })

    expect(optimized.filename).toBe('docs/menu.pdf')
    expect(optimized.mimeType).toBe('application/pdf')
    expect(optimized.contentBase64).toBe(btoa('%PDF-1.7'))
    expect(optimized.variants).toEqual([])
    expect(createElementSpy).not.toHaveBeenCalledWith('canvas')
  })

  it('resizes using long edge bounds so portrait images are not oversized', async () => {
    imageWidth = 2000
    imageHeight = 4000
    avifSupported = false

    const file = new File(['binary-image'], 'portrait.jpg', { type: 'image/jpeg' })
    const optimized = await optimizeImageForUpload({
      file,
      folderPath: '',
      quality: 0.8,
      maxDimension: 2048,
    })

    const webpVariants = optimized.variants.filter((variant) => variant.format === 'webp')
    expect(webpVariants.find((variant) => variant.variant === 'thumbnail')).toEqual(
      expect.objectContaining({ width: 75, height: 150 })
    )
    expect(webpVariants.find((variant) => variant.variant === 'large')).toEqual(
      expect.objectContaining({ width: 1024, height: 2048 })
    )
    expect(optimized.variants.some((variant) => variant.format === 'avif')).toBe(false)
  })
})
