import { describe, expect, it, vi } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { PublishActions } from './components/publish-actions'
import { SchedulePicker } from './components/schedule-picker'
import { StatusBadge } from './components/status-badge'
import { PublishingOverview } from './pages/overview'

if (typeof DocumentFragment === 'undefined') {
  ;(globalThis as { DocumentFragment?: typeof DocumentFragment }).DocumentFragment =
    class DocumentFragment {}
}

// Mock useExecuteCommand
vi.mock('@/features/commands/use-execute-command', () => ({
  useExecuteCommand: () => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  }),
}))

const mockUseCollections = vi.fn()
const mockUseEntries = vi.fn()

vi.mock('@/features/collections/api/collections-api', () => ({
  useCollections: () => mockUseCollections(),
}))

vi.mock('@/features/entries/api/entries-api', () => ({
  useEntries: () => mockUseEntries(),
}))

vi.mock('@/components/config-drawer', () => ({
  ConfigDrawer: () => null,
}))

vi.mock('@/components/layout/header', () => ({
  Header: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/layout/main', () => ({
  Main: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}))

vi.mock('@/components/profile-dropdown', () => ({
  ProfileDropdown: () => null,
}))

vi.mock('@/components/search', () => ({
  Search: () => null,
}))

vi.mock('@/components/theme-switch', () => ({
  ThemeSwitch: () => null,
}))

vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: ReactNode }) => (
    <button type='button'>{children}</button>
  ),
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: ReactNode; value: string }) => <div>{children}</div>,
}))

describe('StatusBadge', () => {
  it('renders draft status with gray color', () => {
    render(<StatusBadge status='draft' />)
    const badge = screen.getByText('Draft')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveClass('border-gray-500')
  })

  it('renders published status with green color', () => {
    render(<StatusBadge status='published' />)
    const badge = screen.getByText('Published')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveClass('border-green-500')
  })

  it('renders scheduled status with blue color', () => {
    render(<StatusBadge status='scheduled' />)
    const badge = screen.getByText('Scheduled')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveClass('border-blue-500')
  })

  it('renders archived status with yellow color', () => {
    render(<StatusBadge status='archived' />)
    const badge = screen.getByText('Archived')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveClass('border-yellow-500')
  })

  it('shows scheduled date for scheduled status', () => {
    const scheduledDate = new Date('2026-03-15T10:30:00Z')
    render(<StatusBadge status='scheduled' scheduledDate={scheduledDate.toISOString()} />)

    expect(screen.getByText('Scheduled')).toBeInTheDocument()
    const relativeTime = screen.getByText(/in|ago/)
    expect(relativeTime).toBeInTheDocument()
    expect(relativeTime).toHaveAttribute('title', expect.stringMatching(/^2026-03-15 /))
  })

  it('does not show date for non-scheduled status', () => {
    render(<StatusBadge status='draft' scheduledDate={null} />)
    // Should have the badge but no date element
    expect(screen.getByText('Draft')).toBeInTheDocument()
    expect(
      screen.queryByText(/Mar|Jan|Feb|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/)
    ).not.toBeInTheDocument()
  })
})

describe('SchedulePicker', () => {
  it('renders publish at and unpublish at pickers', () => {
    const mockOnPublishAtChange = vi.fn()
    const mockOnUnpublishAtChange = vi.fn()

    render(
      <SchedulePicker
        publishAt={null}
        unpublishAt={null}
        onPublishAtChange={mockOnPublishAtChange}
        onUnpublishAtChange={mockOnUnpublishAtChange}
      />
    )

    expect(screen.getByText('Scheduling')).toBeInTheDocument()
    expect(screen.getByLabelText('Publish At')).toBeInTheDocument()
    expect(screen.getByLabelText('Unpublish At (Optional)')).toBeInTheDocument()
  })

  it('displays selected publish date', () => {
    const publishDate = new Date('2026-03-15T10:30:00Z')
    const mockOnPublishAtChange = vi.fn()
    const mockOnUnpublishAtChange = vi.fn()

    render(
      <SchedulePicker
        publishAt={publishDate}
        unpublishAt={null}
        onPublishAtChange={mockOnPublishAtChange}
        onUnpublishAtChange={mockOnUnpublishAtChange}
      />
    )

    // Check for formatted date in button
    expect(screen.getByText(/Mar 15, 2026/)).toBeInTheDocument()
  })

  it('calls onPublishAtChange when clear button is clicked', async () => {
    const user = userEvent.setup()
    const publishDate = new Date('2026-03-15T10:30:00Z')
    const mockOnPublishAtChange = vi.fn()
    const mockOnUnpublishAtChange = vi.fn()

    render(
      <SchedulePicker
        publishAt={publishDate}
        unpublishAt={null}
        onPublishAtChange={mockOnPublishAtChange}
        onUnpublishAtChange={mockOnUnpublishAtChange}
      />
    )

    // Find the clear button by its small size and ghost variant
    const buttons = screen.getAllByRole('button')
    // The clear button is small and contains an X icon, should be after the label
    const clearButton = buttons.find(
      (btn) => btn.className.includes('h-6') && btn.className.includes('px-2')
    )

    if (clearButton) {
      await user.click(clearButton)
      await waitFor(() => {
        expect(mockOnPublishAtChange).toHaveBeenCalledWith(null)
      })
    }
  })

  it('disables inputs when disabled prop is true', () => {
    const mockOnPublishAtChange = vi.fn()
    const mockOnUnpublishAtChange = vi.fn()

    const { container } = render(
      <SchedulePicker
        publishAt={null}
        unpublishAt={null}
        onPublishAtChange={mockOnPublishAtChange}
        onUnpublishAtChange={mockOnUnpublishAtChange}
        disabled={true}
      />
    )

    // Check that time inputs (type="time") are disabled
    const timeInputs = container.querySelectorAll('input[type="time"]')
    for (const input of timeInputs) {
      expect(input).toBeDisabled()
    }

    // Check that date picker buttons are also disabled
    const dateButtons = screen
      .getAllByRole('button')
      .filter((btn) => btn.textContent?.includes('Pick a date'))
    for (const button of dateButtons) {
      expect(button).toBeDisabled()
    }
  })
})

describe('PublishActions', () => {
  it('shows Publish Now and Schedule buttons for draft status', () => {
    const publishDate = new Date('2026-03-15T10:30:00Z')

    render(
      <PublishActions
        entryId='entry-123'
        collectionSlug='posts'
        currentStatus='draft'
        publishAt={publishDate}
      />
    )

    expect(screen.getByText('Publish Now')).toBeInTheDocument()
    expect(screen.getByText('Schedule')).toBeInTheDocument()
  })

  it('shows Publish Now and Cancel Schedule buttons for scheduled status', () => {
    render(
      <PublishActions
        entryId='entry-123'
        collectionSlug='posts'
        currentStatus='scheduled'
        publishAt={null}
      />
    )

    expect(screen.getByText('Publish Now')).toBeInTheDocument()
    expect(screen.getByText('Cancel Schedule')).toBeInTheDocument()
  })

  it('shows Unpublish button for published status', () => {
    render(
      <PublishActions
        entryId='entry-123'
        collectionSlug='posts'
        currentStatus='published'
        unpublishAt={null}
      />
    )

    expect(screen.getByText('Unpublish')).toBeInTheDocument()
  })

  it('shows Revert to Draft button for archived status', () => {
    render(
      <PublishActions
        entryId='entry-123'
        collectionSlug='posts'
        currentStatus='archived'
        publishAt={null}
      />
    )

    expect(screen.getByText('Revert to Draft')).toBeInTheDocument()
  })

  it('shows confirmation dialog when action button is clicked', async () => {
    const user = userEvent.setup()

    render(
      <PublishActions
        entryId='entry-123'
        collectionSlug='posts'
        currentStatus='draft'
        publishAt={null}
      />
    )

    const publishButton = screen.getByText('Publish Now')
    await user.click(publishButton)

    // Confirmation dialog should appear
    await waitFor(() => {
      expect(screen.getByText('Publish Entry Now')).toBeInTheDocument()
      expect(
        screen.getByText('Are you sure you want to publish this entry immediately?')
      ).toBeInTheDocument()
    })
  })

  it('closes dialog when cancel is clicked', async () => {
    const user = userEvent.setup()

    render(
      <PublishActions
        entryId='entry-123'
        collectionSlug='posts'
        currentStatus='draft'
        publishAt={null}
      />
    )

    const publishButton = screen.getByText('Publish Now')
    await user.click(publishButton)

    await waitFor(() => {
      expect(screen.getByText('Publish Entry Now')).toBeInTheDocument()
    })

    const cancelButton = screen.getByText('Cancel')
    await user.click(cancelButton)

    await waitFor(() => {
      expect(screen.queryByText('Publish Entry Now')).not.toBeInTheDocument()
    })
  })

  it('disables buttons when disabled prop is true', () => {
    render(
      <PublishActions
        entryId='entry-123'
        collectionSlug='posts'
        currentStatus='draft'
        publishAt={null}
        disabled={true}
      />
    )

    const publishButton = screen.getByText('Publish Now')
    expect(publishButton).toBeDisabled()
  })
})

describe('PublishingOverview', () => {
  it('renders collection filter options from collections list', async () => {
    mockUseCollections.mockReturnValue({
      data: [
        {
          id: 'col-1',
          name: 'Posts',
          slug: 'posts',
          singleton: false,
          fields: [],
          defaultLocale: 'en',
          supportedLocales: ['en'],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      isLoading: false,
    })

    mockUseEntries.mockReturnValue({
      data: { data: [], meta: { pagination: { total: 0, page: 1, perPage: 100, hasMore: false } } },
      isLoading: false,
      refetch: vi.fn(),
    })

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={queryClient}>
        <PublishingOverview />
      </QueryClientProvider>
    )

    await waitFor(() => {
      expect(screen.getByText('Posts')).toBeInTheDocument()
    })
  })
})
