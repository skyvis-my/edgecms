import { create } from 'zustand'
import { signOut } from '@/lib/auth-client'

/**
 * Auth store for managing client-side authentication state.
 *
 * Session truth-of-record lives in better-auth's cookie-based sessions.
 * This store provides a thin wrapper for:
 * - Tracking sign-in/sign-up loading states
 * - Exposing signOut that clears the better-auth session
 * - Reactive session data via `authClient.useSession()` (used directly in components)
 */

interface AuthState {
  auth: {
    /** Sign out the current user by calling better-auth signOut endpoint */
    signOut: () => Promise<void>
  }
}

export const useAuthStore = create<AuthState>()(() => ({
  auth: {
    signOut: async () => {
      await signOut()
    },
  },
}))
