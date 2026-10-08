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

export type JwtValidationResult =
  | { valid: true; payload?: JwtPayload }
  | {
      valid: false
      code: 'JWT_REQUIRED' | 'JWT_INVALID'
      message: string
    }

function base64UrlToUint8Array(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4))
  const binary = atob(`${normalized}${padding}`)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function decodeJson<T>(value: string): T | null {
  try {
    const bytes = base64UrlToUint8Array(value)
    const text = new TextDecoder().decode(bytes)
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
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  )

  return crypto.subtle.verify(
    'HMAC',
    key,
    toArrayBuffer(base64UrlToUint8Array(signaturePart)),
    new TextEncoder().encode(signingInput)
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
