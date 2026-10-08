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
