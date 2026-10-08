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
