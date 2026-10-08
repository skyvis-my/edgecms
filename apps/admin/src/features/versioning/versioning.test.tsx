import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { EntryVersion, VersionDiff as VersionDiffType } from './api'

const mockedEdenGet = vi.fn()

vi.mock('@/lib/eden-client', () => ({
  edenGet: mockedEdenGet,
  edenPost: vi.fn(),
  edenPut: vi.fn(),
  edenDelete: vi.fn(),
}))

// Dynamic imports to bypass cache
const { VersionDiff } = await import(`./components/version-diff?bypass=${Date.now()}`)
const { VersionHistory } = await import(`./components/version-history?bypass=${Date.now()}`)

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
      mutations: { retry: false },
    },
  })

const mockVersions: EntryVersion[] = [
  {
    id: 'v3',
    entryId: 'entry1',
    version: 3,
    data: { title: 'Version 3' },
    slug: 'test-entry',
    status: 'published',
    createdAt: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
    createdBy: 'user@example.com',
    changeSummary: 'Updated title',
  },
  {
    id: 'v2',
    entryId: 'entry1',
    version: 2,
    data: { title: 'Version 2' },
    slug: 'test-entry',
    status: 'draft',
    createdAt: new Date(Date.now() - 7200000).toISOString(), // 2 hours ago
    createdBy: 'user@example.com',
  },
  {
    id: 'v1',
    entryId: 'entry1',
    version: 1,
    data: { title: 'Version 1' },
    slug: 'test-entry',
    status: 'draft',
    createdAt: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
    createdBy: 'admin@example.com',
  },
]

const mockDiffs: VersionDiffType[] = [
  {
    field: 'title',
    before: 'Version 1',
    after: 'Version 2',
    action: 'update',
  },
  {
    field: 'status',
    before: 'draft',
    after: 'published',
    action: 'update',
  },
  {
    field: 'newField',
    before: null,
    after: 'New value',
    action: 'add',
  },
]

describe('VersionHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders version list with timestamps and version numbers', async () => {
    mockedEdenGet.mockResolvedValue({
      data: mockVersions,
      meta: {
        pagination: {
          total: 3,
          page: 1,
          perPage: 10,
          hasMore: false,
        },
      },
    })

    const queryClient = createTestQueryClient()

    render(
      <QueryClientProvider client={queryClient}>
        <VersionHistory entryId='entry1' currentVersion={3} isOpen={true} onToggle={vi.fn()} />
      </QueryClientProvider>
    )

    await waitFor(() => {
      expect(screen.getByText('Version 3')).toBeInTheDocument()
      expect(screen.getByText('Version 2')).toBeInTheDocument()
      expect(screen.getByText('Version 1')).toBeInTheDocument()
    })

    expect(screen.getByText('Current')).toBeInTheDocument()
    const userEmails = screen.getAllByText('user@example.com')
    expect(userEmails.length).toBeGreaterThan(0)
    expect(screen.getByText('Updated title')).toBeInTheDocument()
  })

  it('shows "Load More" button when there are more pages', async () => {
    mockedEdenGet.mockResolvedValue({
      data: mockVersions.slice(0, 2),
      meta: {
        pagination: {
          total: 3,
          page: 1,
          perPage: 2,
          hasMore: true,
        },
      },
    })

    const queryClient = createTestQueryClient()

    render(
      <QueryClientProvider client={queryClient}>
        <VersionHistory entryId='entry1' currentVersion={3} isOpen={true} onToggle={vi.fn()} />
      </QueryClientProvider>
    )

    await waitFor(() => {
      expect(screen.getByText('Load More')).toBeInTheDocument()
    })
  })

  it('allows selecting two versions for comparison', async () => {
    mockedEdenGet.mockResolvedValue({
      data: mockVersions,
      meta: {
        pagination: {
          total: 3,
          page: 1,
          perPage: 10,
          hasMore: false,
        },
      },
    })

    const onDiffRequest = vi.fn()
    const queryClient = createTestQueryClient()

    render(
      <QueryClientProvider client={queryClient}>
        <VersionHistory
          entryId='entry1'
          currentVersion={3}
          isOpen={true}
          onToggle={vi.fn()}
          onDiffRequest={onDiffRequest}
        />
      </QueryClientProvider>
    )

    await waitFor(() => {
      expect(screen.getByText('Version 3')).toBeInTheDocument()
    })

    const radioButtons = screen.getAllByRole('radio')
    await userEvent.click(radioButtons[0])
    await userEvent.click(radioButtons[1])

    const compareButton = screen.getByText('Compare')
    expect(compareButton).toBeInTheDocument()

    await userEvent.click(compareButton)
    expect(onDiffRequest).toHaveBeenCalledWith('v3', 'v2')
  })

  it('shows rollback button for non-current versions', async () => {
    mockedEdenGet.mockResolvedValue({
      data: mockVersions,
      meta: {
        pagination: {
          total: 3,
          page: 1,
          perPage: 10,
          hasMore: false,
        },
      },
    })

    const queryClient = createTestQueryClient()

    render(
      <QueryClientProvider client={queryClient}>
        <VersionHistory entryId='entry1' currentVersion={3} isOpen={true} onToggle={vi.fn()} />
      </QueryClientProvider>
    )

    await waitFor(() => {
      const rollbackButtons = screen.getAllByText('Rollback')
      expect(rollbackButtons).toHaveLength(2) // Version 2 and Version 1
    })
  })
})

describe('VersionDiff', () => {
  it('renders field-level changes with highlighting', () => {
    render(<VersionDiff diffs={mockDiffs} olderVersion={1} newerVersion={2} />)

    expect(screen.getByText('title')).toBeInTheDocument()
    expect(screen.getByText('status')).toBeInTheDocument()
    expect(screen.getByText('newField')).toBeInTheDocument()

    const updateBadges = screen.getAllByText('UPDATE')
    expect(updateBadges.length).toBe(2) // Two UPDATE actions
    expect(screen.getByText('ADD')).toBeInTheDocument()

    const versionLabels = screen.getAllByText(/Version [12]/)
    expect(versionLabels.length).toBeGreaterThan(0)
  })

  it('shows correct values for add, update, and remove actions', () => {
    const diffWithRemove: VersionDiffType[] = [
      {
        field: 'deletedField',
        before: 'Old value',
        after: null,
        action: 'remove',
      },
      ...mockDiffs,
    ]

    render(<VersionDiff diffs={diffWithRemove} olderVersion={1} newerVersion={2} />)

    expect(screen.getByText('REMOVE')).toBeInTheDocument()
    expect(screen.getByText('Old value')).toBeInTheDocument()
  })

  it('shows message when no changes detected', () => {
    render(<VersionDiff diffs={[]} olderVersion={1} newerVersion={2} />)

    expect(screen.getByText(/no changes detected/i)).toBeInTheDocument()
  })
})
