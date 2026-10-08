import '../../../test-utils/setup'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { useCollectionByIdentifier } from '@/features/collections/api/collections-api'
import { EntryCreate } from './entry-create'

vi.mock('@tanstack/react-router', () => {
  return {
    Link: ({ children, ...props }: { children: ReactNode; to: string }) => (
      <a href={props.to}>{children}</a>
    ),
    useParams: vi
      .fn()
      .mockReturnValue({ tenantSlug: 'tenant-a', collectionId: 'test-collection-id' }),
    useNavigate: vi.fn().mockReturnValue(vi.fn()),
  }
})

vi.mock('@/features/collections/api/collections-api', () => ({
  useCollectionByIdentifier: vi.fn(),
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

const mockedUseCollectionByIdentifier = useCollectionByIdentifier

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('EntryCreate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('renders heading and description', () => {
    mockedUseCollectionByIdentifier.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as never)

    const view = render(<EntryCreate />, { wrapper: createWrapper() })

    expect(view.getByText((text) => text.includes('Create Entry'))).toBeInTheDocument()
  })

  it('shows loading state while collection loads', () => {
    mockedUseCollectionByIdentifier.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as never)

    const view = render(<EntryCreate />, { wrapper: createWrapper() })

    expect(view.getByText((text) => text.includes('Create Entry'))).toBeInTheDocument()
  })

  it('renders loaded collection heading', () => {
    const mockCollection = {
      id: 'test-collection-id',
      name: 'Blog Posts',
      slug: 'blog-posts',
      singleton: false,
      fields: [{ name: 'title', type: 'text', required: true, localizable: false }],
      defaultLocale: 'en',
      supportedLocales: ['en'],
    }

    mockedUseCollectionByIdentifier.mockReturnValue({
      data: mockCollection,
      isLoading: false,
      error: null,
    } as never)

    const view = render(<EntryCreate />, { wrapper: createWrapper() })

    expect(view.getByText((text) => text.includes('Blog Posts'))).toBeInTheDocument()
  })

  it('shows collection name in heading when loaded', () => {
    mockedUseCollectionByIdentifier.mockReturnValue({
      data: {
        id: 'c1',
        name: 'Products',
        slug: 'products',
        singleton: false,
        fields: [{ name: 'title', type: 'text', required: true, localizable: false }],
        defaultLocale: 'en',
        supportedLocales: ['en'],
      },
      isLoading: false,
      error: null,
    } as never)

    const view = render(<EntryCreate />, { wrapper: createWrapper() })

    expect(view.getByText((text) => text.includes('Products'))).toBeInTheDocument()
  })

  it('shows error on fetch failure', () => {
    mockedUseCollectionByIdentifier.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Not found'),
    } as never)

    const view = render(<EntryCreate />, { wrapper: createWrapper() })

    expect(view.getByText('Failed to load collection. Please try again.')).toBeInTheDocument()
  })

  it('shows back to entries link', () => {
    mockedUseCollectionByIdentifier.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as never)

    const view = render(<EntryCreate />, { wrapper: createWrapper() })

    expect(view.getAllByText('Back to Entries').length).toBeGreaterThan(0)
  })
})
