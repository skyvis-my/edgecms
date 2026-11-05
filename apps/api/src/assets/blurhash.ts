/**
 * MD-03: blurhash format check. A blurhash is stored in D1 and returned in
 * public asset responses, so only strings that match the blurhash encoding
 * are accepted: base83 characters, and a length that matches the component
 * count encoded in the first character (1..9 x 1..9 components).
 */
const BASE83_ALPHABET =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~'

const MIN_BLURHASH_LENGTH = 6
/** 9 x 9 components: 4 header chars + 2 per component. */
export const MAX_BLURHASH_LENGTH = 4 + 2 * 81

export function isValidBlurhash(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (value.length < MIN_BLURHASH_LENGTH || value.length > MAX_BLURHASH_LENGTH) return false
  for (const char of value) {
    if (!BASE83_ALPHABET.includes(char)) return false
  }
  const sizeFlag = BASE83_ALPHABET.indexOf(value[0] as string)
  const numY = Math.floor(sizeFlag / 9) + 1
  const numX = (sizeFlag % 9) + 1
  if (numY > 9) return false
  return value.length === 4 + 2 * numX * numY
}

/**
 * Returns a trimmed blurhash, `undefined` when none was sent, and throws when
 * a value was sent but is not a valid blurhash.
 */
export function normalizeBlurhash(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new Error('Invalid blurhash: expected a string')
  const trimmed = value.trim()
  if (trimmed.length === 0) return undefined
  if (!isValidBlurhash(trimmed)) throw new Error('Invalid blurhash: not a valid blurhash string')
  return trimmed
}
