import { beforeEach, describe, expect, it } from 'bun:test'
import { getCookie, removeCookie, setCookie } from './cookies'

describe('cookies', () => {
  beforeEach(() => {
    // oxlint-disable-next-line lint/suspicious/noDocumentCookie: test setup clears cookies via the same browser API used by production code.
    document.cookie = 'test1=; max-age=0; path=/'
    // oxlint-disable-next-line lint/suspicious/noDocumentCookie: test setup clears cookies via the same browser API used by production code.
    document.cookie = 'test2=; max-age=0; path=/'
  })

  it('sets and gets cookies', () => {
    setCookie('test1', 'value1', 60)
    expect(getCookie('test1')).toBe('value1')
  })

  it('returns undefined for missing cookie', () => {
    expect(getCookie('missing')).toBeUndefined()
  })

  it('removes cookie', () => {
    setCookie('test2', 'value2', 60)
    expect(getCookie('test2')).toBe('value2')
    removeCookie('test2')
    expect(getCookie('test2')).toBeUndefined()
  })
})
