import '../../../test-utils/setup'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { useCollection } from './api/collections-api'
import { CollectionEdit } from './collection-edit'

vi.mock('@tanstack/react-router', () => {
  return {
    Link: ({ children, ...props }: { children: ReactNode; to: string }) => (
      <a href={props.to}>{children}</a>
    ),
    useParams: vi.fn().mockReturnValue({ collectionId: 'test-collection-id' }),
    useNavigate: vi.fn().mockReturnValue(vi.fn()),
  }
})

vi.mock('./api/collections-api', () => ({
  useCollection: vi.fn(),
}))

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
  CollectionForm: ({ mode, collection }: { mode: string; collection?: unknown }) => (
    <div data-testid='collection-form' data-mode={mode}>
      {collection ? 'Editing collection' : 'No collection data'}
    </div>
  ),
}))

const mockedUseCollection = useCollection

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('CollectionEdit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders loading state while fetching', () => {
    mockedUseCollection.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as never)

    const view = render(<CollectionEdit />, { wrapper: createWrapper() })

    expect(view.getByText('Edit Collection')).toBeInTheDocument()
    expect(view.getByText('Update your collection definition and fields')).toBeInTheDocument()
    expect(view.queryByTestId('collection-form')).not.toBeInTheDocument()
  })

  it('renders form with existing data', () => {
    const mockCollection = {
      id: 'test-collection-id',
      name: 'Blog Posts',
      slug: 'blog-posts',
      singleton: false,
      fields: [],
      defaultLocale: 'en',
      supportedLocales: ['en'],
      createdAt: '2026-01-01',
      updatedAt: '2026-01-10',
    }

    mockedUseCollection.mockReturnValue({
      data: mockCollection,
      isLoading: false,
      error: null,
    } as never)

    const view = render(<CollectionEdit />, { wrapper: createWrapper() })

    expect(view.getByText('Edit Blog Posts')).toBeInTheDocument()
    const form = view.getByTestId('collection-form')
    expect(form).toHaveAttribute('data-mode', 'edit')
    expect(form).toHaveTextContent('Editing collection')
  })

  it('shows error state on fetch failure', () => {
    mockedUseCollection.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Not found'),
    } as never)

    const view = render(<CollectionEdit />, { wrapper: createWrapper() })

    expect(view.getByText('Failed to load collection. Please try again.')).toBeInTheDocument()
  })

  it('renders back button to collections', () => {
    mockedUseCollection.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as never)

    const view = render(<CollectionEdit />, { wrapper: createWrapper() })

    expect(view.getByText('Back to collections')).toBeInTheDocument()
  })
})
