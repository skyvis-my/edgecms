import { createErrorEnvelope } from '@/shared/utils/service-response'

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
const DEFAULT_SETTLEMENT_TTL_SECONDS = 3600
const MAX_SETTLEMENT_TTL_SECONDS = 86400

/**
 * Prefix of every x402 HMAC input, so x402 signatures can never be confused
 * with other HMACs, and a type field separates challenges from settlements:
 * a challenge macaroon echoed back is not a payment proof.
 */
const SIGNING_PREFIX = 'edgecms.x402.v1.'
const CHALLENGE_TYPE = 'x402.challenge'
const SETTLEMENT_TYPE = 'x402.settlement'

const x402Encoder = new TextEncoder()
const x402Decoder = new TextDecoder()
const x402HmacKeyCache = new Map<string, Promise<CryptoKey>>()

/**
 * DL-07 signing secret: `X402_SECRET` only. There is no built-in default and
 * no fallback to auth or API-key secrets; paid routes fail closed without it.
 */
export function resolveX402Secret(env: { X402_SECRET?: string } | undefined): string | undefined {
  const secret = env?.X402_SECRET
  return secret && secret.trim().length > 0 ? secret : undefined
}

function assertX402Secret(secret: string | undefined): asserts secret is string {
  if (!secret || secret.trim().length === 0) {
    const err = new Error('x402 secret is not configured') as Error & { status: number }
    err.status = 500
    throw err
  }
}

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
  assertX402Secret(secret)
  let cached = x402HmacKeyCache.get(secret)
  if (!cached) {
    cached = crypto.subtle.importKey(
      'raw',
      x402Encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify']
    )
    x402HmacKeyCache.set(secret, cached)
  }
  return cached
}

async function signString(secret: string, data: string): Promise<string> {
  const key = await getHmacKey(secret)
  const sig = await crypto.subtle.sign('HMAC', key, x402Encoder.encode(SIGNING_PREFIX + data))
  return toBase64Url(new Uint8Array(sig))
}

async function verifySignature(secret: string, data: string, signatureB64: string): Promise<boolean> {
  try {
    const key = await getHmacKey(secret)
    const sigBytes = fromBase64Url(signatureB64)
    // crypto.subtle.verify compares in constant time.
    return await crypto.subtle.verify('HMAC', key, sigBytes, x402Encoder.encode(SIGNING_PREFIX + data))
  } catch {
    return false
  }
}

/**
 * Creates an L402 / x402 challenge for an unauthenticated request to a monetized resource.
 * The macaroon is signed metadata only; it is never accepted as a payment proof.
 */
export async function createL402Challenge(
  secret: string,
  resource: string,
  options: X402Options & { tenantId?: string } = {}
): Promise<L402Challenge> {
  assertX402Secret(secret)
  const challengeId = crypto.randomUUID()
  const price = options.price ?? DEFAULT_PRICE
  const currency = options.currency ?? DEFAULT_CURRENCY
  const ttl = options.ttlSeconds ?? DEFAULT_TTL_SECONDS
  const expiresAt = Date.now() + ttl * 1000

  const payload = JSON.stringify({
    typ: CHALLENGE_TYPE,
    id: challengeId,
    res: resource,
    tid: options.tenantId ?? '',
    p: price,
    c: currency,
    exp: expiresAt,
  })
  const payloadB64 = toBase64Url(x402Encoder.encode(payload))
  const sig = await signString(secret, payloadB64)
  const macaroon = `${payloadB64}.${sig}`
  // Placeholder, not a real Lightning invoice: no payment network is wired in.
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

export type SettlementTokenInput = {
  challengeId: string
  resource: string
  tenantId?: string
  price: number
  currency: string
  ttlSeconds?: number
}

/**
 * Mints a settlement proof bound to challenge, resource, tenant, amount and
 * an expiry. EdgeCMS does not call this itself: there is no payment-network
 * verifier, so a host's payment service must mint tokens after it confirms
 * payment, using the same `X402_SECRET`.
 */
export async function createSettlementToken(
  secret: string,
  input: SettlementTokenInput
): Promise<string> {
  assertX402Secret(secret)
  const ttl = Math.min(
    Math.max(1, Math.floor(input.ttlSeconds ?? DEFAULT_SETTLEMENT_TTL_SECONDS)),
    MAX_SETTLEMENT_TTL_SECONDS
  )
  const now = Date.now()
  const payload = JSON.stringify({
    typ: SETTLEMENT_TYPE,
    cid: input.challengeId,
    res: input.resource,
    tid: input.tenantId ?? '',
    p: input.price,
    c: input.currency,
    iat: now,
    exp: now + ttl * 1000,
  })
  const payloadB64 = toBase64Url(x402Encoder.encode(payload))
  const sig = await signString(secret, payloadB64)
  return `${payloadB64}.${sig}`
}

export type SettlementExpectation = {
  resource: string
  tenantId?: string
  price: number
  currency: string
}

/**
 * Verifies an incoming settlement token from Authorization: L402 <token> or X-402-Token.
 * Every binding is required: type, resource, tenant, price, currency and expiry.
 */
export async function verifyL402Token(
  secret: string,
  token: string,
  expected: SettlementExpectation
): Promise<VerificationResult> {
  assertX402Secret(secret)
  if (!token) {
    return { valid: false, settled: false, reason: 'missing_token' }
  }

  // Handle "L402 <token>" format if full header string was passed
  const cleanToken = token.startsWith('L402 ') ? token.slice(5).trim() : token.trim()

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

  let data: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(x402Decoder.decode(fromBase64Url(payloadB64)))
    if (!parsed || typeof parsed !== 'object') {
      return { valid: false, settled: false, reason: 'payload_parse_error' }
    }
    data = parsed as Record<string, unknown>
  } catch {
    return { valid: false, settled: false, reason: 'payload_parse_error' }
  }

  if (data.typ !== SETTLEMENT_TYPE) {
    return { valid: false, settled: false, reason: 'not_a_settlement' }
  }
  if (typeof data.exp !== 'number' || Date.now() > data.exp) {
    return { valid: false, settled: false, reason: 'token_expired' }
  }
  if (data.res !== expected.resource) {
    return { valid: false, settled: false, reason: 'resource_mismatch' }
  }
  if (data.tid !== (expected.tenantId ?? '')) {
    return { valid: false, settled: false, reason: 'tenant_mismatch' }
  }
  if (data.p !== expected.price || data.c !== expected.currency) {
    return { valid: false, settled: false, reason: 'amount_mismatch' }
  }
  if (typeof data.cid !== 'string' || data.cid.length === 0) {
    return { valid: false, settled: false, reason: 'malformed_token' }
  }

  return { valid: true, settled: true, challengeId: data.cid }
}

/**
 * Minimal request context required for the x402 gate middleware.
 */
export type X402Context = {
  request: Request
  set: {
    status?: number | string
    headers: Record<string, string | number | string[] | undefined>
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
 * Returns null if allowed (or settled), or a Response: 402 when payment is
 * required, 500 CONFIG_ERROR when the request is monetized but `X402_SECRET`
 * is not set (fail closed: paid content is never served unchecked).
 */
export async function handleX402Gate(
  ctx: X402Context,
  options: {
    secret: string | undefined
    collectionSlug?: string
    tenantId?: string
    price?: number
    currency?: string
  }
): Promise<Response | null> {
  const { request, set } = ctx

  if (!isMonetizedRequest(request, options.collectionSlug)) {
    return null
  }

  const secret = options.secret
  if (!secret || secret.trim().length === 0) {
    return new Response(
      JSON.stringify(
        createErrorEnvelope('CONFIG_ERROR', 'Paid reads are not configured (set X402_SECRET)')
      ),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'private, no-store',
          'CDN-Cache-Control': 'no-store',
        },
      }
    )
  }

  const price = options.price ?? DEFAULT_PRICE
  const currency = options.currency ?? DEFAULT_CURRENCY

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
    const verification = await verifyL402Token(secret, incomingToken, {
      resource,
      tenantId: options.tenantId,
      price,
      currency,
    })
    if (verification.valid && verification.settled) {
      set.headers['X-402-Settled'] = 'true'
      if (verification.challengeId) {
        set.headers['X-402-Receipt'] = verification.challengeId
      }
      return null
    }
  }

  // Payment required: generate challenge and return HTTP 402
  const challenge = await createL402Challenge(secret, resource, {
    price,
    currency,
    tenantId: options.tenantId,
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

/** DL-07: a settled paid read must never be kept by a browser, CDN or edge cache. */
export function isSettledPaidRead(headers: Record<string, unknown>): boolean {
  return headers['X-402-Settled'] === 'true'
}
