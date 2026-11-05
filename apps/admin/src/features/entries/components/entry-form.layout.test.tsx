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

  it('detects version conflict when form is dirty and newer version arrives from server', async () => {
    const baseEntry = {
      id: 'entry-1',
      collectionId: 'collection-1',
      slug: 'entry-1',
      status: 'draft' as const,
      version: 2,
      data: { title: 'Server title v2' },
      createdAt: '2026-01-10T00:00:00.000Z',
      updatedAt: '2026-01-11T00:00:00.000Z',
    }

    const collection = {
      id: 'collection-1',
      name: 'Articles',
      slug: 'articles',
      singleton: false,
      defaultLocale: 'en',
      supportedLocales: ['en'],
      fields: [{ name: 'title', type: 'text' as const, required: true, localizable: false }],
    }

    const { rerender, getByTestId, getByRole, getByText, queryByTestId } = render(
      <EntryForm mode='edit' entry={baseEntry} collection={collection} />,
      { wrapper: createWrapper() }
    )

    // User edits the form making it dirty
    fireEvent.change(getByTestId('field-title'), { target: { value: 'Local dirty title' } })

    // No conflict initially
    expect(queryByTestId('version-conflict-banner')).toBeNull()

    // Server refetch brings in version 3 while form is dirty
    rerender(
      <EntryForm
        mode='edit'
        entry={{
          ...baseEntry,
          version: 3,
          data: { title: 'Server title v3 from collaborator' },
        }}
        collection={collection}
      />
    )

    // Conflict banner must now be visible
    expect(getByTestId('version-conflict-banner')).toBeInTheDocument()
    expect(
      getByText(/A newer version of this entry exists on the server/)
    ).toBeInTheDocument()

    // Normal save button is disabled to prevent accidental blind overwrite
    expect(getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('allows discarding local dirty changes to reload remote server version on conflict', async () => {
    const baseEntry = {
      id: 'entry-1',
      collectionId: 'collection-1',
      slug: 'entry-1',
      status: 'draft' as const,
      version: 2,
      data: { title: 'Server title v2' },
      createdAt: '2026-01-10T00:00:00.000Z',
      updatedAt: '2026-01-11T00:00:00.000Z',
    }

    const collection = {
      id: 'collection-1',
      name: 'Articles',
      slug: 'articles',
      singleton: false,
      defaultLocale: 'en',
      supportedLocales: ['en'],
      fields: [{ name: 'title', type: 'text' as const, required: true, localizable: false }],
    }

    const { rerender, getByTestId, getByRole, queryByTestId } = render(
      <EntryForm mode='edit' entry={baseEntry} collection={collection} />,
      { wrapper: createWrapper() }
    )

    // Dirty the form
    fireEvent.change(getByTestId('field-title'), { target: { value: 'Local dirty edit' } })

    // Newer remote version arrives
    rerender(
      <EntryForm
        mode='edit'
        entry={{
          ...baseEntry,
          version: 3,
          data: { title: 'Server title v3 from collaborator' },
        }}
        collection={collection}
      />
    )

    expect(getByTestId('version-conflict-banner')).toBeInTheDocument()

    // Click Discard Local Changes
    fireEvent.click(getByTestId('conflict-discard-button'))

    // Banner dismissed and field reset to server version
    expect(queryByTestId('version-conflict-banner')).toBeNull()
    expect((getByTestId('field-title') as HTMLInputElement).value).toBe(
      'Server title v3 from collaborator'
    )
    expect(getByRole('button', { name: 'Save' })).not.toBeDisabled()
  })

  it('allows force overwriting the server version when in conflict state', async () => {
    mockUpdateEntryMutateAsync.mockResolvedValueOnce({
      id: 'entry-1',
      version: 4,
      slug: 'entry-1',
      status: 'draft',
      data: { title: 'Force overwrite title' },
    })

    const baseEntry = {
      id: 'entry-1',
      collectionId: 'collection-1',
      slug: 'entry-1',
      status: 'draft' as const,
      version: 2,
      data: { title: 'Server title v2' },
      createdAt: '2026-01-10T00:00:00.000Z',
      updatedAt: '2026-01-11T00:00:00.000Z',
    }

    const collection = {
      id: 'collection-1',
      name: 'Articles',
      slug: 'articles',
      singleton: false,
      defaultLocale: 'en',
      supportedLocales: ['en'],
      fields: [{ name: 'title', type: 'text' as const, required: true, localizable: false }],
    }

    const { rerender, getByTestId, queryByTestId } = render(
      <EntryForm mode='edit' entry={baseEntry} collection={collection} />,
      { wrapper: createWrapper() }
    )

    // User makes edits
    fireEvent.change(getByTestId('field-title'), { target: { value: 'Force overwrite title' } })

    // Remote v3 arrives
    rerender(
      <EntryForm
        mode='edit'
        entry={{
          ...baseEntry,
          version: 3,
          data: { title: 'Server title v3 from collaborator' },
        }}
        collection={collection}
      />
    )

    expect(getByTestId('version-conflict-banner')).toBeInTheDocument()

    // User chooses Force Overwrite
    fireEvent.click(getByTestId('conflict-overwrite-button'))

    await waitFor(() => {
      // Must submit with optimisticVersion: 3 (the remote version being overwritten)
      expect(mockUpdateEntryMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'entry-1',
          optimisticVersion: 3,
          input: expect.objectContaining({
            data: expect.objectContaining({
              title: 'Force overwrite title',
            }),
          }),
        })
      )
    })

    expect(queryByTestId('version-conflict-banner')).toBeNull()
  })

  it('silently accepts newer remote version without conflict when form is clean', async () => {
    const baseEntry = {
      id: 'entry-1',
      collectionId: 'collection-1',
      slug: 'entry-1',
      status: 'draft' as const,
      version: 2,
      data: { title: 'Server title v2' },
      createdAt: '2026-01-10T00:00:00.000Z',
      updatedAt: '2026-01-11T00:00:00.000Z',
    }

    const collection = {
      id: 'collection-1',
      name: 'Articles',
      slug: 'articles',
      singleton: false,
      defaultLocale: 'en',
      supportedLocales: ['en'],
      fields: [{ name: 'title', type: 'text' as const, required: true, localizable: false }],
    }

    const { rerender, queryByTestId, getByRole, getByTestId } = render(
      <EntryForm mode='edit' entry={baseEntry} collection={collection} />,
      { wrapper: createWrapper() }
    )

    // Form is not dirty! Server pushes version 3
    rerender(
      <EntryForm
        mode='edit'
        entry={{
          ...baseEntry,
          version: 3,
          data: { title: 'Server title v3' },
        }}
        collection={collection}
      />
    )

    // No conflict banner should be shown
    expect(queryByTestId('version-conflict-banner')).toBeNull()

    // Subsequent user edit and save should use version 3
    fireEvent.change(getByTestId('field-title'), { target: { value: 'New edit after clean sync' } })
    fireEvent.click(getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(mockUpdateEntryMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'entry-1',
          optimisticVersion: 3,
        })
      )
    })
  })
})

describe('EntryForm status header (OF-05)', () => {
  const statusEntry = {
    id: 'entry-of05',
    collectionId: 'collection-1',
    slug: 'of05-entry',
    status: 'scheduled' as const,
    publishAt: '2026-12-01T09:00:00.000Z',
    version: 3,
    data: { title: 'Scheduled title' },
    createdAt: '2026-01-10T00:00:00.000Z',
    updatedAt: '2026-01-11T00:00:00.000Z',
  }
  const statusCollection = {
    id: 'collection-1',
    name: 'Articles',
    slug: 'articles',
    singleton: false,
    defaultLocale: 'en',
    supportedLocales: ['en'],
    fields: [{ name: 'title', type: 'text', required: true, localizable: false }],
  }

  afterEach(async () => {
    cleanup()
    vi.clearAllMocks()
    const { db } = await import('@/features/sync/local-db')
    await db.commandQueue.clear()
  })

  beforeEach(() => {
    mockUpdateEntryMutateAsync.mockResolvedValue({ ...statusEntry, version: 4 })
  })

  it('shows lifecycle, scheduled time and saved/unsaved state, and clears unsaved after save', async () => {
    const view = render(<EntryForm mode='edit' entry={statusEntry} collection={statusCollection} />, {
      wrapper: createWrapper(),
    })

    const indicator = view.getByTestId('entry-status-indicator')
    expect(indicator.getAttribute('data-lifecycle')).toBe('scheduled')
    expect(view.getByTestId('entry-status-schedule').querySelector('time')?.getAttribute('datetime')).toBe(
      statusEntry.publishAt
    )
    expect(view.getByTestId('entry-status-sync').textContent).toBe('Saved')

    fireEvent.change(view.getByTestId('field-title'), { target: { value: 'Edited title' } })
    await waitFor(() => expect(view.getByTestId('entry-status-sync').textContent).toBe('Unsaved changes'))

    fireEvent.click(view.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mockUpdateEntryMutateAsync).toHaveBeenCalled())
    await waitFor(() => expect(view.getByTestId('entry-status-sync').textContent).toBe('Saved'))
  })

  it('shows a queued marker when the offline command queue holds unsynced commands for this entry', async () => {
    const { db } = await import('@/features/sync/local-db')
    await db.commandQueue.add({
      envelope: { type: 'updateEntry', payload: { entryId: statusEntry.id, data: {} } },
      tenantSlug: null,
      status: 'pending',
      createdAt: new Date().toISOString(),
    })

    const view = render(<EntryForm mode='edit' entry={statusEntry} collection={statusCollection} />, {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(view.getByTestId('entry-status-sync').textContent).toBe('Queued offline'))
    expect(
      view.getByRole('group', { name: /1 change queued offline, not yet synced/ })
    ).toBeTruthy()
  })

  it('keeps save/publish/schedule as keyboard-reachable buttons and exposes the schedule panel state', async () => {
    const view = render(<EntryForm mode='edit' entry={statusEntry} collection={statusCollection} />, {
      wrapper: createWrapper(),
    })

    const actions = view.getByRole('group', { name: 'Entry actions' })
    for (const name of ['Schedule', 'Publish', 'Save']) {
      const button = view.getByRole('button', { name })
      expect(actions.contains(button)).toBe(true)
      expect(button.getAttribute('tabindex')).not.toBe('-1')
      expect((button as HTMLButtonElement).disabled).toBe(false)
    }

    const toggle = view.getByTestId('schedule-toggle')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.getAttribute('aria-controls')).toBe('entry-scheduling-panel')
    fireEvent.click(toggle)
    await waitFor(() => expect(toggle.getAttribute('aria-expanded')).toBe('true'))
    expect(document.getElementById('entry-scheduling-panel')).toBeTruthy()
  })
})
