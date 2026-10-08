import '../../../test-utils/setup'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { useCollectionByIdentifier } from '@/features/collections/api/collections-api'
import { useEntryByIdentifier } from './api/entries-api'
import { EntryEdit } from './entry-edit'

vi.mock('@tanstack/react-router', () => {
  return {
    Link: ({ children, ...props }: { children: ReactNode; to: string }) => (
      <a href={props.to}>{children}</a>
    ),
    useParams: vi.fn().mockReturnValue({
      tenantSlug: 'tenant-a',
      collectionId: 'test-collection-id',
      entryId: 'test-entry-id',
    }),
    useNavigate: vi.fn().mockReturnValue(vi.fn()),
  }
})

vi.mock('@/features/collections/api/collections-api', () => ({
  useCollectionByIdentifier: vi.fn(),
}))

vi.mock('./api/entries-api', () => ({
  useEntryByIdentifier: vi.fn(),
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
const mockedUseEntryByIdentifier = useEntryByIdentifier

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('EntryEdit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('renders loading state', () => {
    mockedUseCollectionByIdentifier.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as never)
    mockedUseEntryByIdentifier.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as never)

    const view = render(<EntryEdit />, { wrapper: createWrapper() })

    expect(view.getByText((text) => text.includes('Edit Entry'))).toBeInTheDocument()
    expect(view.getByText((text) => text.includes('Edit Entry'))).toBeInTheDocument()
  })

  it('renders with existing entry data', () => {
    const mockCollection = {
      id: 'test-collection-id',
      name: 'Blog Posts',
      slug: 'blog-posts',
      singleton: false,
      fields: [],
      defaultLocale: 'en',
      supportedLocales: ['en'],
    }
    const mockEntry = {
      id: 'test-entry-id',
      collectionId: 'test-collection-id',
      slug: 'test-entry',
      status: 'draft',
      data: { title: 'Test Entry' },
      version: 1,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-10',
    }

    mockedUseCollectionByIdentifier.mockReturnValue({
      data: mockCollection,
      isLoading: false,
      error: null,
    } as never)
    mockedUseEntryByIdentifier.mockReturnValue({
      data: mockEntry,
      isLoading: false,
      error: null,
    } as never)

    const view = render(<EntryEdit />, { wrapper: createWrapper() })

    expect(view.getByText((text) => text.includes('Blog Posts'))).toBeInTheDocument()
  })

  it('shows error on fetch failure', () => {
    mockedUseCollectionByIdentifier.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Not found'),
    } as never)
    mockedUseEntryByIdentifier.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
    } as never)

    const view = render(<EntryEdit />, { wrapper: createWrapper() })

    expect(view.getByText('Failed to load data. Please try again.')).toBeInTheDocument()
  })

  it('shows error when entry fetch fails', () => {
    mockedUseCollectionByIdentifier.mockReturnValue({
      data: { id: 'c1', name: 'Blog Posts' },
      isLoading: false,
      error: null,
    } as never)
    mockedUseEntryByIdentifier.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Entry not found'),
    } as never)

    const view = render(<EntryEdit />, { wrapper: createWrapper() })

    expect(view.getByText('Failed to load data. Please try again.')).toBeInTheDocument()
  })

  it('shows back to entries link', () => {
    mockedUseCollectionByIdentifier.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as never)
    mockedUseEntryByIdentifier.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as never)

    const view = render(<EntryEdit />, { wrapper: createWrapper() })

    expect(view.getByText('Back to Entries')).toBeInTheDocument()
  })
})
