import { describe, expect, it, vi } from 'bun:test'
import {
  EDGECMS_PREVIEW_MESSAGE_TYPE,
  EDGECMS_PREVIEW_READY_TYPE,
  listenToDraftPreview,
  sendDraftPreviewUpdate,
  sendPreviewReadyNotification,
} from '../preview'

describe('@edgecms/client Draft Preview Bridge', () => {
  it('sends preview update to target window', () => {
    const postMessage = vi.fn()
    const mockWindow = { postMessage } as unknown as Window

    const payload = { title: 'Draft in progress', body: 'Draft body' }
    sendDraftPreviewUpdate(mockWindow, payload, {
      token: 'preview-token-123',
      targetOrigin: 'https://preview.my-app.com',
    })

    expect(postMessage).toHaveBeenCalledTimes(1)
    expect(postMessage).toHaveBeenCalledWith(
      {
        type: EDGECMS_PREVIEW_MESSAGE_TYPE,
        token: 'preview-token-123',
        payload,
      },
      'https://preview.my-app.com'
    )
  })

  it('sends preview ready notification', () => {
    const postMessage = vi.fn()
    const mockParent = { postMessage } as unknown as Window

    sendPreviewReadyNotification(mockParent, 'https://cms.my-app.com')
    expect(postMessage).toHaveBeenCalledTimes(1)
    expect(postMessage).toHaveBeenCalledWith(
      { type: EDGECMS_PREVIEW_READY_TYPE },
      'https://cms.my-app.com'
    )
  })

  it('subscribes to window message events and verifies token', () => {
    const listeners: Record<string, ((event: MessageEvent) => void)[]> = {}
    const mockWindow = {
      addEventListener: (type: string, listener: (event: MessageEvent) => void) => {
        listeners[type] = listeners[type] || []
        listeners[type]!.push(listener)
      },
      removeEventListener: (type: string, listener: (event: MessageEvent) => void) => {
        if (listeners[type]) {
          listeners[type] = listeners[type]!.filter((l) => l !== listener)
        }
      },
      parent: {} as Window,
    }

    // Set global window for test
    const originalWindow = globalThis.window
    // @ts-expect-error mocking window
    globalThis.window = mockWindow

    try {
      const received: unknown[] = []
      const unsubscribe = listenToDraftPreview((data) => {
        received.push(data)
      }, { token: 'secret-token' })

      const dispatch = (msg: unknown, origin = 'http://localhost') => {
        for (const handler of listeners['message'] || []) {
          handler({ data: msg, origin } as MessageEvent)
        }
      }

      // Ignore unrelated message
      dispatch({ type: 'OTHER_EVENT' })
      expect(received).toHaveLength(0)

      // Ignore message with wrong token
      dispatch({
        type: EDGECMS_PREVIEW_MESSAGE_TYPE,
        token: 'wrong-token',
        payload: { text: 'bad' },
      })
      expect(received).toHaveLength(0)

      // Accept message with correct token
      dispatch({
        type: EDGECMS_PREVIEW_MESSAGE_TYPE,
        token: 'secret-token',
        payload: { text: 'valid-draft' },
      })
      expect(received).toHaveLength(1)
      expect(received[0]).toEqual({ text: 'valid-draft' })

      // Unsubscribe
      unsubscribe()
      dispatch({
        type: EDGECMS_PREVIEW_MESSAGE_TYPE,
        token: 'secret-token',
        payload: { text: 'after-unsubscribe' },
      })
      expect(received).toHaveLength(1)
    } finally {
      globalThis.window = originalWindow
    }
  })
})
