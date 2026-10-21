export type ApiClientErrorInput = {
  status?: number
  code?: string
  message: string
  body?: unknown
}

export class ApiClientError extends Error {
  public readonly status?: number
  public readonly code?: string
  public readonly body?: unknown

  constructor(input: ApiClientErrorInput) {
    super(input.message)
    this.name = 'ApiClientError'
    this.status = input.status
    this.code = input.code
    this.body = input.body
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function toApiClientError(
  input: unknown,
  fallback: Partial<Omit<ApiClientErrorInput, 'message'>> = {}
): ApiClientError {
  if (input instanceof ApiClientError) {
    return input
  }

  if (input instanceof Error) {
    return new ApiClientError({
      message: input.message,
      ...fallback,
    })
  }

  if (isRecord(input)) {
    const status =
      typeof input.status === 'number'
        ? input.status
        : typeof fallback.status === 'number'
          ? fallback.status
          : undefined

    const code =
      typeof input.code === 'string'
        ? input.code
        : typeof fallback.code === 'string'
          ? fallback.code
          : undefined

    const message =
      typeof input.message === 'string'
        ? input.message
        : typeof input.value === 'string'
          ? input.value
          : 'Request failed'

    return new ApiClientError({
      message,
      status,
      code,
      body: input,
    })
  }

  return new ApiClientError({
    message: 'Request failed',
    ...fallback,
  })
}

export type LimitErrorInfo = {
  kind: 'quota' | 'rate'
  dimension?: string
  /** Absolute http(s) URL from the host; anything else is dropped. */
  upgradeUrl?: string
  retryAfterSeconds?: number
}

function safeHttpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

/** Quota (402 `QUOTA_EXCEEDED`) or rate (429 `RATE_LIMITED`) details from the API (HS-06/07). */
export function getLimitErrorInfo(error: unknown): LimitErrorInfo | undefined {
  if (!(error instanceof ApiClientError)) return undefined
  const kind =
    error.code === 'QUOTA_EXCEEDED' ? 'quota' : error.code === 'RATE_LIMITED' ? 'rate' : undefined
  if (!kind) return undefined
  const body = isRecord(error.body) ? error.body : undefined
  const envelopeError = body && isRecord(body.error) ? body.error : undefined
  const details = envelopeError && isRecord(envelopeError.details) ? envelopeError.details : {}
  const retryAfterSeconds =
    typeof details.retryAfterSeconds === 'number' && details.retryAfterSeconds > 0
      ? details.retryAfterSeconds
      : undefined
  return {
    kind,
    ...(typeof details.dimension === 'string' && { dimension: details.dimension }),
    ...(safeHttpUrl(details.upgradeUrl) && { upgradeUrl: safeHttpUrl(details.upgradeUrl) }),
    ...(retryAfterSeconds && { retryAfterSeconds }),
  }
}
