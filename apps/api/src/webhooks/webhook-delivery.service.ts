export type WebhookDeliveryResult = {
  success: boolean
  status: number
  body: string
}

export type WebhookHeaderMap = Record<string, string>

export type RetryOptions = {
  maxRetries: number
  backoffDelaySeconds?: (attempt: number) => number
  wait?: (seconds: number) => Promise<void>
}

export function calculateBackoffDelay(attempt: number): number {
  return 10 * 3 ** (attempt - 1)
}

/**
 * Calculates decorrelated full jitter delay in seconds for retry backoff:
 * random between [baseDelay / 2, min(maxDelay, baseDelay * 2^(attempt - 1))]
 */
export function calculateJitteredBackoffDelay(
  attempt: number,
  baseSeconds = 10,
  maxSeconds = 300
): number {
  const cap = Math.min(maxSeconds, baseSeconds * 2 ** Math.max(0, attempt - 1))
  const min = Math.max(1, Math.floor(baseSeconds / 2))
  if (cap <= min) return min
  return Math.floor(Math.random() * (cap - min + 1)) + min
}

async function generateHmacHex(message: string, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const keyData = encoder.encode(secret)
  const messageData = encoder.encode(message)

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData)
  const hashArray = Array.from(new Uint8Array(signature))
  return hashArray.map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function generateHmacSignature(payload: unknown, secret: string): Promise<string> {
  const payloadString = JSON.stringify(payload)
  const hashHex = await generateHmacHex(payloadString, secret)
  return `sha256=${hashHex}`
}

export async function signTimestampedPayload(
  secret: string,
  payload: unknown,
  customTimestamp?: number
): Promise<{ headers: WebhookHeaderMap; timestamp: number; signature: string }> {
  const timestamp = customTimestamp ?? Math.floor(Date.now() / 1000)
  const payloadString = JSON.stringify(payload)
  const signature = await generateHmacHex(`${timestamp}.${payloadString}`, secret)
  const v1Header = `t=${timestamp},v1=${signature}`

  return {
    headers: {
      'x-edgecms-signature': `sha256=${await generateHmacHex(payloadString, secret)}`,
      'x-webhook-signature': `sha256=${await generateHmacHex(payloadString, secret)}`,
      'x-edgecms-signature-v1': v1Header,
      'x-edgecms-timestamp': String(timestamp),
    },
    timestamp,
    signature,
  }
}

/**
 * Verifies a timestamped HMAC-SHA256 signature (Stripe/Svix standard):
 * Expected header format: `t=<timestamp>,v1=<signature>`
 * Rejects timestamps deviating by more than toleranceSeconds (default 300s).
 */
export async function verifyWebhookSignature(
  headerValue: string | null | undefined,
  secret: string,
  payload: unknown,
  toleranceSeconds = 300,
  nowSeconds?: number
): Promise<{ valid: boolean; reason?: string }> {
  if (!headerValue || !secret) {
    return { valid: false, reason: 'Missing header value or secret' }
  }

  const parts = headerValue.split(',').reduce<Record<string, string>>((acc, item) => {
    const [k, v] = item.split('=').map((s) => s.trim())
    if (k && v) acc[k] = v
    return acc
  }, {})

  const tStr = parts.t
  const v1 = parts.v1

  if (!tStr || !v1) {
    return { valid: false, reason: 'Invalid signature format (expected t=...,v1=...)' }
  }

  const timestamp = Number.parseInt(tStr, 10)
  if (!Number.isFinite(timestamp)) {
    return { valid: false, reason: 'Invalid timestamp' }
  }

  const current = nowSeconds ?? Math.floor(Date.now() / 1000)
  if (Math.abs(current - timestamp) > toleranceSeconds) {
    return { valid: false, reason: 'Timestamp outside tolerance window' }
  }

  const payloadString = JSON.stringify(payload)
  const expectedSig = await generateHmacHex(`${timestamp}.${payloadString}`, secret)

  if (expectedSig !== v1) {
    return { valid: false, reason: 'Signature mismatch' }
  }

  return { valid: true }
}

export async function signPayload(secret: string, payload: unknown): Promise<WebhookHeaderMap> {
  const signature = await generateHmacSignature(payload, secret)
  return {
    'x-edgecms-signature': signature,
    'x-webhook-signature': signature,
  }
}

async function defaultWait(seconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000))
}

export async function deliverWithRetry(
  deliver: () => Promise<WebhookDeliveryResult>,
  options: RetryOptions
): Promise<WebhookDeliveryResult & { attempts: number }> {
  const maxRetries = Math.max(1, options.maxRetries)
  const backoffDelaySeconds = options.backoffDelaySeconds ?? calculateBackoffDelay
  const wait = options.wait ?? defaultWait

  let lastResult: WebhookDeliveryResult = {
    success: false,
    status: 0,
    body: 'No delivery attempt was executed.',
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    lastResult = await deliver()
    if (lastResult.success) {
      return {
        ...lastResult,
        attempts: attempt,
      }
    }

    if (attempt < maxRetries) {
      await wait(backoffDelaySeconds(attempt))
    }
  }

  return {
    ...lastResult,
    attempts: maxRetries,
  }
}
