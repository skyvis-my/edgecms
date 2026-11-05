import { describe, expect, it } from 'bun:test'
import { encodeBlurhash, pickBlurhashComponents } from './blurhash'

const BASE83 =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~'

function solid(width: number, height: number, [r, g, b]: [number, number, number]) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r
    data[i + 1] = g
    data[i + 2] = b
    data[i + 3] = 255
  }
  return data
}

/** Same rule the API enforces (apps/api/src/assets/blurhash.ts). */
function isWellFormed(hash: string) {
  if (![...hash].every((c) => BASE83.includes(c))) return false
  const flag = BASE83.indexOf(hash[0] as string)
  return hash.length === 4 + 2 * ((flag % 9) + 1) * (Math.floor(flag / 9) + 1)
}

function decode83(str: string) {
  let value = 0
  for (const c of str) value = value * 83 + BASE83.indexOf(c)
  return value
}

/** Reference blurhash decode of one pixel, used to check the encoder round-trips. */
function decodePixel(hash: string, width: number, height: number, px: number, py: number) {
  const flag = decode83(hash[0] as string)
  const numX = (flag % 9) + 1
  const numY = Math.floor(flag / 9) + 1
  const maxValue = (decode83(hash[1] as string) + 1) / 166
  const toLinear = (v: number) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const dc = decode83(hash.slice(2, 6))
  const colors: number[][] = [[toLinear(dc >> 16), toLinear((dc >> 8) & 255), toLinear(dc & 255)]]
  const signSq = (v: number) => Math.sign(v) * v * v
  for (let i = 1; i < numX * numY; i++) {
    const v = decode83(hash.slice(4 + i * 2, 6 + i * 2))
    colors.push([
      signSq((Math.floor(v / 361) - 9) / 9) * maxValue,
      signSq((Math.floor(v / 19) % 19 - 9) / 9) * maxValue,
      signSq((v % 19 - 9) / 9) * maxValue,
    ])
  }
  const out = [0, 0, 0]
  for (let j = 0; j < numY; j++) {
    for (let i = 0; i < numX; i++) {
      const basis = Math.cos((Math.PI * px * i) / width) * Math.cos((Math.PI * py * j) / height)
      const color = colors[i + j * numX] as number[]
      for (let k = 0; k < 3; k++) out[k] = (out[k] as number) + (color[k] as number) * basis
    }
  }
  return out.map((v) => Math.round(Math.max(0, Math.min(1, v)) ** (1 / 2.2) * 255))
}

describe('MD-03 admin blurhash encoder', () => {
  it('encodes the average colour as the DC term', () => {
    // 1x1 components is exact: size flag 0, max 0, DC = pure red.
    expect(encodeBlurhash(solid(4, 4, [255, 0, 0]), 4, 4, 1, 1)).toBe('00TI:j')
    const hash = encodeBlurhash(solid(8, 4, [255, 0, 0]), 8, 4, 4, 3)
    expect(hash).toHaveLength(28)
    expect(hash.slice(0, 1)).toBe('L')
    expect(hash.slice(2, 6)).toBe('TI:j')
    expect(isWellFormed(hash)).toBe(true)
  })

  it('round-trips: decoding the hash recovers the image structure', () => {
    const width = 32
    const height = 16
    const data = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4
        data[i] = x < width / 2 ? 230 : 20
        data[i + 1] = 40
        data[i + 2] = x < width / 2 ? 20 : 230
        data[i + 3] = 255
      }
    }
    const hash = encodeBlurhash(data, width, height, 4, 3)
    const left = decodePixel(hash, width, height, 4, 8)
    const right = decodePixel(hash, width, height, 28, 8)
    expect(left[0] as number).toBeGreaterThan(left[2] as number)
    expect(right[2] as number).toBeGreaterThan(right[0] as number)
  })

  it('produces a well-formed hash for a gradient', () => {
    const width = 32
    const height = 16
    const data = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4
        data[i] = Math.round((x / width) * 255)
        data[i + 1] = Math.round((y / height) * 255)
        data[i + 2] = 128
        data[i + 3] = 255
      }
    }
    const hash = encodeBlurhash(data, width, height, 4, 3)
    expect(hash).toHaveLength(28)
    expect(isWellFormed(hash)).toBe(true)
    // A gradient has real AC energy, unlike the flat case.
    expect(hash.slice(6)).not.toBe('fQ'.repeat(11))
  })

  it('rejects bad component counts and mismatched pixel buffers', () => {
    expect(() => encodeBlurhash(solid(2, 2, [0, 0, 0]), 2, 2, 0, 3)).toThrow()
    expect(() => encodeBlurhash(solid(2, 2, [0, 0, 0]), 2, 2, 10, 3)).toThrow()
    expect(() => encodeBlurhash(solid(2, 2, [0, 0, 0]), 3, 3, 4, 3)).toThrow()
  })

  it('picks more components along the long edge', () => {
    expect(pickBlurhashComponents(150, 75)).toEqual({ componentX: 4, componentY: 3 })
    expect(pickBlurhashComponents(75, 150)).toEqual({ componentX: 3, componentY: 4 })
  })
})
