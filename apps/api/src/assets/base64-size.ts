/** Decoded byte length of a base64 string, without decoding it. */
export function estimateDecodedSize(base64: string): number {
  const normalized = base64.trim()
  if (normalized.length === 0) return 0
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0
  return Math.floor((normalized.length * 3) / 4) - padding
}
