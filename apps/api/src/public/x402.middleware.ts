export type X402Options = {
  price?: number
  currency?: string
  ttlSeconds?: number
}

export type L402Challenge = {
  challengeId: string
  resource: string
  price: number
  currency: string
  expiresAt: number
  macaroon: string
  invoice: string
}

export type VerificationResult = {
  valid: boolean
  settled: boolean
  reason?: string
  challengeId?: string
}

const DEFAULT_PRICE = 100 // Default 100 satoshis or cents
const DEFAULT_CURRENCY = 'SATS'
const DEFAULT_TTL_SECONDS = 900 // 15 minutes
const FALLBACK_SECRET = 'edgecms_x402_default_secret_key_32bytes_minimum'

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(str: string): Uint8Array<ArrayBuffer> {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  while (base64.length % 4) {
    base64 += '='
  }
  const binary = atob(base64)
  const buffer = new ArrayBuffer(binary.length)
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

async function getHmacKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder()
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret || FALLBACK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  )
}

async function signString(secret: string, data: string): Promise<string> {
  const key = await getHmacKey(secret)
  const enc = new TextEncoder()
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data))
  return toBase64Url(new Uint8Array(sig))
}

async function verifySignature(secret: string, data: string, signatureB64: string): Promise<boolean> {
  try {
    const key = await getHmacKey(secret)
    const enc = new TextEncoder()
    const sigBytes = fromBase64Url(signatureB64)
    return await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(data))
  } catch {
    return false
  }
}

/**
 * Creates an L402 / x402 challenge for an unauthenticated request to a monetized resource.
 */
export async function createL402Challenge(
  secret: string,
  resource: string,
  options: X402Options = {}
): Promise<L402Challenge> {
  const challengeId = crypto.randomUUID()
  const price = options.price ?? DEFAULT_PRICE
  const currency = options.currency ?? DEFAULT_CURRENCY
  const ttl = options.ttlSeconds ?? DEFAULT_TTL_SECONDS
  const expiresAt = Date.now() + ttl * 1000

  const payload = JSON.stringify({ id: challengeId, res: resource, p: price, c: currency, exp: expiresAt })
  const payloadB64 = toBase64Url(new TextEncoder().encode(payload))
  const sig = await signString(secret, payloadB64)
  const macaroon = `${payloadB64}.${sig}`
  const invoice = `lnbc${price}n1_edgecms_${challengeId.slice(0, 8)}`

  return {
    challengeId,
    resource,
    price,
    currency,
    expiresAt,
    macaroon,
    invoice,
  }
}

/**
 * Creates a valid settlement proof token for a given challenge.
 */
export async function createSettlementToken(
  secret: string,
  challengeId: string,
  resource: string
): Promise<string> {
  const payload = JSON.stringify({
    cid: challengeId,
    res: resource,
    settledAt: Date.now(),
  })
  const payloadB64 = toBase64Url(new TextEncoder().encode(payload))
  const sig = await signString(secret, payloadB64)
  return `${payloadB64}.${sig}`
}

/**
 * Verifies an incoming settlement token from Authorization: L402 <token> or X-402-Token.
 */
export async function verifyL402Token(
  secret: string,
  token: string,
  expectedResource: string,
  kv?: KVNamespace
): Promise<VerificationResult> {
  if (!token) {
    return { valid: false, settled: false, reason: 'missing_token' }
  }

  // Handle "L402 <token>" format if full header string was passed
  const cleanToken = token.startsWith('L402 ') ? token.slice(5).trim() : token.trim()

  // First check if token is stored in KV settlement cache
  if (kv) {
    try {
      const kvSettlement = await kv.get(`x402:settled:${cleanToken}`)
      if (kvSettlement) {
        return { valid: true, settled: true, challengeId: kvSettlement }
      }
    } catch {
      // Fall through to cryptographic verification
    }
  }

  const parts = cleanToken.split('.')
  if (parts.length !== 2) {
    return { valid: false, settled: false, reason: 'malformed_token' }
  }

  const [payloadB64, sig] = parts
  if (!payloadB64 || !sig) {
    return { valid: false, settled: false, reason: 'malformed_token' }
  }

  const isSigValid = await verifySignature(secret, payloadB64, sig)
  if (!isSigValid) {
    return { valid: false, settled: false, reason: 'invalid_signature' }
  }

  try {
    const rawJson = new TextDecoder().decode(fromBase64Url(payloadB64))
    const data = JSON.parse(rawJson)

    // Check expiration if present
    if (data.exp && typeof data.exp === 'number' && Date.now() > data.exp) {
      return { valid: false, settled: false, reason: 'token_expired' }
    }

    // Check resource binding
    if (data.res && expectedResource && data.res !== expectedResource) {
      return { valid: false, settled: false, reason: 'resource_mismatch' }
    }

    return {
      valid: true,
      settled: true,
      challengeId: data.cid || data.id,
    }
  } catch {
    return { valid: false, settled: false, reason: 'payload_parse_error' }
  }
}

/**
 * Minimal request context required for the x402 gate middleware.
 */
export type X402Context = {
  request: Request
  set: {
    status?: number | string
    headers: Record<string, string | number | undefined>
  }
}

/**
 * Determines whether a request targets a monetized collection or resource.
 */
export function isMonetizedRequest(request: Request, collectionSlug?: string): boolean {
  const url = new URL(request.url)

  // Explicit opt-in via header or query parameter
  if (request.headers.get('x-402-require') === 'true') return true
  if (url.searchParams.get('paywall') === 'true' || url.searchParams.get('x402') === 'true') return true

  // Monetized slug patterns (e.g. premium-*, paywalled-*, paid-*)
  if (collectionSlug) {
    if (
      collectionSlug.startsWith('premium-') ||
      collectionSlug.startsWith('paywall-') ||
      collectionSlug.startsWith('paid-')
    ) {
      return true
    }
  }

  return false
}

/**
 * Evaluates x402 micropayments access for an Elysia request context.
 * Returns null if allowed (or settled), or returns a 402 Response object if payment is required.
 */
export async function handleX402Gate(
  ctx: X402Context,
  options: {
    secret: string
    collectionSlug?: string
    price?: number
    currency?: string
    kv?: KVNamespace
  }
): Promise<Response | null> {
  const { request, set } = ctx

  if (!isMonetizedRequest(request, options.collectionSlug)) {
    return null
  }

  // Check for payment token in headers
  const authHeader = request.headers.get('authorization')
  const x402TokenHeader = request.headers.get('x-402-token')

  let incomingToken: string | undefined
  if (authHeader?.startsWith('L402 ')) {
    incomingToken = authHeader.slice(5).trim()
  } else if (x402TokenHeader) {
    incomingToken = x402TokenHeader.trim()
  }

  const url = new URL(request.url)
  const resource = url.pathname

  if (incomingToken) {
    const verification = await verifyL402Token(options.secret, incomingToken, resource, options.kv)
    if (verification.valid && verification.settled) {
      set.headers['X-402-Settled'] = 'true'
      if (verification.challengeId) {
        set.headers['X-402-Receipt'] = verification.challengeId
      }
      return null
    }
  }

  // Payment required: generate challenge and return HTTP 402
  const challenge = await createL402Challenge(options.secret, resource, {
    price: options.price,
    currency: options.currency,
  })

  const authenticateHeader = `L402 token="${challenge.macaroon}", invoice="${challenge.invoice}"`

  return new Response(
    JSON.stringify({
      error: 'Payment Required',
      code: 'PAYMENT_REQUIRED',
      price: challenge.price,
      currency: challenge.currency,
      challenge: challenge.challengeId,
      invoice: challenge.invoice,
      macaroon: challenge.macaroon,
      instructions:
        "Provide valid settlement token in 'Authorization: L402 <token>' or 'X-402-Token' header.",
    }),
    {
      status: 402,
      headers: {
        'Content-Type': 'application/json',
        'WWW-Authenticate': authenticateHeader,
        'X-402-Price': String(challenge.price),
        'X-402-Currency': challenge.currency,
        'X-402-Challenge': challenge.challengeId,
        'Cache-Control': 'no-store',
      },
    }
  )
}
