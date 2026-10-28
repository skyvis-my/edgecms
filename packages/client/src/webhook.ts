import type { VerifyWebhookOptions } from './types'

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}

/**
 * Verifies an incoming EdgeCMS webhook signature.
 * Supports both standard HMAC ("sha256=<hex>") and timestamped signatures ("t=<timestamp>,v1=<hex>").
 *
 * Uses the Web Crypto API, making it fully portable across Edge workers, Node.js 18+, Bun, and browsers.
 */
export async function verifyWebhookSignature(options: VerifyWebhookOptions): Promise<boolean> {
  const { payload, signatureHeader, secret, toleranceSeconds = 300 } = options
  if (!signatureHeader || !secret) return false

  const encoder = new TextEncoder()
  const payloadBytes = typeof payload === 'string' ? encoder.encode(payload) : payload

  // Check if timestamped scheme: t=1234567890,v1=abcdef...
  if (signatureHeader.includes('t=') && signatureHeader.includes('v1=')) {
    const parts = signatureHeader.split(',').reduce<Record<string, string>>((acc, pair) => {
      const [k, v] = pair.split('=')
      if (k && v) acc[k.trim()] = v.trim()
      return acc
    }, {})

    const timestampStr = parts['t']
    const signatureHex = parts['v1']
    if (!timestampStr || !signatureHex) return false

    const timestamp = parseInt(timestampStr, 10)
    if (isNaN(timestamp)) return false

    // Check tolerance window if specified
    const now = Math.floor(Date.now() / 1000)
    if (toleranceSeconds > 0 && Math.abs(now - timestamp) > toleranceSeconds) {
      return false
    }

    const payloadText = typeof payload === 'string' ? payload : new TextDecoder().decode(payload)
    const signedPayload = `${timestamp}.${payloadText}`
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    const expectedSigBuf = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload))
    const expectedHex = Array.from(new Uint8Array(expectedSigBuf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

    return timingSafeEqual(expectedHex, signatureHex)
  }

  // Standard HMAC scheme: sha256=abcdef... or raw hex
  const cleanHex = signatureHeader.startsWith('sha256=')
    ? signatureHeader.slice('sha256='.length)
    : signatureHeader

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const expectedSigBuf = await crypto.subtle.sign('HMAC', key, payloadBytes as any as BufferSource)
  const expectedHex = Array.from(new Uint8Array(expectedSigBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  return timingSafeEqual(expectedHex, cleanHex)
}
