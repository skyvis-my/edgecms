import '../../../test-utils/setup'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { CollectionCreate } from './collection-create'

vi.mock('@tanstack/react-router', () => {
  return {
    Link: ({ children, ...props }: { children: ReactNode; to: string }) => (
      <a href={props.to}>{children}</a>
    ),
    useParams: vi.fn().mockReturnValue({ tenantSlug: 'test-tenant' }),
    useNavigate: vi.fn().mockReturnValue(vi.fn()),
  }
})

vi.mock('@/components/layout/header', () => ({
  Header: ({ children }: { children: ReactNode }) => <header>{children}</header>,
}))

vi.mock('@/components/layout/main', () => ({
  Main: ({ children, ...props }: { children: ReactNode; className?: string }) => (
    <main {...props}>{children}</main>
  ),
}))

vi.mock('@/components/search', () => ({
  Search: () => <div data-testid='search' />,
}))

vi.mock('@/components/theme-switch', () => ({
  ThemeSwitch: () => <div data-testid='theme-switch' />,
}))

vi.mock('@/components/config-drawer', () => ({
  ConfigDrawer: () => <div data-testid='config-drawer' />,
}))

vi.mock('@/components/profile-dropdown', () => ({
  ProfileDropdown: () => <div data-testid='profile-dropdown' />,
}))

vi.mock('./components/collection-form', () => ({
  CollectionForm: ({ mode, createSingleton }: { mode: string; createSingleton?: boolean }) => (
    <div
      data-testid='collection-form'
      data-mode={mode}
      data-create-singleton={createSingleton ? 'true' : 'false'}
    >
      Collection Form ({mode})
    </div>
  ),
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('CollectionCreate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('renders heading and description', () => {
    const view = render(<CollectionCreate kind='collection' />, { wrapper: createWrapper() })

    expect(view.getByText('Create Collection')).toBeInTheDocument()
    expect(view.getByText('Define a new content type for your CMS')).toBeInTheDocument()
  })

  it('renders CollectionForm in create mode', () => {
    const view = render(<CollectionCreate kind='collection' />, { wrapper: createWrapper() })

    const form = view.getByTestId('collection-form')
    expect(form).toBeInTheDocument()
    expect(form).toHaveAttribute('data-mode', 'create')
    expect(form).toHaveAttribute('data-create-singleton', 'false')
  })

  it('renders back button to collections', () => {
    const view = render(<CollectionCreate kind='collection' />, { wrapper: createWrapper() })

    expect(view.getByText('Back to collections')).toBeInTheDocument()
  })

  it('renders singleton create page content', () => {
    const view = render(<CollectionCreate kind='singleton' />, { wrapper: createWrapper() })

    expect(view.getByText('Create Singleton')).toBeInTheDocument()
    expect(view.getByText('Define a single-entry content type for your CMS')).toBeInTheDocument()
    expect(view.getByTestId('collection-form')).toHaveAttribute('data-create-singleton', 'true')
  })
})
