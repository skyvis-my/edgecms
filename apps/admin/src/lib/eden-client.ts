import { treaty } from '@elysia/eden'
import type { App } from 'edgecms-api/contract'
import { resolveApiBasePath } from './api-base-path'
import { ApiClientError, toApiClientError } from './api-error'
import {
  clearAccessTokens,
  ensureAccessToken,
  getCachedAccessToken,
  refreshAccessTokenIfExpiring,
} from './access-token'
import { getCookie } from './cookies'
import {
  ACTIVE_TENANT_STORAGE_KEY,
  TENANT_SWITCH_EVENT,
  getCurrentTenantSlug,
} from './tenant-storage'
import { prefixTenantPath } from './tenant-path'

type EdenLikeSuccess<T> = {
  data: T
  error: null
}

type EdenLikeFailure = {
  data: null
  error: unknown
}

type ApiEnvelope<T> =
  | {
      success: true
      data: T
    }
  | {
      success: false
      error: {
        code: string
        message: string
      }
    }

export { resolveApiBasePath } from './api-base-path'

export const eden = treaty<App>(resolveApiBasePath())
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const CSRF_COOKIE_NAME = 'csrf_token'
let cachedTenantSlug: string | null | undefined

function getCachedTenantSlug(): string | null {
  if (cachedTenantSlug !== undefined) {
    if (cachedTenantSlug === null) {
      const refreshed = getCurrentTenantSlug()
      if (refreshed) {
        cachedTenantSlug = refreshed
      }
    }
    return cachedTenantSlug
  }
  cachedTenantSlug = getCurrentTenantSlug()
  return cachedTenantSlug
}

if (typeof window !== 'undefined') {
  window.addEventListener(TENANT_SWITCH_EVENT, (event) => {
    const detail = (event as CustomEvent<{ slug: string | null }>).detail
    cachedTenantSlug = detail?.slug ?? null
    // Drop the previous scope's token; the next request mints lazily and the
    // authenticated layout prefetches. Never the old tenant's token.
    clearAccessTokens()
  })
  window.addEventListener('storage', (event) => {
    if (event.key === ACTIVE_TENANT_STORAGE_KEY) {
      cachedTenantSlug = event.newValue
    }
  })
}

async function getOrFetchCsrfToken(): Promise<string | undefined> {
  const existing = getCookie(CSRF_COOKIE_NAME)
  if (existing) return existing

  if (typeof document === 'undefined' || typeof fetch === 'undefined') return undefined
  const response = await fetch(`${resolveApiBasePath()}/csrf`, {
    method: 'GET',
    credentials: 'include',
  })
  if (!response.ok) return undefined

  const payload = (await response.json()) as ApiEnvelope<{ csrfToken: string }>
  if (payload.success) return payload.data.csrfToken
  return getCookie(CSRF_COOKIE_NAME)
}

export function normalizeEdenResponse<T>(result: EdenLikeSuccess<T> | EdenLikeFailure): T {
  if (result.error === null) {
    if (result.data === null) {
      throw new ApiClientError({ message: 'Eden response is missing data' })
    }
    return result.data
  }

  throw toApiClientError(result.error)
}

function isApiEnvelope(value: unknown): value is ApiEnvelope<unknown> {
  return typeof value === 'object' && value !== null && 'success' in value
}

function isTokenStalePayload(payload: unknown): boolean {
  return isApiEnvelope(payload) && !payload.success && payload.error.code === 'TOKEN_STALE'
}

async function readPayload(response: Response): Promise<unknown> {
  if (response.status === 204 || response.status === 205) return null
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

async function fetchWithAccessToken(
  url: string,
  fetchOptions: RequestInit,
  headers: Record<string, string>,
  tenantSlug: string | null
): Promise<{ response: Response; payload: unknown }> {
  const token = getCachedAccessToken(tenantSlug)
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  } else {
    refreshAccessTokenIfExpiring(tenantSlug)
  }
  const response = await fetch(url, { ...fetchOptions, headers: { ...headers } })
  const payload = await readPayload(response)

  if (response.status === 401 && isTokenStalePayload(payload)) {
    clearAccessTokens(tenantSlug)
    const freshToken = await ensureAccessToken(tenantSlug, { force: true }).catch(() => null)
    const retryHeaders = { ...headers }
    if (freshToken) {
      retryHeaders['Authorization'] = `Bearer ${freshToken}`
    } else {
      delete retryHeaders['Authorization']
    }
    const retry = await fetch(url, { ...fetchOptions, headers: retryHeaders })
    return { response: retry, payload: await readPayload(retry) }
  }

  return { response, payload }
}

async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  options?: { tenantSlug?: string | null; bodyType?: 'json' | 'multipart' }
): Promise<T> {
  const headers: Record<string, string> = {}
  const tenantSlug = options?.tenantSlug ?? getCachedTenantSlug()
  const bodyType = options?.bodyType ?? 'json'

  if (tenantSlug) {
    headers['x-tenant'] = tenantSlug
  }

  if (!SAFE_METHODS.has(method) && body !== undefined && bodyType === 'json') {
    headers['Content-Type'] = 'application/json'
  }

  if (!SAFE_METHODS.has(method)) {
    const csrfToken = await getOrFetchCsrfToken()
    if (csrfToken) {
      headers['x-csrf-token'] = csrfToken
    }
  }

  const tenantPath = prefixTenantPath(path, tenantSlug)
  const fetchOptions: RequestInit = {
    method,
    credentials: 'include',
    headers: Object.keys(headers).length > 0 ? headers : undefined,
  }
  if (!SAFE_METHODS.has(method) && body !== undefined) {
    fetchOptions.body = bodyType === 'multipart' ? (body as FormData) : JSON.stringify(body)
  }
  const { response, payload } = await fetchWithAccessToken(
    `${resolveApiBasePath()}${tenantPath}`,
    fetchOptions,
    headers,
    tenantSlug
  )

  if (!response.ok) {
    if (isApiEnvelope(payload) && !payload.success) {
      throw new ApiClientError({
        status: response.status,
        code: payload.error.code,
        message: payload.error.message,
        body: payload,
      })
    }

    throw new ApiClientError({
      status: response.status,
      message: response.statusText || 'Request failed',
      body: payload,
    })
  }

  if (isApiEnvelope(payload)) {
    if (payload.success) {
      const envelope = payload as { success: true; data: unknown; [key: string]: unknown }
      const envelopeKeys = Object.keys(envelope).filter((key) => key !== 'success')
      if (envelopeKeys.length === 1 && envelopeKeys[0] === 'data') {
        return envelope.data as T
      }

      return Object.fromEntries(Object.entries(envelope).filter(([key]) => key !== 'success')) as T
    }

    throw new ApiClientError({
      status: response.status,
      code: payload.error.code,
      message: payload.error.message,
      body: payload,
    })
  }

  return payload as T
}

export const edenGet = <T>(path: string) => request<T>('GET', path)
export const edenPost = <T>(path: string, body?: unknown) => request<T>('POST', path, body)
export const edenPostMultipart = <T>(path: string, body: FormData) =>
  request<T>('POST', path, body, { bodyType: 'multipart' })
export const edenPut = <T>(path: string, body?: unknown) => request<T>('PUT', path, body)
export const edenPatch = <T>(path: string, body?: unknown) => request<T>('PATCH', path, body)
export const edenDelete = <T = void>(path: string) => request<T>('DELETE', path)

export const edenPostForTenant = <T>(path: string, body: unknown, tenantSlug: string | null) =>
  request<T>('POST', path, body, { tenantSlug })
