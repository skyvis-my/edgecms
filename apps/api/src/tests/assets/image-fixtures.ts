/** Minimal image headers for MD-05 dimension tests (header bytes only). */

function bytes(...parts: Array<number[] | string | Uint8Array>): Uint8Array {
  const out: number[] = []
  for (const part of parts) {
    if (typeof part === 'string') for (const ch of part) out.push(ch.charCodeAt(0))
    else out.push(...part)
  }
  return new Uint8Array(out)
}
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
const be16 = (n: number) => [(n >>> 8) & 0xff, n & 0xff]
const le16 = (n: number) => [n & 0xff, (n >>> 8) & 0xff]
const le24 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff]
const le32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]

export function pngHeader(width: number, height: number): Uint8Array {
  return bytes(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    be32(13),
    'IHDR',
    be32(width),
    be32(height),
    [8, 6, 0, 0, 0],
    be32(0)
  )
}

export function gifHeader(width: number, height: number): Uint8Array {
  return bytes('GIF89a', le16(width), le16(height), [0, 0, 0])
}

/** JPEG with an APP0 segment before the SOF so the parser must walk segments. */
export function jpegHeader(width: number, height: number, sofMarker = 0xc0): Uint8Array {
  const app0 = [0xff, 0xe0, ...be16(16), ...Array.from('JFIF\0').map((c) => c.charCodeAt(0)), 1, 1, 0, 0, 1, 0, 1, 0, 0]
  const sof = [0xff, sofMarker, ...be16(11), 8, ...be16(height), ...be16(width), 1, 1, 0x11, 0]
  return bytes([0xff, 0xd8], app0, sof, [0xff, 0xd9])
}

function riff(chunk: string, payload: number[]): Uint8Array {
  return bytes('RIFF', le32(4 + 8 + payload.length), 'WEBP', chunk, le32(payload.length), payload)
}

export function webpVp8xHeader(width: number, height: number): Uint8Array {
  return riff('VP8X', [0, 0, 0, 0, ...le24(width - 1), ...le24(height - 1)])
}

export function webpVp8Header(width: number, height: number): Uint8Array {
  return riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(width), ...le16(height), 0, 0])
}

export function webpVp8lHeader(width: number, height: number): Uint8Array {
  const w = width - 1
  const h = height - 1
  const bits = w | (h << 14)
  return riff('VP8L', [0x2f, bits & 0xff, (bits >>> 8) & 0xff, (bits >>> 16) & 0xff, (bits >>> 24) & 0x0f, 0, 0, 0])
}

function box(type: string, ...payload: number[][]): number[] {
  const body = payload.flat()
  return [...be32(8 + body.length), ...Array.from(type).map((c) => c.charCodeAt(0)), ...body]
}

export function avifHeader(width: number, height: number, thumb?: { width: number; height: number }): Uint8Array {
  const ftyp = box('ftyp', Array.from('avif').map((c) => c.charCodeAt(0)), be32(0), Array.from('mif1miaf').map((c) => c.charCodeAt(0)))
  const ispe = (w: number, h: number) => box('ispe', [0, 0, 0, 0], be32(w), be32(h))
  const ipco = box('ipco', ...(thumb ? [ispe(thumb.width, thumb.height)] : []), ispe(width, height))
  const iprp = box('iprp', ipco)
  const hdlr = box('hdlr', [0, 0, 0, 0], be32(0), Array.from('pict').map((c) => c.charCodeAt(0)), be32(0), be32(0), be32(0), [0])
  const meta = box('meta', [0, 0, 0, 0], hdlr, iprp)
  return bytes(ftyp, meta)
}

export function bmpHeader(width: number, height: number): Uint8Array {
  return bytes('BM', le32(54), le32(0), le32(54), le32(40), le32(width), le32(-height), le16(1), le16(24), Array.from({ length: 24 }, () => 0))
}

export function toBase64(input: Uint8Array): string {
  return Buffer.from(input).toString('base64')
}
