import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { ApiClientError } from './api-error'

// Mock sonner with vi.mock so handle-server-error picks up the mocked toast.
// We use a cache-busted dynamic import for handle-server-error to isolate the
// mock from other test files that also import from 'sonner'.
const toastError = vi.fn()
vi.mock('sonner', () => ({
  toast: { error: toastError },
}))

const { handleServerError } = await import(`./handle-server-error?_t=${Date.now()}`)

describe('handleServerError', () => {
  beforeEach(() => {
    toastError.mockClear()
  })

  it('shows a generic error message for unknown errors', () => {
    handleServerError('something unexpected')
    expect(toastError).toHaveBeenCalledWith('Something went wrong!')
  })

  it('shows a generic error message for null', () => {
    handleServerError(null)
    expect(toastError).toHaveBeenCalledWith('Something went wrong!')
  })

  it('shows a generic error message for undefined', () => {
    handleServerError(undefined)
    expect(toastError).toHaveBeenCalledWith('Something went wrong!')
  })

  it('shows "Content not found." for plain object with status 204', () => {
    handleServerError({ status: 204 })
    expect(toastError).toHaveBeenCalledWith('Content not found.')
  })

  it('shows "Content not found." for ApiClientError with status 204', () => {
    const error = new ApiClientError({ message: 'No content', status: 204 })
    handleServerError(error)
    expect(toastError).toHaveBeenCalledWith('Content not found.')
  })

  it('uses the ApiClientError message for non-204 status', () => {
    const error = new ApiClientError({ message: 'Validation failed', status: 422 })
    handleServerError(error)
    expect(toastError).toHaveBeenCalledWith('Validation failed')
  })

  it('uses the ApiClientError message for 400 status', () => {
    const error = new ApiClientError({ message: 'Bad request', status: 400 })
    handleServerError(error)
    expect(toastError).toHaveBeenCalledWith('Bad request')
  })

  it('uses the ApiClientError message for 500 status', () => {
    const error = new ApiClientError({ message: 'Internal server error', status: 500 })
    handleServerError(error)
    expect(toastError).toHaveBeenCalledWith('Internal server error')
  })

  it('uses the ApiClientError message for 401 unauthorized', () => {
    const error = new ApiClientError({ message: 'Unauthorized', status: 401 })
    handleServerError(error)
    expect(toastError).toHaveBeenCalledWith('Unauthorized')
  })

  it('uses the ApiClientError message for 403 forbidden', () => {
    const error = new ApiClientError({ message: 'Forbidden', status: 403 })
    handleServerError(error)
    expect(toastError).toHaveBeenCalledWith('Forbidden')
  })

  it('uses the ApiClientError message for 404 not found', () => {
    const error = new ApiClientError({ message: 'Not found', status: 404 })
    handleServerError(error)
    expect(toastError).toHaveBeenCalledWith('Not found')
  })

  it('falls back to generic message for ApiClientError with empty message', () => {
    const error = new ApiClientError({ message: '', status: 500 })
    handleServerError(error)
    expect(toastError).toHaveBeenCalledWith('Something went wrong!')
  })

  it('shows generic message for a plain Error', () => {
    handleServerError(new Error('network failure'))
    expect(toastError).toHaveBeenCalledWith('Something went wrong!')
  })

  it('shows generic message for a number', () => {
    handleServerError(42)
    expect(toastError).toHaveBeenCalledWith('Something went wrong!')
  })

  it('shows "Content not found." for object with string status "204"', () => {
    handleServerError({ status: '204' })
    expect(toastError).toHaveBeenCalledWith('Content not found.')
  })

  it('shows generic message for object with non-204 status', () => {
    handleServerError({ status: 500, message: 'ignored' })
    expect(toastError).toHaveBeenCalledWith('Something went wrong!')
  })

  it('calls toast.error exactly once per invocation', () => {
    handleServerError(new ApiClientError({ message: 'test', status: 400 }))
    expect(toastError).toHaveBeenCalledTimes(1)
  })
})

describe('handleServerError limit errors (HS-06/07)', () => {
  beforeEach(() => {
    toastError.mockClear()
  })

  const limitError = (code: string, details: Record<string, unknown>) =>
    new ApiClientError({
      status: code === 'RATE_LIMITED' ? 429 : 402,
      code,
      message: 'Quota exceeded for media_bytes',
      body: { success: false, error: { code, message: 'Quota exceeded for media_bytes', details } },
    })

  it('shows a quota error with an Upgrade action that opens the host link', () => {
    const open = vi.fn()
    const originalOpen = window.open
    window.open = open as unknown as typeof window.open
    handleServerError(
      limitError('QUOTA_EXCEEDED', {
        dimension: 'media_bytes',
        kind: 'quota',
        upgradeUrl: 'https://host.example/upgrade',
      })
    )
    const [title, options] = toastError.mock.calls[0] as [
      string,
      { description: string; action: { label: string; onClick: () => void } },
    ]
    expect(title).toBe('Plan limit reached for media storage')
    expect(options.action.label).toBe('Upgrade')
    options.action.onClick()
    expect(open).toHaveBeenCalledWith('https://host.example/upgrade', '_blank', 'noopener,noreferrer')
    window.open = originalOpen
  })

  it('drops unsafe upgrade links and shows the retry delay for rate limits', () => {
    handleServerError(
      limitError('RATE_LIMITED', {
        dimension: 'public_read',
        kind: 'rate',
        retryAfterSeconds: 12,
        upgradeUrl: 'javascript:alert(1)',
      })
    )
    const [title, options] = toastError.mock.calls[0] as [string, Record<string, unknown>]
    expect(title).toBe('Too many requests (public read)')
    expect(options.description).toBe('Try again in 12s.')
    expect(options.action).toBeUndefined()
  })
})
