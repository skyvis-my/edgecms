import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const edenGet = vi.fn()
const edenPost = vi.fn()
const edenDelete = vi.fn()

vi.mock('@/lib/eden-client', () => ({
  edenGet,
  edenPost,
  edenPut: vi.fn(),
  edenDelete,
  edenPatch: vi.fn(),
  edenPostForTenant: vi.fn(),
  edenPostMultipart: vi.fn(),
}))

const { TenantDeleteDialog } = await import('./tenant-delete-dialog?real')
const { parseTenantExportId } = await import('../offboarding-api?real')

const TENANT = { slug: 'acme', name: 'Acme' }
const NDJSON =
  '{"type":"header","exportId":"exp-1","tenant":{"slug":"acme"}}\n{"type":"receipt","exportId":"exp-1"}\n'

function job(status: string, done = false) {
  return {
    id: 'job-1',
    tenantId: 't1',
    tenantSlug: 'acme',
    tenantName: 'Acme',
    status,
    done,
    requestedAt: '2026-01-01T00:00:00.000Z',
    exportId: status === 'requested' ? null : 'exp-1',
    counts: {},
    lastError: null,
  }
}

function renderDialog(onDeleted = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <TenantDeleteDialog open onOpenChange={vi.fn()} tenant={TENANT} onDeleted={onDeleted} />
    </QueryClientProvider>
  )
  return { onDeleted }
}

describe('parseTenantExportId', () => {
  it('reads the export id from the header line only', () => {
    expect(parseTenantExportId(NDJSON)).toBe('exp-1')
    expect(parseTenantExportId('{"type":"receipt","exportId":"x"}\n')).toBeNull()
    expect(parseTenantExportId('not json')).toBeNull()
  })
})

describe('TenantDeleteDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    URL.createObjectURL = vi.fn(() => 'blob:x') as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn()
  })

  it('never calls the retired DELETE route and deletes only after request, export and typed slug', async () => {
    edenPost.mockImplementation(async (path: string) => {
      if (path === '/admin/tenants/acme/deletion-requests') return job('requested')
      if (path === '/admin/tenant-deletions/job-1/confirm') return job('completed', true)
      throw new Error(`unexpected ${path}`)
    })
    edenGet.mockResolvedValueOnce(NDJSON)
    const { onDeleted } = renderDialog()

    const deleteButton = screen.getByRole('button', { name: 'Delete permanently' })
    expect(deleteButton).toHaveProperty('disabled', true)

    fireEvent.click(screen.getByRole('button', { name: 'Request deletion' }))
    await screen.findByTestId('tenant-deletion-job')
    expect(deleteButton).toHaveProperty('disabled', true)

    fireEvent.click(screen.getByRole('button', { name: 'Download export' }))
    await waitFor(() => expect(edenGet).toHaveBeenCalledWith('/admin/tenants/acme/export'))
    await screen.findByText('exp-1')
    expect(URL.createObjectURL).toHaveBeenCalled()
    expect(deleteButton).toHaveProperty('disabled', true)

    const input = screen.getByLabelText(/to confirm/)
    fireEvent.change(input, { target: { value: 'ACME' } })
    expect(deleteButton).toHaveProperty('disabled', true)
    fireEvent.change(input, { target: { value: 'acme' } })
    expect(deleteButton).toHaveProperty('disabled', false)

    fireEvent.click(deleteButton)
    await waitFor(() =>
      expect(edenPost).toHaveBeenCalledWith('/admin/tenant-deletions/job-1/confirm', {
        tenantSlug: 'acme',
        exportId: 'exp-1',
      })
    )
    await waitFor(() => expect(onDeleted).toHaveBeenCalled())
    expect(edenDelete).not.toHaveBeenCalled()
  })

  it('cancels an open request without deleting', async () => {
    edenPost.mockImplementation(async (path: string) => {
      if (path === '/admin/tenants/acme/deletion-requests') return job('requested')
      if (path === '/admin/tenant-deletions/job-1/cancel') return job('cancelled')
      throw new Error(`unexpected ${path}`)
    })
    const { onDeleted } = renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Request deletion' }))
    await screen.findByTestId('tenant-deletion-job')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel request' }))
    await waitFor(() =>
      expect(edenPost).toHaveBeenCalledWith('/admin/tenant-deletions/job-1/cancel')
    )
    expect(onDeleted).not.toHaveBeenCalled()
    expect(edenPost).not.toHaveBeenCalledWith(
      '/admin/tenant-deletions/job-1/confirm',
      expect.anything()
    )
  })

  it('offers to continue a job that is already confirmed', async () => {
    edenPost.mockImplementation(async (path: string) => {
      if (path === '/admin/tenants/acme/deletion-requests') return job('confirmed')
      if (path === '/admin/tenant-deletions/job-1/resume') return job('completed', true)
      throw new Error(`unexpected ${path}`)
    })
    const { onDeleted } = renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Request deletion' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Continue deletion' }))
    await waitFor(() => expect(onDeleted).toHaveBeenCalled())
  })
})
