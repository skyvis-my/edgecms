import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import { toast } from 'sonner'
import { ApiClientError } from '@/lib/api-error'
import { signOut } from '@/lib/auth-client'
import { handleServerError } from '@/lib/handle-server-error'
import { logger } from '@/lib/logger'
import { enableNavigationViewTransitions } from '@/lib/navigation-transitions'
import { DirectionProvider } from './context/direction-provider'
import { FontProvider } from './context/font-provider'
import { ThemeProvider } from './context/theme-provider'
// Generated Routes
import { routeTree } from './routeTree.gen'
// Styles
import './styles/index.css'

const isApiStatusError = (error: unknown, status: number) =>
  error instanceof ApiClientError && error.status === status

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        if (import.meta.env.DEV) logger.info({ failureCount, error })

        if (failureCount >= 0 && import.meta.env.DEV) return false
        if (failureCount > 3 && import.meta.env.PROD) return false

        return !(error instanceof ApiClientError && [401, 403].includes(error.status ?? 0))
      },
      refetchOnWindowFocus: import.meta.env.PROD,
      staleTime: 10 * 1000, // 10s
    },
    mutations: {
      onError: (error) => {
        handleServerError(error)

        if (isApiStatusError(error, 304)) {
          toast.error('Content not modified!')
        }
      },
    },
  },
  queryCache: new QueryCache({
    onError: (error) => {
      if (isApiStatusError(error, 401)) {
        toast.error('Session expired!')
        // Sign out via better-auth to clear session cookie
        signOut().then(() => {
          const redirect = `${router.history.location.href}`
          router.navigate({ to: '/sign-in', search: { redirect } })
        })
      }
      if (isApiStatusError(error, 500)) {
        toast.error('Internal Server Error!')
        // Only navigate to error page in production to avoid disrupting HMR in development
        if (import.meta.env.PROD) {
          router.navigate({ to: '/500' })
        }
      }
      if (isApiStatusError(error, 403)) {
        toast.error('You do not have permission to access this resource.')
        router.navigate({ to: '/403' })
      }
    },
  }),
})

// Create a new router instance
const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
  // Avoid repeated network churn when users hover/focus the same links frequently.
  defaultPreloadStaleTime: 30_000,
})

if (
  typeof window !== 'undefined' &&
  !window.matchMedia('(prefers-reduced-motion: reduce)').matches
) {
  enableNavigationViewTransitions(router)
}

// Register the router instance for type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

// Render the app
const rootElement = document.getElementById('root') as HTMLElement
if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement)
  root.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <FontProvider>
            <DirectionProvider>
              <RouterProvider router={router} />
            </DirectionProvider>
          </FontProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </StrictMode>
  )
}
