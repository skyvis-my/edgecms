/**
 * MD-03: dependency-free blurhash encoder (the published blurhash algorithm,
 * https://github.com/woltapp/blurhash). The admin uploader runs it on the
 * smallest variant's canvas pixels so every image upload sends a blurhash.
 */
const BASE83 =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~'

function encode83(value: number, length: number): string {
  let result = ''
  for (let i = 1; i <= length; i++) {
    const digit = Math.floor(value / 83 ** (length - i)) % 83
    result += BASE83[digit]
  }
  return result
}

function sRGBToLinear(value: number): number {
  const v = value / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

function linearToSRGB(value: number): number {
  const v = Math.max(0, Math.min(1, value))
  return v <= 0.0031308
    ? Math.trunc(v * 12.92 * 255 + 0.5)
    : Math.trunc((1.055 * v ** (1 / 2.4) - 0.055) * 255 + 0.5)
}

function signPow(value: number, exp: number): number {
  return Math.sign(value) * Math.abs(value) ** exp
}

export function pickBlurhashComponents(
  width: number,
  height: number
): { componentX: number; componentY: number } {
  return width >= height ? { componentX: 4, componentY: 3 } : { componentX: 3, componentY: 4 }
}

export function encodeBlurhash(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  componentX: number,
  componentY: number
): string {
  if (
    !Number.isInteger(componentX) ||
    !Number.isInteger(componentY) ||
    componentX < 1 ||
    componentX > 9 ||
    componentY < 1 ||
    componentY > 9
  ) {
    throw new Error('Blurhash components must be integers from 1 to 9')
  }
  if (width < 1 || height < 1 || pixels.length !== width * height * 4) {
    throw new Error('Blurhash pixel buffer does not match width and height')
  }

  // Linearise once; the basis loop below reads each pixel componentX*componentY times.
  const linear = new Float64Array(width * height * 3)
  for (let p = 0, q = 0; p < pixels.length; p += 4, q += 3) {
    linear[q] = sRGBToLinear(pixels[p] as number)
    linear[q + 1] = sRGBToLinear(pixels[p + 1] as number)
    linear[q + 2] = sRGBToLinear(pixels[p + 2] as number)
  }

  const factors: Array<[number, number, number]> = []
  const scale = 1 / (width * height)
  for (let y = 0; y < componentY; y++) {
    for (let x = 0; x < componentX; x++) {
      const normalisation = x === 0 && y === 0 ? 1 : 2
      let r = 0
      let g = 0
      let b = 0
      for (let j = 0; j < height; j++) {
        const basisY = Math.cos((Math.PI * y * j) / height)
        for (let i = 0; i < width; i++) {
          const basis = normalisation * Math.cos((Math.PI * x * i) / width) * basisY
          const q = (j * width + i) * 3
          r += basis * (linear[q] as number)
          g += basis * (linear[q + 1] as number)
          b += basis * (linear[q + 2] as number)
        }
      }
      factors.push([r * scale, g * scale, b * scale])
    }
  }

  const [dc, ...ac] = factors as [[number, number, number], ...Array<[number, number, number]>]
  let hash = encode83(componentX - 1 + (componentY - 1) * 9, 1)

  let maximumValue = 1
  if (ac.length > 0) {
    const actualMax = Math.max(...ac.flatMap((f) => f.map(Math.abs)))
    const quantisedMax = Math.max(0, Math.min(82, Math.floor(actualMax * 166 - 0.5)))
    maximumValue = (quantisedMax + 1) / 166
    hash += encode83(quantisedMax, 1)
  } else {
    hash += encode83(0, 1)
  }

  hash += encode83(
    (linearToSRGB(dc[0]) << 16) + (linearToSRGB(dc[1]) << 8) + linearToSRGB(dc[2]),
    4
  )

  for (const [r, g, b] of ac) {
    const quant = (v: number) =>
      Math.max(0, Math.min(18, Math.floor(signPow(v / maximumValue, 0.5) * 9 + 9.5)))
    hash += encode83(quant(r) * 19 * 19 + quant(g) * 19 + quant(b), 2)
  }

  return hash
}
