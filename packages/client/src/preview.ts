import * as React from 'react'

export const EDGECMS_PREVIEW_MESSAGE_TYPE = 'EDGECMS_PREVIEW_UPDATE'
export const EDGECMS_PREVIEW_READY_TYPE = 'EDGECMS_PREVIEW_READY'

export type PreviewMessagePayload<T = unknown> = {
  type: typeof EDGECMS_PREVIEW_MESSAGE_TYPE
  token?: string | undefined
  payload: T
}

export type ReadyMessagePayload = {
  type: typeof EDGECMS_PREVIEW_READY_TYPE
}

export type ListenPreviewOptions = {
  allowedOrigin?: string | undefined
  token?: string | undefined
}

export type SendPreviewOptions = {
  targetOrigin?: string | undefined
  token?: string | undefined
}

/**
 * Sends a live draft update from the host window (e.g. EdgeCMS Admin) to a target preview iframe window.
 */
export function sendDraftPreviewUpdate<T = unknown>(
  targetWindow: Window,
  payload: T,
  options?: SendPreviewOptions
): void {
  if (!targetWindow || typeof targetWindow.postMessage !== 'function') return

  const message: PreviewMessagePayload<T> = {
    type: EDGECMS_PREVIEW_MESSAGE_TYPE,
    token: options?.token,
    payload,
  }

  targetWindow.postMessage(message, options?.targetOrigin || '*')
}

/**
 * Sends a ready notification from the preview iframe to the host window.
 */
export function sendPreviewReadyNotification(
  targetWindow: Window = window.parent,
  targetOrigin: string = '*'
): void {
  if (!targetWindow || targetWindow === window || typeof targetWindow.postMessage !== 'function') return

  const message: ReadyMessagePayload = {
    type: EDGECMS_PREVIEW_READY_TYPE,
  }

  targetWindow.postMessage(message, targetOrigin)
}

/**
 * Subscribes to live draft updates sent via window.postMessage.
 * Returns an unsubscribe cleanup function.
 */
export function listenToDraftPreview<T = unknown>(
  callback: (data: T) => void,
  options?: ListenPreviewOptions
): () => void {
  if (typeof window === 'undefined') {
    return () => {}
  }

  const handleMessage = (event: MessageEvent) => {
    if (options?.allowedOrigin && options.allowedOrigin !== '*' && event.origin !== options.allowedOrigin) {
      return
    }

    const data = event.data as PreviewMessagePayload<T> | undefined
    if (!data || typeof data !== 'object') return

    if (data.type === EDGECMS_PREVIEW_MESSAGE_TYPE) {
      if (options?.token && data.token && data.token !== options.token) {
        return
      }
      callback(data.payload)
    }
  }

  window.addEventListener('message', handleMessage)

  // Notify parent window that preview listener is initialized and ready
  sendPreviewReadyNotification()

  return () => {
    window.removeEventListener('message', handleMessage)
  }
}

/**
 * React hook for consuming live draft preview updates in embedded preview components/pages.
 */
export function useDraftPreview<T = unknown>(
  initialData?: T,
  options?: ListenPreviewOptions
): { data: T | undefined; isPreview: boolean } {
  const [data, setData] = React.useState<T | undefined>(initialData)
  const [isPreview, setIsPreview] = React.useState<boolean>(false)

  React.useEffect(() => {
    if (initialData !== undefined) {
      setData(initialData)
    }
  }, [initialData])

  React.useEffect(() => {
    const unsubscribe = listenToDraftPreview<T>((draft) => {
      setIsPreview(true)
      setData(draft)
    }, options)

    return unsubscribe
  }, [options?.allowedOrigin, options?.token])

  return { data, isPreview }
}
