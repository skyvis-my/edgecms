import { createAuthClient } from 'better-auth/react'
import { resolveApiBasePath } from './api-base-path'
import { clearCachedSession, getSessionWithLocalCache } from './session-fetch'
import type { SessionDataShape } from './session-fetch'

function resolveAuthBaseUrl() {
  const origin = globalThis.location?.origin
  if (origin && origin !== 'null') {
    return origin
  }
  return 'http://localhost'
}

/**
 * better-auth React client for the admin SPA.
 *
 * Since the admin app is served from the same Cloudflare Worker origin
 * as the API, we use a relative base URL. The better-auth server
 * routes are mounted at `/api/auth/*` in the CMS Worker.
 *
 * This client provides:
 * - `authClient.signIn.email()` for email/password sign-in
 * - `authClient.signUp.email()` for email/password sign-up
 * - `authClient.signOut()` for session termination
 * - `authClient.useSession()` React hook for session state
 * - `authClient.getSession()` for imperative session checks
 */
export const authClient = createAuthClient({
  baseURL: resolveAuthBaseUrl(),
})

type SessionResult = {
  data: SessionDataShape | null
  error: unknown
}

type CurrentUserResponse = {
  role?: unknown
}

async function fetchEffectiveCurrentUser(): Promise<CurrentUserResponse | null> {
  const response = await fetch(`${resolveApiBasePath()}/me`, {
    credentials: 'include',
  })

  if (!response.ok) return null
  const body = (await response.json()) as CurrentUserResponse
  return body && typeof body === 'object' ? body : null
}

async function getSessionWithEffectiveRole(): Promise<SessionResult> {
  const result = (await authClient.getSession()) as SessionResult

  if (!result.data) return result

  try {
    const currentUser = await fetchEffectiveCurrentUser()
    if (typeof currentUser?.role !== 'string') return result

    return {
      ...result,
      data: {
        ...result.data,
        user: {
          ...result.data.user,
          role: currentUser.role,
        },
      },
    }
  } catch {
    return result
  }
}

export async function getSessionIfNeeded() {
  return getSessionWithLocalCache(getSessionWithEffectiveRole)
}

export async function refreshSessionAfterLogin() {
  return getSessionWithLocalCache(getSessionWithEffectiveRole, { forceRefresh: true })
}

export async function signOutAndClearSession() {
  const result = await authClient.signOut()
  clearCachedSession()
  return result
}

/**
 * Convenience re-exports for common auth operations.
 */
export const { signIn, signUp, useSession } = authClient
export const signOut = signOutAndClearSession
