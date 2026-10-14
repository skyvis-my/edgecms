import '../../../../test-utils/setup'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { EntryForm } from './entry-form'
import { EDGECMS_PREVIEW_MESSAGE_TYPE, EDGECMS_PREVIEW_READY_TYPE } from '@edgecms/client'

vi.mock('@tanstack/react-router', () => ({
  useNavigate: vi.fn().mockReturnValue(vi.fn()),
}))

vi.mock('@/stores/tenant-store', () => ({
  useTenantStore: vi.fn().mockImplementation((selector) =>
    selector ? selector({ tenantSlug: 'acme-test' }) : { tenantSlug: 'acme-test' }
  ),
}))

vi.mock('../api/entries-api', () => ({
  useCreateEntry: vi.fn().mockReturnValue({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateEntry: vi.fn().mockReturnValue({ mutateAsync: vi.fn(), isPending: false }),
  usePublishEntry: vi.fn().mockReturnValue({ mutateAsync: vi.fn(), isPending: false }),
  useUnpublishEntry: vi.fn().mockReturnValue({ mutateAsync: vi.fn(), isPending: false }),
  useSchedulePublish: vi.fn().mockReturnValue({ mutateAsync: vi.fn(), isPending: false }),
  useScheduleUnpublish: vi.fn().mockReturnValue({ mutateAsync: vi.fn(), isPending: false }),
  useCancelSchedule: vi.fn().mockReturnValue({ mutateAsync: vi.fn(), isPending: false }),
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
  LocaleSwitcher: () => <div data-testid='locale-switcher' />,
}))

const mockCollection = {
  id: 'col-1',
  name: 'Articles',
  slug: 'articles',
  singleton: false,
  defaultLocale: 'en',
  supportedLocales: ['en', 'fr'],
  fields: [
    { name: 'title', type: 'text', required: true, localizable: false },
    { name: 'body', type: 'richtext', required: false, localizable: false },
  ],
}

describe('EntryForm Live Split-Pane Draft Preview & PostMessage Bridge', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    cleanup()
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'mock-signed-hmac-token-123' }),
    }) as unknown as typeof globalThis.fetch
  })

  function renderForm() {
    return render(
      <QueryClientProvider client={queryClient}>
        <EntryForm
          collection={mockCollection}
          mode='create'
        />
      </QueryClientProvider>
    )
  }

  it('renders Live Preview toggle button', () => {
    renderForm()
    const toggleBtn = screen.getByTestId('live-preview-toggle')
    expect(toggleBtn).toBeDefined()
    expect(toggleBtn.textContent).toContain('Live Preview')
    expect(screen.queryByTestId('live-preview-pane')).toBeNull()
  })

  it('toggles live preview pane and embeds iframe pointing to target url with token', async () => {
    renderForm()
    const toggleBtn = screen.getByTestId('live-preview-toggle')
    fireEvent.click(toggleBtn)

    // Split-screen pane is now visible
    expect(screen.getByTestId('live-preview-pane')).toBeDefined()
    expect(toggleBtn.textContent).toContain('Hide Preview')

    // Fetched ephemeral preview token and updated badge
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/tenants/acme-test/public/preview-token',
        expect.objectContaining({ method: 'POST' })
      )
      expect(screen.getByText('Token Signed')).toBeDefined()
    })

    // Iframe is rendered
    const iframe = screen.getByTestId('live-preview-iframe') as HTMLIFrameElement
    expect(iframe).toBeDefined()
    expect(iframe.src).toContain('http://localhost:3000/preview')
  })

  it('switches between responsive device widths (Desktop, Tablet, Mobile)', async () => {
    renderForm()
    fireEvent.click(screen.getByTestId('live-preview-toggle'))

    await waitFor(() => {
      expect(screen.getByText('Token Signed')).toBeDefined()
    })

    const desktopBtn = screen.getByTitle('Desktop View')
    const tabletBtn = screen.getByTitle('Tablet View (768px)')
    const mobileBtn = screen.getByTitle('Mobile View (375px)')

    expect(desktopBtn).toBeDefined()
    expect(tabletBtn).toBeDefined()
    expect(mobileBtn).toBeDefined()

    // Switch to Mobile
    fireEvent.click(mobileBtn)
    const iframe = screen.getByTestId('live-preview-iframe')
    const container = iframe.parentElement
    expect(container?.className).toContain('w-[375px]')

    // Switch to Tablet
    fireEvent.click(tabletBtn)
    expect(container?.className).toContain('w-[768px]')
  })

  it('streams updated draft data to iframe via window.postMessage when user types', async () => {
    renderForm()
    fireEvent.click(screen.getByTestId('live-preview-toggle'))

    await waitFor(() => {
      expect(screen.getByText('Token Signed')).toBeDefined()
    })

    const iframe = screen.getByTestId('live-preview-iframe') as HTMLIFrameElement
    const postMessageMock = vi.fn()
    Object.defineProperty(iframe, 'contentWindow', {
      value: { postMessage: postMessageMock },
      writable: true,
    })

    // Simulate iframe onload triggering ready
    await act(async () => {
      fireEvent.load(iframe)
    })

    // Wait for initial handshake
    await waitFor(() => {
      expect(postMessageMock).toHaveBeenCalled()
    })

    // Clear and type into title field
    postMessageMock.mockClear()
    const titleInput = screen.getByTestId('field-title')
    await act(async () => {
      fireEvent.change(titleInput, { target: { value: 'My Real-Time Draft Title' } })
    })

    // Wait for slug auto-generation state update to flush
    await waitFor(() => {
      const slugInput = document.getElementById('entry-slug') as HTMLInputElement
      expect(slugInput?.value).toBe('my-real-time-draft-title')
    })

    // Verify draft data streamed directly to iframe without saving to database
    await waitFor(() => {
      expect(postMessageMock).toHaveBeenCalled()
      const calls = postMessageMock.mock.calls
      const lastCall = calls[calls.length - 1] as [any, string]
      expect(lastCall[0].type).toBe(EDGECMS_PREVIEW_MESSAGE_TYPE)
      expect(lastCall[0].payload.data.title).toBe('My Real-Time Draft Title')
      expect(lastCall[0].payload.collectionSlug).toBe('articles')
    })
  })

  it('handles EDGECMS_PREVIEW_READY bi-directional handshake from iframe', async () => {
    renderForm()
    fireEvent.click(screen.getByTestId('live-preview-toggle'))

    await waitFor(() => {
      expect(screen.getByText('Token Signed')).toBeDefined()
    })

    const iframe = screen.getByTestId('live-preview-iframe') as HTMLIFrameElement
    const postMessageMock = vi.fn()
    Object.defineProperty(iframe, 'contentWindow', {
      value: { postMessage: postMessageMock },
      writable: true,
    })

    // Simulate iframe sending ready event
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: EDGECMS_PREVIEW_READY_TYPE },
        })
      )
    })

    await waitFor(() => {
      expect(postMessageMock).toHaveBeenCalled()
      expect(screen.getByText('Streaming Real-Time')).toBeDefined()
    })
  })
})
