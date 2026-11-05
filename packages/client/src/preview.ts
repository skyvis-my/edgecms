import * as React from 'react'

export const EDGECMS_PREVIEW_MESSAGE_TYPE = 'EDGECMS_PREVIEW_UPDATE'
export const EDGECMS_PREVIEW_READY_TYPE = 'EDGECMS_PREVIEW_READY'
export const EDGECMS_PREVIEW_TOKEN_TYPE = 'EDGECMS_PREVIEW_TOKEN'

/** Longest token `listenForPreviewToken` accepts. Real tokens are well under 2 KB. */
const MAX_PREVIEW_TOKEN_LENGTH = 8192

export type PreviewMessagePayload<T = unknown> = {
  type: typeof EDGECMS_PREVIEW_MESSAGE_TYPE
  token?: string | undefined
  payload: T
}

export type ReadyMessagePayload = {
  type: typeof EDGECMS_PREVIEW_READY_TYPE
}

export type PreviewTokenMessage = {
  type: typeof EDGECMS_PREVIEW_TOKEN_TYPE
  token: string
}

export type SendPreviewTokenOptions = {
  /** Exact origin of the preview frame, e.g. `https://www.example.com`. `*` is refused. */
  targetOrigin: string
}

export type ListenPreviewTokenOptions = {
  /** Exact origin of the EdgeCMS admin, e.g. `https://admin.example.com`. `*` is refused. */
  allowedOrigin: string
  /** Window the token must come from. Defaults to `window.parent`. */
  source?: Window | null | undefined
  /** Post `EDGECMS_PREVIEW_READY` to the parent at `allowedOrigin` on start. Default true. */
  notifyReady?: boolean | undefined
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
  targetWindow?: Window | null,
  payload?: T,
  options?: SendPreviewOptions
): void {
  if (!targetWindow || typeof targetWindow.postMessage !== 'function') return

  const message: PreviewMessagePayload<T> = {
    type: EDGECMS_PREVIEW_MESSAGE_TYPE,
    token: options?.token,
    payload: payload as T,
  }

  targetWindow.postMessage(message, options?.targetOrigin || '*')
}

/**
 * Sends a ready notification from the preview iframe to the host window.
 */
export function sendPreviewReadyNotification(
  targetWindow?: Window,
  targetOrigin: string = '*'
): void {
  const target = targetWindow ?? (typeof window !== 'undefined' ? window.parent : undefined)
  if (!target || typeof target.postMessage !== 'function') return
  if (typeof window !== 'undefined' && target === window) return

  const message: ReadyMessagePayload = {
    type: EDGECMS_PREVIEW_READY_TYPE,
  }

  target.postMessage(message, targetOrigin)
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

/**
 * Returns the `scheme://host[:port]` origin of an http(s) URL, or null for anything else
 * (wildcards, opaque origins, `data:`, `javascript:`, unparsable input).
 */
export function resolvePreviewOrigin(url: string, base?: string): string | null {
  if (!url || url === '*') return null
  try {
    const parsed = base ? new URL(url, base) : new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    return parsed.origin
  } catch {
    return null
  }
}

function requireExactOrigin(value: string | undefined, name: string): string {
  const origin = typeof value === 'string' ? resolvePreviewOrigin(value) : null
  if (!origin || origin !== value) {
    throw new TypeError(`${name} must be an exact http(s) origin such as https://example.com`)
  }
  return origin
}

/**
 * DL-08: sends a preview token from the admin to the preview frame. The token never goes in
 * the frame URL; it is posted only to `targetOrigin`, so a frame that has navigated elsewhere
 * does not receive it. Returns false when there is nothing to send.
 */
export function sendPreviewToken(
  targetWindow: Window | null | undefined,
  token: string,
  options: SendPreviewTokenOptions
): boolean {
  const targetOrigin = requireExactOrigin(options?.targetOrigin, 'targetOrigin')
  if (!targetWindow || typeof targetWindow.postMessage !== 'function') return false
  if (typeof token !== 'string' || token.length === 0) return false
  const message: PreviewTokenMessage = { type: EDGECMS_PREVIEW_TOKEN_TYPE, token }
  targetWindow.postMessage(message, targetOrigin)
  return true
}

/**
 * DL-08: receives the preview token in the preview frame. Only messages from `allowedOrigin`
 * and from the expected source window (default `window.parent`) are accepted. Send the token
 * to EdgeCMS as the `x-edgecms-preview-token` header (the `previewToken` client option); do
 * not put it in a URL, cookie or storage. Returns an unsubscribe function.
 */
export function listenForPreviewToken(
  callback: (token: string) => void,
  options: ListenPreviewTokenOptions
): () => void {
  const allowedOrigin = requireExactOrigin(options?.allowedOrigin, 'allowedOrigin')
  if (typeof window === 'undefined') return () => {}

  const expectedSource = options.source === undefined ? window.parent : options.source

  const handleMessage = (event: MessageEvent) => {
    if (event.origin !== allowedOrigin) return
    if (!expectedSource || event.source !== expectedSource) return
    const data = event.data as Partial<PreviewTokenMessage> | null | undefined
    if (!data || typeof data !== 'object' || data.type !== EDGECMS_PREVIEW_TOKEN_TYPE) return
    const token = data.token
    if (typeof token !== 'string' || token.length === 0) return
    if (token.length > MAX_PREVIEW_TOKEN_LENGTH) return
    callback(token)
  }

  window.addEventListener('message', handleMessage)

  if (options.notifyReady !== false && expectedSource) {
    sendPreviewReadyNotification(expectedSource, allowedOrigin)
  }

  return () => {
    window.removeEventListener('message', handleMessage)
  }
}
