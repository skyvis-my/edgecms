import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import {
  EDGECMS_PREVIEW_READY_TYPE,
  EDGECMS_PREVIEW_TOKEN_TYPE,
  listenForPreviewToken,
  resolvePreviewOrigin,
  sendPreviewToken,
} from '../preview'

// DL-08: the preview token reaches the preview frame by postMessage with a
// strict origin, never in the frame URL.

const ADMIN_ORIGIN = 'https://admin.example.com'

type Listener = (event: MessageEvent) => void

function installWindow() {
  const listeners: Listener[] = []
  const parentPost = vi.fn()
  const parent = { postMessage: parentPost } as unknown as Window
  const fakeWindow = {
    addEventListener: (type: string, listener: Listener) => {
      if (type === 'message') listeners.push(listener)
    },
    removeEventListener: (type: string, listener: Listener) => {
      if (type !== 'message') return
      const index = listeners.indexOf(listener)
      if (index >= 0) listeners.splice(index, 1)
    },
    parent,
  }
  // @ts-expect-error test window
  globalThis.window = fakeWindow
  const dispatch = (data: unknown, origin = ADMIN_ORIGIN, source: unknown = parent) => {
    for (const listener of [...listeners]) {
      listener({ data, origin, source } as MessageEvent)
    }
  }
  return { listeners, parent, parentPost, dispatch }
}

describe('resolvePreviewOrigin', () => {
  it('returns the origin of an http(s) URL', () => {
    expect(resolvePreviewOrigin('https://www.example.com/blog/post?x=1')).toBe(
      'https://www.example.com'
    )
    expect(resolvePreviewOrigin('http://localhost:3000/preview')).toBe('http://localhost:3000')
  })

  it('resolves relative URLs against a base', () => {
    expect(resolvePreviewOrigin('/preview', 'https://admin.example.com/x')).toBe(ADMIN_ORIGIN)
  })

  it('refuses wildcards, opaque and non-http origins', () => {
    expect(resolvePreviewOrigin('*')).toBeNull()
    expect(resolvePreviewOrigin('')).toBeNull()
    expect(resolvePreviewOrigin('javascript:alert(1)')).toBeNull()
    expect(resolvePreviewOrigin('data:text/html,hi')).toBeNull()
    expect(resolvePreviewOrigin('file:///etc/passwd')).toBeNull()
    expect(resolvePreviewOrigin('not a url')).toBeNull()
  })
})

describe('sendPreviewToken', () => {
  it('posts the token to the exact target origin', () => {
    const postMessage = vi.fn()
    const sent = sendPreviewToken({ postMessage } as unknown as Window, 'tok.abc', {
      targetOrigin: 'https://www.example.com',
    })
    expect(sent).toBe(true)
    expect(postMessage).toHaveBeenCalledWith(
      { type: EDGECMS_PREVIEW_TOKEN_TYPE, token: 'tok.abc' },
      'https://www.example.com'
    )
  })

  it('refuses a wildcard or malformed target origin', () => {
    const postMessage = vi.fn()
    const win = { postMessage } as unknown as Window
    expect(() => sendPreviewToken(win, 'tok', { targetOrigin: '*' })).toThrow()
    expect(() => sendPreviewToken(win, 'tok', { targetOrigin: 'https://a.com/path' })).toThrow()
    expect(() => sendPreviewToken(win, 'tok', { targetOrigin: '' })).toThrow()
    expect(postMessage).not.toHaveBeenCalled()
  })

  it('sends nothing without a window or token', () => {
    const postMessage = vi.fn()
    expect(sendPreviewToken(null, 'tok', { targetOrigin: ADMIN_ORIGIN })).toBe(false)
    expect(
      sendPreviewToken({ postMessage } as unknown as Window, '', { targetOrigin: ADMIN_ORIGIN })
    ).toBe(false)
    expect(postMessage).not.toHaveBeenCalled()
  })
})

describe('listenForPreviewToken', () => {
  const originalWindow = globalThis.window
  let env: ReturnType<typeof installWindow>

  beforeEach(() => {
    env = installWindow()
  })

  afterEach(() => {
    globalThis.window = originalWindow
  })

  it('requires an exact allowedOrigin', () => {
    expect(() => listenForPreviewToken(() => {}, { allowedOrigin: '*' })).toThrow()
    expect(() => listenForPreviewToken(() => {}, { allowedOrigin: 'https://a.com/x' })).toThrow()
    expect(() =>
      listenForPreviewToken(() => {}, { allowedOrigin: undefined as unknown as string })
    ).toThrow()
  })

  it('announces readiness to the parent at the allowed origin only', () => {
    listenForPreviewToken(() => {}, { allowedOrigin: ADMIN_ORIGIN })
    expect(env.parentPost).toHaveBeenCalledWith({ type: EDGECMS_PREVIEW_READY_TYPE }, ADMIN_ORIGIN)
  })

  it('accepts a token from the allowed origin and parent window', () => {
    const received: string[] = []
    listenForPreviewToken((token) => received.push(token), { allowedOrigin: ADMIN_ORIGIN })
    env.dispatch({ type: EDGECMS_PREVIEW_TOKEN_TYPE, token: 'tok.good' })
    expect(received).toEqual(['tok.good'])
  })

  it('ignores tokens from another origin', () => {
    const received: string[] = []
    listenForPreviewToken((token) => received.push(token), { allowedOrigin: ADMIN_ORIGIN })
    env.dispatch({ type: EDGECMS_PREVIEW_TOKEN_TYPE, token: 'tok.evil' }, 'https://evil.example')
    env.dispatch({ type: EDGECMS_PREVIEW_TOKEN_TYPE, token: 'tok.evil' }, 'null')
    expect(received).toEqual([])
  })

  it('ignores tokens from a window other than the expected source', () => {
    const received: string[] = []
    listenForPreviewToken((token) => received.push(token), { allowedOrigin: ADMIN_ORIGIN })
    env.dispatch({ type: EDGECMS_PREVIEW_TOKEN_TYPE, token: 'tok.sibling' }, ADMIN_ORIGIN, {})
    expect(received).toEqual([])
  })

  it('ignores malformed messages', () => {
    const received: string[] = []
    listenForPreviewToken((token) => received.push(token), { allowedOrigin: ADMIN_ORIGIN })
    env.dispatch(null)
    env.dispatch('tok')
    env.dispatch({ type: 'EDGECMS_PREVIEW_UPDATE', token: 'tok' })
    env.dispatch({ type: EDGECMS_PREVIEW_TOKEN_TYPE })
    env.dispatch({ type: EDGECMS_PREVIEW_TOKEN_TYPE, token: 42 })
    env.dispatch({ type: EDGECMS_PREVIEW_TOKEN_TYPE, token: '' })
    env.dispatch({ type: EDGECMS_PREVIEW_TOKEN_TYPE, token: 'x'.repeat(8193) })
    expect(received).toEqual([])
  })

  it('stops listening after unsubscribe', () => {
    const received: string[] = []
    const stop = listenForPreviewToken((token) => received.push(token), {
      allowedOrigin: ADMIN_ORIGIN,
    })
    stop()
    env.dispatch({ type: EDGECMS_PREVIEW_TOKEN_TYPE, token: 'tok.late' })
    expect(received).toEqual([])
    expect(env.listeners).toHaveLength(0)
  })
})
