import { beforeEach, describe, expect, it, setDefaultTimeout, vi } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiClientError } from '@/lib/api-error'
import type { ImportExecution, ImportPreview } from '../api/collection-transfer-api'

// Multi-step user-event flows through a Radix dialog; give slow CI runners room.
setDefaultTimeout(20_000)

const mockEdenGet = vi.fn()
const mockEdenPost = vi.fn()
let mockViewer: { globalRole: string | null; tenantSlug: string; tenantRole: string | null } | null = null

vi.mock('@/lib/eden-client', () => ({
  edenGet: (...args: unknown[]) => mockEdenGet(...args),
  edenPost: (...args: unknown[]) => mockEdenPost(...args),
  edenPut: vi.fn(),
  edenPatch: vi.fn(),
  edenDelete: vi.fn(),
  edenPostMultipart: vi.fn(),
  edenPostForTenant: vi.fn(),
  normalizeEdenResponse: vi.fn(),
  resolveApiBasePath: () => '/api',
  eden: {},
}))

vi.mock('@/features/plugins/admin-contributions/viewer', () => ({
  useAdminViewer: () => mockViewer,
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

const { CollectionTransferActions } = await import('./collection-transfer-actions')

const EXPORT_DOC = {
  format: 'edgecms.collection-export',
  formatVersion: 1,
  exportedAt: '2026-11-05T00:00:00.000Z',
  collection: { slug: 'posts', name: 'Posts', fields: [], schemaHash: 'h' },
  entries: [{ slug: 'hello', status: 'draft', data: { title: 'Hello' } }],
  relations: [],
}

const PREVIEW: ImportPreview = {
  collection: { id: 'col-1', slug: 'posts' },
  strategy: 'skip',
  summary: { create: 1, update: 0, skip: 1, conflict: 1, invalid: 1 },
  entries: [
    { index: 0, slug: 'new-post', action: 'create', reason: 'New entry', publish: true },
    { index: 1, slug: 'same-post', action: 'skip', reason: 'Values are unchanged' },
    { index: 2, slug: 'edited-post', action: 'conflict', reason: 'Existing entry has different values' },
    {
      index: 3,
      slug: 'bad-post',
      action: 'invalid',
      reason: 'Entry failed validation',
      validationErrors: ["Unknown field 'subtitle'"],
    },
  ],
  relations: [],
  warnings: ['SCHEMA_HASH_MISMATCH: the target collection schema differs from the exported schema'],
  commandCount: 2,
  diff: [],
  previewReceipt: 'receipt-1',
  expiresAt: '2026-11-05T10:15:00.000Z',
}

const PARTIAL: ImportExecution = {
  status: 'partial_failure',
  collection: { id: 'col-1', slug: 'posts' },
  entries: [
    { ...PREVIEW.entries[0], outcome: 'success', publishOutcome: 'failed', error: 'Publish rejected by hook' },
    { ...PREVIEW.entries[1] },
    { ...PREVIEW.entries[2] },
    { ...PREVIEW.entries[3] },
  ],
  relations: [],
  warnings: [],
  commandIds: ['cmd-1'],
}

function renderActions() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <CollectionTransferActions tenantSlug='acme' collectionSlug='posts' collectionName='Posts' />
    </QueryClientProvider>
  )
}

async function chooseFileAndPreview(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Import' }))
  const dialog = await screen.findByRole('dialog')
  const input = within(dialog).getByLabelText('Export file (.json)')
  await user.upload(input, new File([JSON.stringify(EXPORT_DOC)], 'posts.json', { type: 'application/json' }))
  const previewButton = within(dialog).getByRole('button', { name: 'Preview import' })
  await waitFor(() => expect(previewButton.hasAttribute('disabled')).toBe(false))
  await user.click(previewButton)
  return dialog
}

describe('CollectionTransferActions (OP-06)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockViewer = { globalRole: 'viewer', tenantSlug: 'acme', tenantRole: 'editor' }
  })

  it('renders nothing for viewers and while the role is unknown', () => {
    mockViewer = null
    const { container, unmount } = renderActions()
    expect(container.innerHTML).toBe('')
    unmount()

    mockViewer = { globalRole: 'viewer', tenantSlug: 'acme', tenantRole: 'viewer' }
    expect(renderActions().container.innerHTML).toBe('')
  })

  it('shows members Export but not Import', () => {
    mockViewer = { globalRole: 'viewer', tenantSlug: 'acme', tenantRole: 'member' }
    renderActions()
    expect(screen.getByRole('button', { name: 'Export' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Import' })).toBeNull()
  })

  it('exports the collection as a JSON download', async () => {
    const user = userEvent.setup()
    mockEdenGet.mockResolvedValue(EXPORT_DOC)
    const createObjectURL = vi.fn(() => 'blob:export')
    const revokeObjectURL = vi.fn()
    Object.assign(URL, { createObjectURL, revokeObjectURL })
    const clicks: string[] = []
    const originalClick = window.HTMLAnchorElement.prototype.click
    window.HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      clicks.push(this.download)
    }
    try {
      renderActions()
      await user.click(screen.getByRole('button', { name: 'Export' }))
      await waitFor(() => expect(clicks).toHaveLength(1))
      expect(mockEdenGet).toHaveBeenCalledWith('/admin/collections/posts/export')
      expect(clicks[0]).toMatch(/^posts-export-\d{4}-\d{2}-\d{2}\.json$/)
      expect(createObjectURL).toHaveBeenCalledTimes(1)
    } finally {
      window.HTMLAnchorElement.prototype.click = originalClick
    }
  })

  it('previews the plan, confirms with the receipt and shows a 207 partial result per entry', async () => {
    const user = userEvent.setup()
    mockEdenPost.mockResolvedValueOnce(PREVIEW).mockResolvedValueOnce(PARTIAL)
    renderActions()

    const dialog = await chooseFileAndPreview(user)

    // Preview: counts, reasons, validation errors and warnings; nothing written yet.
    await within(dialog).findByText('Entry plan')
    expect(mockEdenPost).toHaveBeenCalledTimes(1)
    expect(mockEdenPost).toHaveBeenCalledWith('/admin/collections/posts/import/preview', {
      document: EXPORT_DOC,
      strategy: 'skip',
    })
    const plan = within(dialog).getByRole('list', { name: 'Entry plan' })
    const rows = within(plan).getAllByRole('listitem').filter((row) => row.dataset.action)
    // Problems first.
    expect(rows.map((row) => row.dataset.action)).toEqual(['invalid', 'conflict', 'create', 'skip'])
    expect(within(plan).getByText("Unknown field 'subtitle'")).toBeTruthy()
    expect(within(plan).getByText('Existing entry has different values')).toBeTruthy()
    expect(within(dialog).getByText(/SCHEMA_HASH_MISMATCH/)).toBeTruthy()
    expect(within(dialog).getByText(/there is no\s+rollback/)).toBeTruthy()

    await user.click(within(dialog).getByRole('button', { name: 'Confirm import' }))

    await within(dialog).findByText('Import stopped partway')
    expect(mockEdenPost).toHaveBeenLastCalledWith('/admin/collections/posts/import/execute', {
      document: EXPORT_DOC,
      strategy: 'skip',
      previewReceipt: 'receipt-1',
    })
    const results = within(dialog).getByRole('list', { name: 'Entry results' })
    expect(within(results).getByText('Publish rejected by hook')).toBeTruthy()
    expect(within(results).getByText('saved; publish: failed')).toBeTruthy()
    // A failed publish counts as a failure and sorts first.
    const resultRows = within(results).getAllByRole('listitem').filter((row) => row.dataset.outcome)
    expect(resultRows[0].dataset.outcome).toBe('failed')
    expect(within(results).getAllByText('Not imported')).toHaveLength(3)
  })

  it('sends the update strategy chosen with the keyboard', async () => {
    const user = userEvent.setup()
    mockEdenPost.mockResolvedValueOnce({ ...PREVIEW, strategy: 'update' })
    renderActions()
    await user.click(screen.getByRole('button', { name: 'Import' }))
    const dialog = await screen.findByRole('dialog')
    await user.upload(
      within(dialog).getByLabelText('Export file (.json)'),
      new File([JSON.stringify(EXPORT_DOC)], 'posts.json')
    )
    within(dialog).getByRole('radio', { name: /Update it from the file/ }).focus()
    await user.keyboard(' ')
    await user.click(within(dialog).getByRole('button', { name: 'Preview import' }))
    await waitFor(() =>
      expect(mockEdenPost).toHaveBeenCalledWith('/admin/collections/posts/import/preview', {
        document: EXPORT_DOC,
        strategy: 'update',
      })
    )
  })

  it('rejects a file that is not an export and keeps Preview disabled', async () => {
    const user = userEvent.setup()
    renderActions()
    await user.click(screen.getByRole('button', { name: 'Import' }))
    const dialog = await screen.findByRole('dialog')
    await user.upload(within(dialog).getByLabelText('Export file (.json)'), new File(['not json'], 'x.json'))
    expect(await within(dialog).findByText('This file is not valid JSON.')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Preview import' }).hasAttribute('disabled')).toBe(true)
    expect(mockEdenPost).not.toHaveBeenCalled()
  })

  it('offers no confirm when the plan has nothing to run', async () => {
    const user = userEvent.setup()
    mockEdenPost.mockResolvedValueOnce({
      ...PREVIEW,
      summary: { create: 0, update: 0, skip: 1, conflict: 0, invalid: 0 },
      entries: [PREVIEW.entries[1]],
      commandCount: 0,
      previewReceipt: undefined,
      expiresAt: undefined,
    })
    renderActions()
    const dialog = await chooseFileAndPreview(user)
    expect(await within(dialog).findByText(/Nothing to import/)).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: 'Confirm import' })).toBeNull()
  })

  it('asks to preview again when execute returns 409 IMPORT_PLAN_CHANGED', async () => {
    const user = userEvent.setup()
    mockEdenPost
      .mockResolvedValueOnce(PREVIEW)
      .mockRejectedValueOnce(
        new ApiClientError({ status: 409, code: 'IMPORT_PLAN_CHANGED', message: 'The import plan no longer matches' })
      )
      .mockResolvedValueOnce({ ...PREVIEW, previewReceipt: 'receipt-2' })
    renderActions()
    const dialog = await chooseFileAndPreview(user)
    await user.click(await within(dialog).findByRole('button', { name: 'Confirm import' }))

    expect(await within(dialog).findByText('The plan changed since this preview')).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: 'Confirm import' })).toBeNull()
    await user.click(within(dialog).getByRole('button', { name: 'Preview again' }))
    await within(dialog).findByRole('button', { name: 'Confirm import' })
    expect(mockEdenPost).toHaveBeenCalledTimes(3)
  })
})
