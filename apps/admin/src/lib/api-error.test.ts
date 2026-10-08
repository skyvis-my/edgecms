import { describe, expect, it } from 'bun:test'
import { ApiClientError, toApiClientError } from './api-error'

describe('api-error', () => {
  it('returns input when already ApiClientError', () => {
    const error = new ApiClientError({ message: 'boom', status: 400, code: 'BAD' })
    expect(toApiClientError(error)).toBe(error)
  })

  it('wraps standard Error preserving message and fallback', () => {
    const result = toApiClientError(new Error('network'), { status: 503, code: 'UNAVAILABLE' })
    expect(result).toBeInstanceOf(ApiClientError)
    expect(result.message).toBe('network')
    expect(result.status).toBe(503)
    expect(result.code).toBe('UNAVAILABLE')
  })

  it('builds error from plain record with status/code/message', () => {
    const result = toApiClientError({ status: 422, code: 'INVALID', message: 'bad input' })
    expect(result.status).toBe(422)
    expect(result.code).toBe('INVALID')
    expect(result.message).toBe('bad input')
    expect(result.body).toEqual({ status: 422, code: 'INVALID', message: 'bad input' })
  })

  it('uses record value field as message fallback', () => {
    const result = toApiClientError({ value: 'fallback msg' })
    expect(result.message).toBe('fallback msg')
  })

  it('uses generic fallback when input is not an object', () => {
    const result = toApiClientError('oops', { status: 500 })
    expect(result.message).toBe('Request failed')
    expect(result.status).toBe(500)
  })
})
