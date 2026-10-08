import '../../../test-utils/setup'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useCollectionByIdentifier } from '@/features/collections/api/collections-api'
import { useEntries } from './api/entries-api'
const { render } = await import('@testing-library/react')
const { cleanup } = await import('@testing-library/react')

let routeSearch: Record<string, unknown> = {}

vi.mock('@tanstack/react-router', () => {
  const navigateMock = vi.fn()

  return {
    Link: ({ children, ...props }: { children: ReactNode; to: string }) => (
      <a href={props.to}>{children}</a>
    ),
    useParams: vi
      .fn()
      .mockReturnValue({ tenantSlug: 'tenant-a', collectionId: 'test-collection-id' }),
    useNavigate: vi.fn().mockReturnValue(navigateMock),
    useLocation: vi.fn().mockReturnValue({ pathname: '/' }),
    getRouteApi: vi.fn().mockReturnValue({
      useSearch: () => routeSearch,
      useNavigate: () => navigateMock,
    }),
  }
})

vi.mock('@/features/collections/api/collections-api', () => ({
  useCollectionByIdentifier: vi.fn(),
}))

vi.mock('./api/entries-api', () => ({
  useEntries: vi.fn(),
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

vi.mock('./components/entries-delete-dialog', () => ({
  EntriesDeleteDialog: () => <div data-testid='entries-delete-dialog' />,
}))

vi.mock('@/hooks/use-dialog-state', () => ({
  default: () => [null, vi.fn()],
}))

const mockedUseCollectionByIdentifier = useCollectionByIdentifier
const mockedUseEntries = useEntries

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

async function renderEntries() {
  const { Entries } = await import('./index')
  return render(<Entries />, { wrapper: createWrapper() })
}

describe('Entries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    routeSearch = {}
  })

  afterEach(() => {
    cleanup()
  })

  it('renders loading state', async () => {
    mockedUseCollectionByIdentifier.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as never)
    mockedUseEntries.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as never)

    const view = await renderEntries()

    expect(view.getByText('Entries')).toBeInTheDocument()
    expect(view.getByText(/entries found/i)).toBeInTheDocument()
  })

  it('renders entries in a table with inline details and row actions when data is loaded', async () => {
    const mockCollection = {
      id: 'test-collection-id',
      name: 'Blog Posts',
      slug: 'blog-posts',
      singleton: false,
      fields: [
        { name: 'title', type: 'text', required: true, localizable: false },
        { name: 'summary', type: 'text', required: false, localizable: false },
      ],
      defaultLocale: 'en',
      supportedLocales: ['en'],
    }
    const mockEntries = {
      data: [
        {
          id: 'e1',
          collectionId: 'test-collection-id',
          slug: 'entry-1',
          status: 'draft',
          version: 3,
          updatedAt: '2026-01-10T09:00:00.000Z',
          createdAt: '2026-01-09T09:00:00.000Z',
          data: { title: 'Entry 1 title', summary: 'Entry 1 summary' },
        },
        {
          id: 'e2',
          collectionId: 'test-collection-id',
          slug: 'entry-2',
          status: 'published',
          version: 4,
          updatedAt: '2026-01-11T09:00:00.000Z',
          createdAt: '2026-01-10T09:00:00.000Z',
          data: { title: 'Entry 2 title', summary: 'Entry 2 summary' },
        },
      ],
      meta: { pagination: { total: 2, page: 1, perPage: 100, hasMore: false } },
    }

    mockedUseCollectionByIdentifier.mockReturnValue({
      data: mockCollection,
      isLoading: false,
      error: null,
    } as never)
    mockedUseEntries.mockReturnValue({
      data: mockEntries,
      isLoading: false,
      error: null,
    } as never)

    const view = await renderEntries()

    expect(view.getByRole('table')).toBeInTheDocument()
    expect(view.getAllByText('entry-1').length).toBeGreaterThan(0)
    expect(view.getAllByText('entry-2').length).toBeGreaterThan(0)
    expect(view.getAllByText(/version/i)).toHaveLength(2)
    expect(view.getAllByRole('link', { name: /edit/i })).toHaveLength(2)
    expect(view.getAllByRole('button', { name: /delete/i })).toHaveLength(2)
    expect(view.getByText((text) => text.includes('Blog Posts'))).toBeInTheDocument()
  })

  it('shows create button when collection is loaded', async () => {
    const mockCollection = {
      id: 'test-collection-id',
      name: 'Blog Posts',
      slug: 'blog-posts',
    }

    mockedUseCollectionByIdentifier.mockReturnValue({
      data: mockCollection,
      isLoading: false,
      error: null,
    } as never)
    mockedUseEntries.mockReturnValue({
      data: {
        data: [{ id: 'e1', collectionId: 'test-collection-id', slug: 'entry-1', status: 'draft' }],
        meta: { pagination: { total: 1, page: 1, perPage: 20, hasMore: false } },
      },
      isLoading: false,
      error: null,
    } as never)

    const view = await renderEntries()

    expect(view.getByText('Create new entry')).toBeInTheDocument()
  })

  it('displays empty state when no entries', async () => {
    const mockCollection = {
      id: 'test-collection-id',
      name: 'Blog Posts',
      slug: 'blog-posts',
    }

    mockedUseCollectionByIdentifier.mockReturnValue({
      data: mockCollection,
      isLoading: false,
      error: null,
    } as never)
    mockedUseEntries.mockReturnValue({
      data: { data: [], meta: { pagination: { total: 0, page: 1, perPage: 20, hasMore: false } } },
      isLoading: false,
      error: null,
    } as never)

    const view = await renderEntries()

    expect(view.getByText('No entries found.')).toBeInTheDocument()
  })

  it('displays error state on fetch failure', async () => {
    mockedUseCollectionByIdentifier.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Network error'),
    } as never)
    mockedUseEntries.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
    } as never)

    const view = await renderEntries()

    expect(view.getByText('Failed to load data. Please try again.')).toBeInTheDocument()
  })

  it('shows back to collections link', async () => {
    mockedUseCollectionByIdentifier.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as never)
    mockedUseEntries.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as never)

    const view = await renderEntries()

    expect(view.getByText('Back to Content Manager')).toBeInTheDocument()
  })

  it('passes URL search filters and pagination to entries query', async () => {
    routeSearch = { page: 2, pageSize: 20, status: ['published'] }

    mockedUseCollectionByIdentifier.mockReturnValue({
      data: {
        id: 'test-collection-id',
        name: 'Blog Posts',
        slug: 'blog-posts',
        fields: [],
      },
      isLoading: false,
      error: null,
    } as never)
    mockedUseEntries.mockReturnValue({
      data: { data: [], meta: { pagination: { total: 0, page: 2, perPage: 20, hasMore: false } } },
      isLoading: false,
      error: null,
    } as never)

    await renderEntries()

    expect(mockedUseEntries).toHaveBeenCalledWith({
      collectionId: 'test-collection-id',
      collectionSlug: 'test-collection-id',
      page: 2,
      perPage: 20,
      status: 'published',
    })
  })

  it('shows quick filters and create shortcut actions', async () => {
    mockedUseCollectionByIdentifier.mockReturnValue({
      data: {
        id: 'test-collection-id',
        name: 'Blog Posts',
        slug: 'blog-posts',
      },
      isLoading: false,
      error: null,
    } as never)
    mockedUseEntries.mockReturnValue({
      data: {
        data: [{ id: 'e1', collectionId: 'test-collection-id', slug: 'entry-1', status: 'draft' }],
        meta: { pagination: { total: 1, page: 1, perPage: 20, hasMore: false } },
      },
      isLoading: false,
      error: null,
    } as never)

    const view = await renderEntries()

    expect(view.getByRole('button', { name: /status/i })).toBeInTheDocument()
    expect(view.getByRole('link', { name: /create new entry/i })).toBeInTheDocument()
  })

  it('renders entries even when pagination metadata is missing', async () => {
    mockedUseCollectionByIdentifier.mockReturnValue({
      data: {
        id: 'test-collection-id',
        name: 'Blog Posts',
        slug: 'blog-posts',
      },
      isLoading: false,
      error: null,
    } as never)
    mockedUseEntries.mockReturnValue({
      data: {
        data: [{ id: 'e1', collectionId: 'test-collection-id', slug: 'entry-1', status: 'draft' }],
      },
      isLoading: false,
      error: null,
    } as never)

    const view = await renderEntries()

    expect(view.getAllByText('entry-1').length).toBeGreaterThan(0)
  })

  it('does not crash when entries list data is missing', async () => {
    mockedUseCollectionByIdentifier.mockReturnValue({
      data: {
        id: 'test-collection-id',
        name: 'Blog Posts',
        slug: 'blog-posts',
      },
      isLoading: false,
      error: null,
    } as never)
    mockedUseEntries.mockReturnValue({
      data: {
        meta: { pagination: { total: 0, page: 1, perPage: 20, hasMore: false } },
      },
      isLoading: false,
      error: null,
    } as never)

    const view = await renderEntries()

    expect(view.getByRole('table')).toBeInTheDocument()
  })
})
