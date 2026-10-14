const encoder = new TextEncoder()
const decoder = new TextDecoder()

const previewHmacKeyCache = new Map<string, Promise<CryptoKey>>()

function getPreviewHmacKey(secret: string): Promise<CryptoKey> {
  let cached = previewHmacKeyCache.get(secret)
  if (!cached) {
    cached = crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    previewHmacKeyCache.set(secret, cached)
  }
  return cached
}

export type PreviewTokenPayload = {
  tenantSlug: string
  entrySlug?: string
  entryId?: string
  collectionSlug?: string
  previewUrl?: string
  iat: number // Unix epoch seconds
  exp: number // Unix epoch seconds
}

export type GeneratePreviewTokenOptions = {
  tenantSlug: string
  entrySlug?: string
  entryId?: string
  collectionSlug?: string
  previewUrl?: string
  ttlSeconds?: number
  secret: string
}

export type PreviewTokenResponse = {
  token: string
  tenantSlug: string
  entrySlug?: string
  entryId?: string
  collectionSlug?: string
  previewUrl?: string
  expiresAt: string
  exp: number
}

export type VerifyPreviewTokenResult =
  | { valid: true; payload: PreviewTokenPayload }
  | { valid: false; error: string; payload?: undefined }

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlDecode(str: string): Uint8Array {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  while (base64.length % 4 !== 0) {
    base64 += '='
  }
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = encoder.encode(a)
  const bBytes = encoder.encode(b)
  if (aBytes.byteLength !== bBytes.byteLength) return false
  let mismatch = 0
  for (let i = 0; i < aBytes.byteLength; i++) {
    mismatch |= aBytes[i]! ^ bBytes[i]!
  }
  return mismatch === 0
}

async function hmacSha256(secret: string, data: string): Promise<string> {
  const key = await getPreviewHmacKey(secret)
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data))
  return base64UrlEncode(new Uint8Array(signature))
}

/**
 * Generates an HMAC-signed ephemeral preview token.
 */
export async function generatePreviewToken(
  options: GeneratePreviewTokenOptions
): Promise<PreviewTokenResponse> {
  const now = Math.floor(Date.now() / 1000)
  const ttl = Math.min(Math.max(options.ttlSeconds ?? 3600, 60), 86400 * 7)
  const exp = now + ttl

  const payload: PreviewTokenPayload = {
    tenantSlug: options.tenantSlug,
    entrySlug: options.entrySlug,
    entryId: options.entryId,
    collectionSlug: options.collectionSlug,
    previewUrl: options.previewUrl,
    iat: now,
    exp,
  }

  const payloadJson = JSON.stringify(payload)
  const payloadEncoded = base64UrlEncode(encoder.encode(payloadJson))
  const signature = await hmacSha256(options.secret, payloadEncoded)
  const token = `${payloadEncoded}.${signature}`

  return {
    token,
    tenantSlug: options.tenantSlug,
    entrySlug: options.entrySlug,
    entryId: options.entryId,
    collectionSlug: options.collectionSlug,
    previewUrl: options.previewUrl,
    expiresAt: new Date(exp * 1000).toISOString(),
    exp,
  }
}

/**
 * Verifies an HMAC-signed ephemeral preview token.
 */
export async function verifyPreviewToken(
  token: string,
  secret: string,
  options?: { expectedTenantSlug?: string; nowSeconds?: number }
): Promise<VerifyPreviewTokenResult> {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'Missing or invalid token format' }
  }

  const parts = token.split('.')
  if (parts.length !== 2) {
    return { valid: false, error: 'Malformed token format: expected header.signature' }
  }

  const [payloadEncoded, signature] = parts
  if (!payloadEncoded || !signature) {
    return { valid: false, error: 'Malformed token components' }
  }

  // Verify HMAC signature
  const expectedSignature = await hmacSha256(secret, payloadEncoded)
  if (!timingSafeEqual(signature, expectedSignature)) {
    return { valid: false, error: 'Invalid token signature' }
  }

  // Parse payload
  let payload: PreviewTokenPayload
  try {
    const jsonStr = decoder.decode(base64UrlDecode(payloadEncoded))
    payload = JSON.parse(jsonStr) as PreviewTokenPayload
  } catch {
    return { valid: false, error: 'Failed to decode token payload' }
  }

  // Verify expiration
  const currentNow = options?.nowSeconds ?? Math.floor(Date.now() / 1000)
  if (payload.exp < currentNow) {
    return { valid: false, error: 'Preview token has expired' }
  }

  // Verify tenant if specified
  if (options?.expectedTenantSlug && payload.tenantSlug !== options.expectedTenantSlug) {
    return { valid: false, error: `Token tenant '${payload.tenantSlug}' does not match expected '${options.expectedTenantSlug}'` }
  }

  return { valid: true, payload }
}
