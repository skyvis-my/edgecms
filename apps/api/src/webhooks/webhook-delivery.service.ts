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

async function generateHmacSignature(payload: unknown, secret: string): Promise<string> {
  const payloadString = JSON.stringify(payload)
  const encoder = new TextEncoder()
  const keyData = encoder.encode(secret)
  const messageData = encoder.encode(payloadString)

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData)
  const hashArray = Array.from(new Uint8Array(signature))
  const hashHex = hashArray.map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `sha256=${hashHex}`
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
