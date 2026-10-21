/**
 * Test helpers that drive a real better-auth handler over HTTP-shaped
 * requests, keeping cookies between calls like a browser would.
 */

export const TEST_ORIGIN = 'http://localhost:8787'

type AuthHandler = { handler: (request: Request) => Promise<Response> }

export class CookieJar {
  private readonly cookies = new Map<string, string>()

  store(response: Response): void {
    for (const header of response.headers.getSetCookie()) {
      const [pair, ...attributes] = header.split(';')
      const index = pair!.indexOf('=')
      const name = pair!.slice(0, index).trim()
      const value = pair!.slice(index + 1).trim()
      const expired = attributes.some((attr) => /^\s*max-age=0\s*$/i.test(attr))
      if (expired || value === '') this.cookies.delete(name)
      else this.cookies.set(name, value)
    }
  }

  header(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ')
  }

  has(fragment: string): boolean {
    return [...this.cookies.keys()].some((name) => name.includes(fragment))
  }

  clear(): void {
    this.cookies.clear()
  }
}

export async function callAuth(
  auth: AuthHandler,
  path: string,
  options: { body?: unknown; jar?: CookieJar; method?: string; headers?: Record<string, string> } = {}
): Promise<{ status: number; json: any; response: Response }> {
  const headers: Record<string, string> = { origin: TEST_ORIGIN, ...options.headers }
  if (options.body !== undefined) headers['content-type'] = 'application/json'
  const cookie = options.jar?.header()
  if (cookie) headers.cookie = cookie
  const response = await auth.handler(
    new Request(`${TEST_ORIGIN}/api/auth${path}`, {
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
  )
  options.jar?.store(response)
  const text = await response.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = text
  }
  return { status: response.status, json, response }
}

function base32Decode(input: string): Uint8Array<ArrayBuffer> {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const clean = input.replace(/=+$/, '').toUpperCase()
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const char of clean) {
    value = (value << 5) | alphabet.indexOf(char)
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return new Uint8Array(out)
}

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s) for the secret in an otpauth URI. */
export async function totpFromUri(totpURI: string, at = Date.now()): Promise<string> {
  const secret = new URL(totpURI).searchParams.get('secret')
  if (!secret) throw new Error('totpURI has no secret')
  const key = await crypto.subtle.importKey(
    'raw',
    base32Decode(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  )
  const counter = Math.floor(at / 1000 / 30)
  const message = new ArrayBuffer(8)
  new DataView(message).setBigUint64(0, BigInt(counter))
  const hmac = new Uint8Array(await crypto.subtle.sign('HMAC', key, message))
  const offset = hmac[hmac.length - 1]! & 0xf
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    (hmac[offset + 1]! << 16) |
    (hmac[offset + 2]! << 8) |
    hmac[offset + 3]!
  return String(binary % 1_000_000).padStart(6, '0')
}
