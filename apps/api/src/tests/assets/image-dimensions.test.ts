import { describe, expect, it } from 'bun:test'
import {
  assertImageWithinDimension,
  ImageDimensionsExceededError,
  InvalidImageError,
  readImageDimensions,
} from '../../assets/image-dimensions'
import {
  avifHeader,
  bmpHeader,
  gifHeader,
  jpegHeader,
  pngHeader,
  webpVp8Header,
  webpVp8lHeader,
  webpVp8xHeader,
} from './image-fixtures'

describe('MD-05 readImageDimensions (header parsing, no decode)', () => {
  const cases: Array<[string, Uint8Array, string, number, number]> = [
    ['PNG', pngHeader(4000, 300), 'png', 4000, 300],
    ['GIF', gifHeader(320, 2400), 'gif', 320, 2400],
    ['JPEG baseline', jpegHeader(3000, 2000), 'jpeg', 3000, 2000],
    ['JPEG progressive', jpegHeader(1200, 4096, 0xc2), 'jpeg', 1200, 4096],
    ['WebP VP8X', webpVp8xHeader(5000, 100), 'webp', 5000, 100],
    ['WebP VP8 lossy', webpVp8Header(2049, 10), 'webp', 2049, 10],
    ['WebP VP8L lossless', webpVp8lHeader(16383, 9000), 'webp', 16383, 9000],
    ['AVIF', avifHeader(8192, 4320), 'avif', 8192, 4320],
    ['BMP', bmpHeader(2500, 1000), 'bmp', 2500, 1000],
  ]

  for (const [name, input, format, width, height] of cases) {
    it(`reads ${name} dimensions`, () => {
      expect(readImageDimensions(input)).toEqual({ kind: 'ok', format, width, height } as never)
    })
  }

  it('uses the largest AVIF ispe so a small thumbnail property cannot hide the primary size', () => {
    const result = readImageDimensions(avifHeader(6000, 4000, { width: 160, height: 120 }))
    expect(result).toMatchObject({ kind: 'ok', width: 6000, height: 4000 })
  })

  it('returns unknown for non-image bytes', () => {
    expect(readImageDimensions(new TextEncoder().encode('%PDF-1.7'))).toEqual({ kind: 'unknown' })
    expect(readImageDimensions(new Uint8Array(0))).toEqual({ kind: 'unknown' })
  })

  it('returns invalid for truncated headers of a known format', () => {
    expect(readImageDimensions(pngHeader(10, 10).slice(0, 18))).toEqual({ kind: 'invalid', format: 'png' })
    expect(readImageDimensions(jpegHeader(10, 10).slice(0, 12))).toEqual({ kind: 'invalid', format: 'jpeg' })
    expect(readImageDimensions(new TextEncoder().encode('RIFFxxxxWEBP'))).toEqual({ kind: 'invalid', format: 'webp' })
  })
})

describe('MD-05 assertImageWithinDimension', () => {
  it('passes at exactly the limit and returns server-read dimensions', () => {
    expect(assertImageWithinDimension(pngHeader(2048, 1024), 2048)).toEqual({ width: 2048, height: 1024 })
  })

  it('rejects when the longest edge is over the limit (either axis)', () => {
    expect(() => assertImageWithinDimension(pngHeader(2049, 10), 2048)).toThrow(ImageDimensionsExceededError)
    expect(() => assertImageWithinDimension(jpegHeader(10, 3000), 2048)).toThrow(ImageDimensionsExceededError)
  })

  it('rejects a corrupt header of a sniffed format as an invalid image', () => {
    expect(() => assertImageWithinDimension(pngHeader(10, 10).slice(0, 18), 2048)).toThrow(InvalidImageError)
  })

  it('returns null for bytes it cannot sniff (non-images)', () => {
    expect(assertImageWithinDimension(new TextEncoder().encode('%PDF-1.7'), 2048)).toBeNull()
  })
})
