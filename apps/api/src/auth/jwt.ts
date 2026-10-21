type JwtPayload = {
  sub?: string
  iss?: string
  aud?: string | string[]
  exp?: number
  nbf?: number
  iat?: number
  [key: string]: unknown
}

type JwtHeader = {
  alg?: string
  typ?: string
  [key: string]: unknown
}

export type JwtValidationConfig = {
  secret?: string
  issuer?: string
  audience?: string
  required?: boolean
}

export type AccessTokenClaims = {
  sub: string
  role?: string
  tid?: string
  tsl?: string
  trl?: string
  rv?: number
  pv?: number
  email?: string
  sa?: number
  /** 1 when the session behind this token completed a second factor (HS-11). */
  mfa?: number
  iss?: string
  aud?: string | string[]
  exp?: number
  iat?: number
}

export type CreateAccessTokenInput = {
  sub: string
  role?: string
  tid?: string
  tsl?: string
  trl?: string
  rv?: number
  pv?: number
  email?: string
  sa?: boolean
  mfa?: boolean
}

export type CreateAccessTokenOptions = {
  issuer?: string
  audience?: string
  ttlSeconds?: number
  issuedAtSeconds?: number
}

/** Default lifetime for RBAC access tokens (10 minutes). Bounds staleness. */
export const ACCESS_TOKEN_DEFAULT_TTL_SECONDS = 600

const MAX_CLAIM_STRING_LENGTH = 128

const utf8Encoder = new TextEncoder()
const utf8Decoder = new TextDecoder()

const hmacKeyCache = new Map<string, Promise<CryptoKey>>()

function getCachedHmacKey(secret: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  const cacheKey = `${usage}:${secret}`
  let cached = hmacKeyCache.get(cacheKey)
  if (!cached) {
    cached = crypto.subtle.importKey(
      'raw',
      utf8Encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      [usage]
    )
    hmacKeyCache.set(cacheKey, cached)
  }
  return cached
}

export function __resetHmacKeyCacheForTests(): void {
  hmacKeyCache.clear()
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i] as number)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlEncodeJson(value: unknown): string {
  return base64UrlEncodeBytes(utf8Encoder.encode(JSON.stringify(value)))
}

async function signHs256Signature(signingInput: string, secret: string): Promise<string> {
  const key = await getCachedHmacKey(secret, 'sign')
  const signature = await crypto.subtle.sign('HMAC', key, utf8Encoder.encode(signingInput))
  return base64UrlEncodeBytes(new Uint8Array(signature))
}

/**
 * Mint a short-lived stateless RBAC access token.
 *
 * Encodes global role + single-tenant membership so the hot path can
 * authorize without D1 reads. Covers one tenant per token to bound size.
 */
export async function createAccessToken(
  input: CreateAccessTokenInput,
  secret: string,
  options: CreateAccessTokenOptions = {}
): Promise<string> {
  if (!input.sub) throw new Error('createAccessToken requires sub')
  if (!secret) throw new Error('createAccessToken requires secret')
  const ttl = options.ttlSeconds ?? ACCESS_TOKEN_DEFAULT_TTL_SECONDS
  const iat = options.issuedAtSeconds ?? Math.floor(Date.now() / 1000)
  const payload: Record<string, unknown> = {
    sub: input.sub,
    iat,
    exp: iat + ttl,
  }
  if (options.issuer) payload.iss = options.issuer
  if (options.audience) payload.aud = options.audience
  if (input.role) payload.role = input.role
  if (input.tid) payload.tid = input.tid
  if (input.tsl) payload.tsl = input.tsl
  if (input.trl) payload.trl = input.trl
  if (typeof input.rv === 'number') payload.rv = input.rv
  if (typeof input.pv === 'number') payload.pv = input.pv
  if (input.email) payload.email = input.email
  if (input.sa) payload.sa = 1
  if (input.mfa) payload.mfa = 1

  const headerPart = base64UrlEncodeJson({ alg: 'HS256', typ: 'JWT' })
  const payloadPart = base64UrlEncodeJson(payload)
  const signaturePart = await signHs256Signature(`${headerPart}.${payloadPart}`, secret)
  return `${headerPart}.${payloadPart}.${signaturePart}`
}

function asClaimString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > MAX_CLAIM_STRING_LENGTH) return undefined
  return trimmed
}

function asRevision(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return undefined
  return value
}

/**
 * Extract typed RBAC claims from an already signature-verified JWT payload.
 * Returns undefined when the payload is not a usable access token.
 */
export function parseAccessClaims(payload: JwtPayload | unknown): AccessTokenClaims | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const record = payload as Record<string, unknown>
  const sub = asClaimString(record.sub)
  if (!sub) return undefined
  const claims: AccessTokenClaims = { sub }
  const role = asClaimString(record.role)
  if (role) claims.role = role
  const tid = asClaimString(record.tid)
  if (tid) claims.tid = tid
  const tsl = asClaimString(record.tsl)
  if (tsl) claims.tsl = tsl
  const trl = asClaimString(record.trl)
  if (trl) claims.trl = trl
  const rv = asRevision(record.rv)
  if (rv !== undefined) claims.rv = rv
  const pv = asRevision(record.pv)
  if (pv !== undefined) claims.pv = pv
  const email = asClaimString(record.email)
  if (email) claims.email = email
  if (record.sa === 1 || record.sa === true) claims.sa = 1
  if (record.mfa === 1 || record.mfa === true) claims.mfa = 1
  if (typeof record.iat === 'number') claims.iat = record.iat
  if (typeof record.exp === 'number') claims.exp = record.exp
  if (typeof record.iss === 'string') claims.iss = record.iss
  if (typeof record.aud === 'string' || Array.isArray(record.aud)) {
    claims.aud = record.aud as string | string[]
  }
  return claims
}

export type JwtValidationResult =
  | { valid: true; payload?: JwtPayload }
  | {
      valid: false
      code: 'JWT_REQUIRED' | 'JWT_INVALID'
      message: string
    }

function base64UrlToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4))
  const binary = atob(`${normalized}${padding}`)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function decodeJson<T>(value: string): T | null {
  try {
    const bytes = base64UrlToUint8Array(value)
    const text = utf8Decoder.decode(bytes)
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

function parseBearerToken(request: Request): string | null {
  const authorization = request.headers.get('authorization')
  if (!authorization) return null
  const [scheme, token] = authorization.trim().split(/\s+/, 2)
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return null
  return token
}

function payloadAudienceMatches(payload: JwtPayload, expectedAudience: string): boolean {
  if (typeof payload.aud === 'string') return payload.aud === expectedAudience
  if (Array.isArray(payload.aud)) return payload.aud.includes(expectedAudience)
  return false
}

async function verifyHs256Signature(
  signingInput: string,
  signaturePart: string,
  secret: string
): Promise<boolean> {
  const key = await getCachedHmacKey(secret, 'verify')

  return crypto.subtle.verify(
    'HMAC',
    key,
    base64UrlToUint8Array(signaturePart),
    new Uint8Array(utf8Encoder.encode(signingInput))
  )
}

function validateRegisteredClaims(payload: JwtPayload, config: JwtValidationConfig): string | null {
  const nowSeconds = Math.floor(Date.now() / 1000)

  if (typeof payload.exp === 'number' && nowSeconds >= payload.exp) {
    return 'JWT has expired'
  }
  if (typeof payload.nbf === 'number' && nowSeconds < payload.nbf) {
    return 'JWT is not active yet'
  }
  if (config.issuer && payload.iss !== config.issuer) {
    return 'JWT issuer mismatch'
  }
  if (config.audience && !payloadAudienceMatches(payload, config.audience)) {
    return 'JWT audience mismatch'
  }
  return null
}

export async function validateRequestJwt(
  request: Request,
  config: JwtValidationConfig
): Promise<JwtValidationResult> {
  const token = parseBearerToken(request)
  if (!token) {
    if (config.required) {
      return {
        valid: false,
        code: 'JWT_REQUIRED',
        message: 'Missing bearer token',
      }
    }
    return { valid: true }
  }

  if (!config.secret) {
    return {
      valid: false,
      code: 'JWT_INVALID',
      message: 'JWT secret is not configured',
    }
  }

  const parts = token.split('.')
  if (parts.length !== 3) {
    return {
      valid: false,
      code: 'JWT_INVALID',
      message: 'Malformed JWT',
    }
  }

  const [headerPart, payloadPart, signaturePart] = parts
  if (!headerPart || !payloadPart || !signaturePart) {
    return {
      valid: false,
      code: 'JWT_INVALID',
      message: 'Malformed JWT',
    }
  }

  const header = decodeJson<JwtHeader>(headerPart)
  const payload = decodeJson<JwtPayload>(payloadPart)

  if (!header || !payload) {
    return {
      valid: false,
      code: 'JWT_INVALID',
      message: 'Malformed JWT payload',
    }
  }

  if (header.alg !== 'HS256') {
    return {
      valid: false,
      code: 'JWT_INVALID',
      message: 'Unsupported JWT algorithm',
    }
  }

  const verified = await verifyHs256Signature(`${headerPart}.${payloadPart}`, signaturePart, config.secret)
  if (!verified) {
    return {
      valid: false,
      code: 'JWT_INVALID',
      message: 'Invalid JWT signature',
    }
  }

  const claimError = validateRegisteredClaims(payload, config)
  if (claimError) {
    return {
      valid: false,
      code: 'JWT_INVALID',
      message: claimError,
    }
  }

  return {
    valid: true,
    payload,
  }
}
