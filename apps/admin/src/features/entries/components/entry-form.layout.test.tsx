import '../../../../test-utils/setup'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
const { cleanup, fireEvent, render, waitFor } = await import('@testing-library/react')

const mockCreateEntryMutateAsync = vi.fn()
const mockUpdateEntryMutateAsync = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  useNavigate: vi.fn().mockReturnValue(vi.fn()),
}))

vi.mock('@/features/tenants/api', () => ({
  useCurrentTenantSlug: vi.fn().mockReturnValue({ data: 'tenant-a' }),
}))

vi.mock('../api/entries-api', () => ({
  useCreateEntry: vi.fn().mockReturnValue({ mutateAsync: mockCreateEntryMutateAsync }),
  useUpdateEntry: vi.fn().mockReturnValue({ mutateAsync: mockUpdateEntryMutateAsync }),
  usePublishEntry: vi.fn().mockReturnValue({ mutateAsync: vi.fn(), isPending: false }),
  useUnpublishEntry: vi.fn().mockReturnValue({ mutateAsync: vi.fn(), isPending: false }),
  useSchedulePublish: vi.fn().mockReturnValue({ mutateAsync: vi.fn(), isPending: false }),
  useScheduleUnpublish: vi.fn().mockReturnValue({ mutateAsync: vi.fn(), isPending: false }),
  useCancelSchedule: vi.fn().mockReturnValue({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('@/features/commands/use-execute-command', () => ({
  useDryRunCommand: vi.fn().mockReturnValue({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('@/features/commands/components/diff-preview', () => ({
  DiffPreview: ({ open }: { open: boolean }) => (
    <div data-testid='diff-preview'>{String(open)}</div>
  ),
}))

vi.mock('./field-renderer', () => ({
  FieldRenderer: ({
    field,
    value,
    onChange,
  }: {
    field: { name: string }
    value: unknown
    onChange: (value: unknown) => void
  }) => (
    <input
      data-testid={`field-${field.name}`}
      value={typeof value === 'string' ? value : ''}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}))

vi.mock('./locale-switcher', () => ({
  LocaleSwitcher: ({ children }: { children?: ReactNode }) => (
    <div data-testid='locale-switcher'>{children}</div>
  ),
}))

vi.mock('@/components/ui/select', () => ({
  Select: ({ children, disabled }: { children?: ReactNode; disabled?: boolean }) => (
    <div data-testid='entry-status-select-root' data-disabled={String(Boolean(disabled))}>
      {children}
    </div>
  ),
  SelectContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children, ...props }: { children?: ReactNode }) => (
    <button type='button' {...props}>
      {children}
    </button>
  ),
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
}))

const { EntryForm } = await import(`./entry-form?bypass=${Date.now()}`)

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('EntryForm layout', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  beforeEach(() => {
    mockCreateEntryMutateAsync.mockResolvedValue({})
    mockUpdateEntryMutateAsync.mockResolvedValue({})
  })

  it('renders a dedicated two-column content editor layout', () => {
    const view = render(
      <EntryForm
        mode='edit'
        entry={{
          id: 'entry-1',
          collectionId: 'collection-1',
          slug: 'entry-1',
          status: 'draft',
          version: 2,
          data: {
            title: 'Sample title',
            summary: 'Sample summary',
            body: 'Long body',
          },
          createdAt: '2026-01-10T00:00:00.000Z',
          updatedAt: '2026-01-11T00:00:00.000Z',
        }}
        collection={{
          id: 'collection-1',
          name: 'Articles',
          slug: 'articles',
          singleton: false,
          defaultLocale: 'en',
          supportedLocales: ['en'],
          fields: [
            { name: 'title', type: 'text', required: true, localizable: false },
            { name: 'summary', type: 'text', required: false, localizable: false },
            { name: 'body', type: 'richtext', required: false, localizable: false },
          ],
        }}
      />,
      { wrapper: createWrapper() }
    )

    const layout = view.getByTestId('entry-content-layout')
    expect(layout.className).toContain('lg:grid-cols-2')
  })

  it('keeps manual slug and does not override from title once slug has value', () => {
    const view = render(
      <EntryForm
        mode='create'
        collection={{
          id: 'collection-1',
          name: 'Articles',
          slug: 'articles',
          singleton: false,
          defaultLocale: 'en',
          supportedLocales: ['en'],
          fields: [{ name: 'title', type: 'text', required: true, localizable: false }],
        }}
      />,
      { wrapper: createWrapper() }
    )

    fireEvent.change(view.getByLabelText('Slug'), { target: { value: 'My Manual Slug' } })
    expect((view.getByLabelText('Slug') as HTMLInputElement).value).toBe('My Manual Slug')

    fireEvent.change(view.getByTestId('field-title'), { target: { value: 'New Title Here' } })
    expect((view.getByLabelText('Slug') as HTMLInputElement).value).toBe('My Manual Slug')
  })

  it('keeps lifecycle status read-only in the content editor', () => {
    const view = render(
      <EntryForm
        mode='edit'
        entry={{
          id: 'entry-1',
          collectionId: 'collection-1',
          slug: 'entry-1',
          status: 'published',
          version: 2,
          data: { title: 'Sample title' },
          createdAt: '2026-01-10T00:00:00.000Z',
          updatedAt: '2026-01-11T00:00:00.000Z',
        }}
        collection={{
          id: 'collection-1',
          name: 'Articles',
          slug: 'articles',
          singleton: false,
          defaultLocale: 'en',
          supportedLocales: ['en'],
          fields: [{ name: 'title', type: 'text', required: true, localizable: false }],
        }}
      />,
      { wrapper: createWrapper() }
    )

    expect(view.getByTestId('entry-status-select-root').getAttribute('data-disabled')).toBe('true')
  })

  it('shows an autosave conflict warning before saving over a newer draft', () => {
    const view = render(
      <EntryForm
        mode='edit'
        entry={{
          id: 'entry-1',
          collectionId: 'collection-1',
          slug: 'entry-1',
          status: 'draft',
          version: 2,
          serverDraftVersion: 3,
          data: { title: 'Sample title' },
          createdAt: '2026-01-10T00:00:00.000Z',
          updatedAt: '2026-01-11T00:00:00.000Z',
        }}
        collection={{
          id: 'collection-1',
          name: 'Articles',
          slug: 'articles',
          singleton: false,
          defaultLocale: 'en',
          supportedLocales: ['en'],
          fields: [{ name: 'title', type: 'text', required: true, localizable: false }],
        }}
      />,
      { wrapper: createWrapper() }
    )

    expect(view.getByText(/Review the latest version before saving/)).toBeTruthy()
  })

  it('saves content with optimistic version and no lifecycle status', async () => {
    const view = render(
      <EntryForm
        mode='edit'
        entry={{
          id: 'entry-1',
          collectionId: 'collection-1',
          slug: 'entry-1',
          status: 'published',
          version: 2,
          data: { title: 'Sample title' },
          createdAt: '2026-01-10T00:00:00.000Z',
          updatedAt: '2026-01-11T00:00:00.000Z',
        }}
        collection={{
          id: 'collection-1',
          name: 'Articles',
          slug: 'articles',
          singleton: false,
          defaultLocale: 'en',
          supportedLocales: ['en'],
          fields: [{ name: 'title', type: 'text', required: true, localizable: false }],
        }}
      />,
      { wrapper: createWrapper() }
    )

    fireEvent.change(view.getByTestId('field-title'), { target: { value: 'Updated title' } })
    fireEvent.click(view.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(mockUpdateEntryMutateAsync).toHaveBeenCalledWith({
        id: 'entry-1',
        input: expect.not.objectContaining({ status: expect.any(String) }),
        optimisticVersion: 2,
      })
    })
  })

  it('renders schedule button and opens scheduling panel with datetime pickers (C-07)', () => {
    const view = render(
      <EntryForm
        mode='edit'
        entry={{
          id: 'entry-1',
          collectionId: 'collection-1',
          slug: 'entry-1',
          status: 'draft',
          version: 2,
          data: { title: 'Sample title' },
          createdAt: '2026-01-10T00:00:00.000Z',
          updatedAt: '2026-01-11T00:00:00.000Z',
        }}
        collection={{
          id: 'collection-1',
          name: 'Articles',
          slug: 'articles',
          singleton: false,
          defaultLocale: 'en',
          supportedLocales: ['en'],
          fields: [{ name: 'title', type: 'text', required: true, localizable: false }],
        }}
      />,
      { wrapper: createWrapper() }
    )

    const scheduleBtn = view.getByRole('button', { name: /Schedule/i })
    expect(scheduleBtn).toBeInTheDocument()

    fireEvent.click(scheduleBtn)
    expect(view.getByTestId('scheduling-panel')).toBeInTheDocument()
    expect(view.getByLabelText(/Publish Date & Time/i)).toBeInTheDocument()
  })

  it('triggers periodic draft auto-save when form is dirty (C-06)', async () => {
    vi.useFakeTimers()
    try {
      const view = render(
        <EntryForm
          mode='edit'
          entry={{
            id: 'entry-1',
            collectionId: 'collection-1',
            slug: 'entry-1',
            status: 'draft',
            version: 2,
            data: { title: 'Initial title' },
            createdAt: '2026-01-10T00:00:00.000Z',
            updatedAt: '2026-01-11T00:00:00.000Z',
          }}
          collection={{
            id: 'collection-1',
            name: 'Articles',
            slug: 'articles',
            singleton: false,
            defaultLocale: 'en',
            supportedLocales: ['en'],
            fields: [{ name: 'title', type: 'text', required: true, localizable: false }],
          }}
        />,
        { wrapper: createWrapper() }
      )

      fireEvent.change(view.getByTestId('field-title'), { target: { value: 'Dirty draft' } })

      vi.advanceTimersByTime(30_000)

      expect(mockUpdateEntryMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'entry-1',
          optimisticVersion: 2,
        })
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('updates optimistic version after autosave so manual save uses latest version', async () => {
    vi.useFakeTimers()
    try {
      mockUpdateEntryMutateAsync.mockResolvedValueOnce({
        id: 'entry-1',
        version: 3,
        slug: 'entry-1',
        status: 'draft',
        data: { title: 'Dirty draft' },
      })

      const view = render(
        <EntryForm
          mode='edit'
          entry={{
            id: 'entry-1',
            collectionId: 'collection-1',
            slug: 'entry-1',
            status: 'draft',
            version: 2,
            data: { title: 'Initial title' },
            createdAt: '2026-01-10T00:00:00.000Z',
            updatedAt: '2026-01-11T00:00:00.000Z',
          }}
          collection={{
            id: 'collection-1',
            name: 'Articles',
            slug: 'articles',
            singleton: false,
            defaultLocale: 'en',
            supportedLocales: ['en'],
            fields: [{ name: 'title', type: 'text', required: true, localizable: false }],
          }}
        />,
        { wrapper: createWrapper() }
      )

      fireEvent.change(view.getByTestId('field-title'), { target: { value: 'Dirty draft' } })
      vi.advanceTimersByTime(30_000)
      await Promise.resolve()
      await Promise.resolve()

      expect(mockUpdateEntryMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'entry-1',
          optimisticVersion: 2,
        })
      )

      // Next, user manually saves after typing more
      fireEvent.change(view.getByTestId('field-title'), { target: { value: 'Dirty draft 2' } })
      fireEvent.click(view.getByRole('button', { name: 'Save' }))

      await waitFor(() => {
        expect(mockUpdateEntryMutateAsync).toHaveBeenLastCalledWith(
          expect.objectContaining({
            id: 'entry-1',
            optimisticVersion: 3,
          })
        )
      })
    } finally {
      vi.useRealTimers()
    }
  })
})
