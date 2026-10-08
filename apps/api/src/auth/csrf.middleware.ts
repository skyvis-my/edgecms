const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const CSRF_COOKIE_NAME = 'csrf_token'
const CSRF_TOKEN_TTL_SECONDS = 24 * 60 * 60
const encoder = new TextEncoder()

export type CsrfCookieOptions = {
  secure: boolean
  nowSeconds?: number
}

export function requiresCsrf(pathname: string, method: string): boolean {
  if (SAFE_METHODS.has(method)) return false
  return pathname.startsWith('/api/admin/') || pathname.includes('/admin/')
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

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function hmacSha256(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value))
  return base64UrlEncode(new Uint8Array(signature))
}

function createNonce(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return base64UrlEncode(bytes)
}

function extractCsrfCookie(request: Request): string | undefined {
  const cookieHeader = request.headers.get('cookie')
  if (!cookieHeader) return undefined

  return cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${CSRF_COOKIE_NAME}=`))
    ?.slice(CSRF_COOKIE_NAME.length + 1)
    ?.trim()
}

export async function createSignedCsrfToken(
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  nonce = createNonce()
): Promise<string> {
  const unsigned = `v1.${nowSeconds}.${nonce}`
  const signature = await hmacSha256(secret, unsigned)
  return `${unsigned}.${signature}`
}

async function isSignedCsrfTokenValid(
  token: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000)
): Promise<boolean> {
  const parts = token.split('.')
  if (parts.length !== 4) return false
  const [version, issuedAtRaw, nonce, signature] = parts
  if (version !== 'v1' || !issuedAtRaw || !nonce || !signature) return false

  const issuedAt = Number.parseInt(issuedAtRaw, 10)
  if (!Number.isFinite(issuedAt)) return false
  if (issuedAt > nowSeconds + 60) return false
  if (nowSeconds - issuedAt > CSRF_TOKEN_TTL_SECONDS) return false

  const expectedSignature = await hmacSha256(secret, `v1.${issuedAt}.${nonce}`)
  return timingSafeEqual(expectedSignature, signature)
}

export async function validateCsrfToken(
  request: Request,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000)
): Promise<boolean> {
  const headerToken = request.headers.get('x-csrf-token')?.trim()
  if (!headerToken) return false

  const cookieToken = extractCsrfCookie(request)
  if (!cookieToken) return false
  if (!timingSafeEqual(cookieToken, headerToken)) return false

  return isSignedCsrfTokenValid(cookieToken, secret, nowSeconds)
}

export function formatCsrfCookieHeader(token: string, options: Pick<CsrfCookieOptions, 'secure'>): string {
  return [
    `${CSRF_COOKIE_NAME}=${token}`,
    'Path=/',
    `Max-Age=${CSRF_TOKEN_TTL_SECONDS}`,
    'SameSite=Lax',
    options.secure ? 'Secure' : undefined,
  ]
    .filter(Boolean)
    .join('; ')
}

export async function buildCsrfCookieHeader(
  secret: string,
  options: CsrfCookieOptions
): Promise<string> {
  const token = await createSignedCsrfToken(secret, options.nowSeconds)
  return formatCsrfCookieHeader(token, options)
}
