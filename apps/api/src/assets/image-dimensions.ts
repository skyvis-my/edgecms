/**
 * MD-05: read image dimensions from the first bytes of an upload.
 *
 * Header parsing only: no decode, no Node-only APIs, so it runs on workerd.
 * The format is sniffed from the bytes (magic numbers), never from the
 * client-sent MIME type, filename or width/height fields.
 */

export type SniffedImageFormat = 'png' | 'jpeg' | 'gif' | 'webp' | 'avif' | 'bmp'

export type ImageDimensionsResult =
  /** Bytes are not one of the formats this module can read. */
  | { kind: 'unknown' }
  /** Bytes start like a known format but the header is truncated or corrupt. */
  | { kind: 'invalid'; format: SniffedImageFormat }
  | { kind: 'ok'; format: SniffedImageFormat; width: number; height: number }

function u16be(b: Uint8Array, o: number) {
  return (b[o]! << 8) | b[o + 1]!
}
function u16le(b: Uint8Array, o: number) {
  return b[o]! | (b[o + 1]! << 8)
}
function u24le(b: Uint8Array, o: number) {
  return b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16)
}
function u32be(b: Uint8Array, o: number) {
  return ((b[o]! << 24) >>> 0) + ((b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!)
}
function i32le(b: Uint8Array, o: number) {
  return b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)
}
function ascii(b: Uint8Array, o: number, len: number) {
  if (o + len > b.length) return ''
  let s = ''
  for (let i = 0; i < len; i++) s += String.fromCharCode(b[o + i]!)
  return s
}

function ok(format: SniffedImageFormat, width: number, height: number): ImageDimensionsResult {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { kind: 'invalid', format }
  }
  return { kind: 'ok', format, width, height }
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function readPng(b: Uint8Array): ImageDimensionsResult {
  // Signature (8) + IHDR length (4) + "IHDR" (4) + width (4) + height (4).
  if (b.length < 24 || ascii(b, 12, 4) !== 'IHDR') return { kind: 'invalid', format: 'png' }
  return ok('png', u32be(b, 16), u32be(b, 20))
}

function readGif(b: Uint8Array): ImageDimensionsResult {
  if (b.length < 10) return { kind: 'invalid', format: 'gif' }
  return ok('gif', u16le(b, 6), u16le(b, 8))
}

function readBmp(b: Uint8Array): ImageDimensionsResult {
  if (b.length < 26) return { kind: 'invalid', format: 'bmp' }
  const headerSize = b[14]! | (b[15]! << 8) | (b[16]! << 16) | (b[17]! << 24)
  if (headerSize === 12) {
    // OS/2 BITMAPCOREHEADER: 16-bit width/height.
    return ok('bmp', u16le(b, 18), u16le(b, 20))
  }
  return ok('bmp', Math.abs(i32le(b, 18)), Math.abs(i32le(b, 22)))
}

function isJpegSofMarker(marker: number) {
  return (
    marker >= 0xc0 &&
    marker <= 0xcf &&
    marker !== 0xc4 && // DHT
    marker !== 0xc8 && // JPG extension
    marker !== 0xcc // DAC
  )
}

function readJpeg(b: Uint8Array): ImageDimensionsResult {
  let o = 2
  while (o < b.length) {
    if (b[o] !== 0xff) return { kind: 'invalid', format: 'jpeg' }
    // Skip fill bytes.
    while (o < b.length && b[o] === 0xff) o++
    if (o >= b.length) break
    const marker = b[o]!
    o++
    // Standalone markers carry no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue
    if (marker === 0xd9 || marker === 0xda) break // EOI / SOS before any SOF
    if (o + 2 > b.length) break
    const segmentLength = u16be(b, o)
    if (segmentLength < 2) return { kind: 'invalid', format: 'jpeg' }
    if (isJpegSofMarker(marker)) {
      // length (2) + precision (1) + height (2) + width (2)
      if (o + 7 > b.length) break
      return ok('jpeg', u16be(b, o + 5), u16be(b, o + 3))
    }
    o += segmentLength
  }
  return { kind: 'invalid', format: 'jpeg' }
}

function readWebp(b: Uint8Array): ImageDimensionsResult {
  const chunk = ascii(b, 12, 4)
  if (chunk === 'VP8X') {
    if (b.length < 30) return { kind: 'invalid', format: 'webp' }
    return ok('webp', u24le(b, 24) + 1, u24le(b, 27) + 1)
  }
  if (chunk === 'VP8 ') {
    // Frame tag (3) then start code 9d 01 2a, then 14-bit width/height.
    if (b.length < 30 || b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) {
      return { kind: 'invalid', format: 'webp' }
    }
    return ok('webp', u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff)
  }
  if (chunk === 'VP8L') {
    if (b.length < 25 || b[20] !== 0x2f) return { kind: 'invalid', format: 'webp' }
    const b0 = b[21]!
    const b1 = b[22]!
    const b2 = b[23]!
    const b3 = b[24]!
    const width = 1 + (b0 | ((b1 & 0x3f) << 8))
    const height = 1 + ((b1 >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10))
    return ok('webp', width, height)
  }
  return { kind: 'invalid', format: 'webp' }
}

const BMFF_IMAGE_BRANDS = new Set(['avif', 'avis', 'heic', 'heix', 'heim', 'heis', 'mif1', 'msf1'])

type BmffBox = { type: string; start: number; end: number; header: number }

function* bmffBoxes(b: Uint8Array, start: number, end: number): Generator<BmffBox> {
  let o = start
  while (o + 8 <= end) {
    let size = u32be(b, o)
    const type = ascii(b, o + 4, 4)
    let header = 8
    if (size === 1) {
      if (o + 16 > end) return
      // 64-bit size: refuse anything that does not fit in 32 bits.
      if (u32be(b, o + 8) !== 0) return
      size = u32be(b, o + 12)
      header = 16
    } else if (size === 0) {
      size = end - o
    }
    if (size < header || o + size > end) {
      // Truncated box: yield what we have so callers can search inside it.
      yield { type, start: o, end, header }
      return
    }
    yield { type, start: o, end: o + size, header }
    o += size
  }
}

function findBox(b: Uint8Array, start: number, end: number, type: string) {
  for (const box of bmffBoxes(b, start, end)) {
    if (box.type === type) return box
  }
  return undefined
}

function readBmff(b: Uint8Array): ImageDimensionsResult {
  // The largest `ispe` (image spatial extent) wins: for grids it is the
  // canvas, and thumbnails or tiles are never larger than the primary image.
  const meta = findBox(b, 0, b.length, 'meta')
  if (!meta) return { kind: 'invalid', format: 'avif' }
  // `meta` is a full box: 4 bytes of version/flags after the header.
  const iprp = findBox(b, meta.start + meta.header + 4, meta.end, 'iprp')
  if (!iprp) return { kind: 'invalid', format: 'avif' }
  const ipco = findBox(b, iprp.start + iprp.header, iprp.end, 'ipco')
  if (!ipco) return { kind: 'invalid', format: 'avif' }
  let width = 0
  let height = 0
  for (const box of bmffBoxes(b, ipco.start + ipco.header, ipco.end)) {
    if (box.type !== 'ispe') continue
    const o = box.start + box.header + 4
    if (o + 8 > box.end) continue
    width = Math.max(width, u32be(b, o))
    height = Math.max(height, u32be(b, o + 4))
  }
  if (width === 0 || height === 0) return { kind: 'invalid', format: 'avif' }
  return ok('avif', width, height)
}

function isBmffImage(b: Uint8Array): boolean {
  if (b.length < 16 || ascii(b, 4, 4) !== 'ftyp') return false
  const ftypSize = u32be(b, 0)
  const end = Math.min(b.length, ftypSize >= 16 ? ftypSize : 16)
  if (BMFF_IMAGE_BRANDS.has(ascii(b, 8, 4))) return true
  for (let o = 16; o + 4 <= end; o += 4) {
    if (BMFF_IMAGE_BRANDS.has(ascii(b, o, 4))) return true
  }
  return false
}

export function readImageDimensions(bytes: Uint8Array): ImageDimensionsResult {
  const b = bytes
  if (b.length >= 8 && PNG_SIGNATURE.every((v, i) => b[i] === v)) return readPng(b)
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return readJpeg(b)
  const head6 = ascii(b, 0, 6)
  if (head6 === 'GIF87a' || head6 === 'GIF89a') return readGif(b)
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return readWebp(b)
  if (isBmffImage(b)) return readBmff(b)
  if (ascii(b, 0, 2) === 'BM' && b.length >= 14) return readBmp(b)
  return { kind: 'unknown' }
}

export const IMAGE_DIMENSIONS_EXCEEDED_PREFIX = 'Asset image dimensions exceed'

export class ImageDimensionsExceededError extends Error {
  readonly code = 'IMAGE_DIMENSIONS_EXCEEDED'
  constructor(
    readonly width: number,
    readonly height: number,
    readonly maxDimension: number
  ) {
    super(
      `${IMAGE_DIMENSIONS_EXCEEDED_PREFIX} the maximum of ${maxDimension} px (got ${width}x${height})`
    )
    this.name = 'ImageDimensionsExceededError'
  }
}

export class InvalidImageError extends Error {
  readonly code = 'IMAGE_PROCESSING_FAILED'
  constructor(format: string) {
    // "invalid image" keeps the controller's existing 422 classification.
    super(`Invalid image: could not read ${format} dimensions from the uploaded bytes`)
    this.name = 'InvalidImageError'
  }
}

/**
 * Enforce the tenant's longest-edge limit on uploaded bytes.
 * The format comes from the bytes, so a PNG labelled `image/bmp` or
 * `application/pdf` is still checked. Returns the server-read dimensions, or
 * `null` when the bytes are not a format this module reads.
 */
export function assertImageWithinDimension(
  bytes: Uint8Array,
  maxDimension: number
): { width: number; height: number } | null {
  const result = readImageDimensions(bytes)
  if (result.kind === 'invalid') throw new InvalidImageError(result.format)
  if (result.kind === 'unknown') return null
  if (Number.isFinite(maxDimension) && maxDimension > 0 && Math.max(result.width, result.height) > maxDimension) {
    throw new ImageDimensionsExceededError(result.width, result.height, maxDimension)
  }
  return { width: result.width, height: result.height }
}
