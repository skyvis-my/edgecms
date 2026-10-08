import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import type { RenderOptions } from '@testing-library/react'
import { render } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'

/**
 * Create a fresh QueryClient for each test with retry disabled
 * to prevent flaky tests from hanging on failed requests.
 */
export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  })
}

/**
 * Create a minimal test router with memory history.
 * This is a simplified router for testing components that use TanStack Router hooks.
 */
export function createTestRouter(initialPath = '/') {
  const memoryHistory = createMemoryHistory({
    initialEntries: [initialPath],
  })

  const rootRoute = createRootRoute({
    component: () => null,
  })

  return createRouter({
    routeTree: rootRoute,
    history: memoryHistory,
  })
}

interface AllTheProvidersProps {
  children: ReactNode
  queryClient?: QueryClient
  router?: ReturnType<typeof createTestRouter>
}

/**
 * Wrapper component that provides all necessary contexts for testing.
 */
function AllTheProviders({ children, queryClient, router }: AllTheProvidersProps) {
  const testQueryClient = queryClient || createTestQueryClient()
  const testRouter = router || createTestRouter()

  return (
    <QueryClientProvider client={testQueryClient}>
      <RouterProvider router={testRouter}>{children}</RouterProvider>
    </QueryClientProvider>
  )
}

interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  queryClient?: QueryClient
  router?: ReturnType<typeof createTestRouter>
  initialPath?: string
}

/**
 * Render a component with all necessary providers for testing.
 *
 * @example
 * ```tsx
 * const { getByText } = renderWithProviders(<MyComponent />)
 * ```
 */
export function renderWithProviders(
  ui: ReactElement,
  { queryClient, router, initialPath = '/', ...options }: CustomRenderOptions = {}
) {
  const testRouter = router || createTestRouter(initialPath)

  return render(ui, {
    wrapper: ({ children }) => (
      <AllTheProviders queryClient={queryClient} router={testRouter}>
        {children}
      </AllTheProviders>
    ),
    ...options,
  })
}
