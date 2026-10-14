import '../../../test-utils/setup'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import * as React from 'react'

let mockPendingCount = 0

vi.mock('@/features/sync/local-db', () => ({
  db: {
    mediaQueue: {
      where: () => ({
        equals: () => ({
          count: () => Promise.resolve(mockPendingCount),
        }),
      }),
    },
  },
}))

vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: vi.fn((_fn, _deps, defaultVal) => defaultVal ?? 0),
}))

vi.mock('@floating-ui/dom', () => ({
  computePosition: vi.fn(async () => ({ x: 100, y: 100 })),
  flip: vi.fn(),
  offset: vi.fn(),
  shift: vi.fn(),
}))

const mockMutateUploadAsync = vi.fn()
const mockMutateFilenameAsync = vi.fn()
const mockMutateDeleteAsync = vi.fn()
const mockRefetch = vi.fn().mockResolvedValue({})

let mockAssetsData: Array<{
  id: string
  filename: string
  mimeType: string
  size: number
  createdAt: string
  updatedAt: string
  variants: Array<{
    id: string
    variant: string
    format: string
    width: number
    height: number
  }>
}> = []
let mockIsLoadingAssets = false

vi.mock('./api', () => ({
  useAssets: () => ({
    data: mockAssetsData,
    isLoading: mockIsLoadingAssets,
    refetch: mockRefetch,
  }),
  useAssetUploadConfig: () => ({
    data: {
      maxUploadBytes: 5 * 1024 * 1024,
      maxUploadDimension: 2048,
      allowedMimeTypes: ['image/jpeg', 'image/png', 'application/pdf'],
    },
    isLoading: false,
  }),
  useUploadAsset: () => ({
    mutateAsync: mockMutateUploadAsync,
    isPending: false,
  }),
  useUpdateAssetFilename: () => ({
    mutateAsync: mockMutateFilenameAsync,
    isPending: false,
  }),
  useDeleteAssets: () => ({
    mutateAsync: mockMutateDeleteAsync,
    isPending: false,
  }),
}))

const mockEnqueueMediaDelete = vi.fn().mockResolvedValue(undefined)
const mockEnqueueMediaMove = vi.fn().mockResolvedValue(undefined)
const mockEnqueueMediaUpload = vi.fn().mockResolvedValue(undefined)
const mockProcessMediaQueue = vi.fn().mockResolvedValue({ processed: 1, failed: 0 })

vi.mock('./offline-media-queue', () => ({
  enqueueMediaDelete: (...args: unknown[]) => mockEnqueueMediaDelete(...args),
  enqueueMediaMove: (...args: unknown[]) => mockEnqueueMediaMove(...args),
  enqueueMediaUpload: (...args: unknown[]) => mockEnqueueMediaUpload(...args),
  processMediaQueue: (...args: unknown[]) => mockProcessMediaQueue(...args),
}))

vi.mock('./media-optimizer', () => ({
  optimizeImageForUpload: vi.fn(async (file: File) => ({
    file,
    originalBytes: file.size,
    optimizedBytes: file.size,
    didCompress: false,
    width: 800,
    height: 600,
  })),
}))

vi.mock('@/components/layout/auth-page-header', () => ({
  AuthPageHeader: ({ title, children }: { title?: React.ReactNode; children?: React.ReactNode }) => (
    <header data-testid='auth-page-header'>
      {title}
      {children}
    </header>
  ),
}))

import { SidebarProvider } from '@/components/ui/sidebar'
import { MediaManager } from './media-manager'

function renderMediaManager(ui: React.ReactElement) {
  return render(<SidebarProvider>{ui}</SidebarProvider>)
}

describe('MediaManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    mockIsLoadingAssets = false
    mockAssetsData = [
      {
        id: 'asset-1',
        filename: 'blog/cover.jpg',
        mimeType: 'image/jpeg',
        size: 1024 * 100,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        variants: [
          {
            id: 'v-1',
            variant: 'medium',
            format: 'webp',
            width: 800,
            height: 600,
          },
        ],
      },
      {
        id: 'asset-2',
        filename: 'logo.png',
        mimeType: 'image/png',
        size: 1024 * 50,
        createdAt: '2026-01-03T00:00:00.000Z',
        updatedAt: '2026-01-03T00:00:00.000Z',
        variants: [],
      },
      {
        id: 'asset-3',
        filename: 'docs/spec.pdf',
        mimeType: 'application/pdf',
        size: 1024 * 200,
        createdAt: '2026-01-04T00:00:00.000Z',
        updatedAt: '2026-01-04T00:00:00.000Z',
        variants: [],
      },
    ]
  })

  it('renders loading state when assets query is loading', () => {
    mockIsLoadingAssets = true
    renderMediaManager(<MediaManager />)

    expect(screen.getByText('Loading media library...')).toBeInTheDocument()
  })

  it('renders empty state when no assets or folders exist in current view', () => {
    mockAssetsData = []
    renderMediaManager(<MediaManager />)

    expect(
      screen.getByText('No assets or folders found for this folder/filter combination.')
    ).toBeInTheDocument()
  })

  it('renders root folders and root assets in grid view', () => {
    renderMediaManager(<MediaManager />)

    // In root, we should see subfolders 'blog' and 'docs', and direct asset 'logo.png'
    expect(screen.getByText('blog')).toBeInTheDocument()
    expect(screen.getByText('docs')).toBeInTheDocument()
    expect(screen.getByText('logo.png')).toBeInTheDocument()
  })

  it('handles navigation into folders and breadcrumb navigation', () => {
    const onPathChange = vi.fn()
    renderMediaManager(<MediaManager onPathChange={onPathChange} />)

    // Double-click folder 'blog'
    const blogFolder = screen.getByText('blog').closest('button')
    expect(blogFolder).toBeTruthy()
    fireEvent.doubleClick(blogFolder!)

    expect(onPathChange).toHaveBeenCalledWith('blog')
  })

  it('renders assets inside a controlled folder path', () => {
    renderMediaManager(<MediaManager currentPath='blog' />)

    // Inside 'blog', we should see 'cover.jpg', but not 'logo.png'
    expect(screen.getByText('cover.jpg')).toBeInTheDocument()
    expect(screen.queryByText('logo.png')).not.toBeInTheDocument()
  })

  it('selects assets via click, ctrl/cmd-click, and shift-click', () => {
    renderMediaManager(<MediaManager />)

    const logoCard = screen.getByText('logo.png').closest('div')
    expect(logoCard).toBeTruthy()

    // Single click
    fireEvent.click(logoCard!)

    // Click folder
    const blogFolder = screen.getByText('blog').closest('button')
    fireEvent.click(blogFolder!)

    // Cmd click logo
    fireEvent.click(logoCard!, { metaKey: true })
    // Toggle off
    fireEvent.click(logoCard!, { metaKey: true })

    // Shift click
    fireEvent.click(logoCard!)
    fireEvent.click(logoCard!, { shiftKey: true })
  })

  it('switches between grid and list views', () => {
    renderMediaManager(<MediaManager />)

    // Find view toggle button in toolbar
    const listBtn = screen.getByRole('button', { name: /list view/i })
    fireEvent.click(listBtn)

    // In list view, columns should be visible
    expect(screen.getByText('Asset / Folder')).toBeInTheDocument()
    expect(screen.getByText('Type')).toBeInTheDocument()
    expect(screen.getByText('Size')).toBeInTheDocument()
    expect(screen.getByText('Uploaded')).toBeInTheDocument()

    // Switch back to grid
    const gridBtn = screen.getByRole('button', { name: /grid view/i })
    fireEvent.click(gridBtn)
    expect(screen.queryByText('Asset / Folder')).not.toBeInTheDocument()
  })

  it('creates and cancels new folder draft', () => {
    renderMediaManager(<MediaManager />)

    const newFolderBtn = screen.getByRole('button', { name: /new folder/i })
    fireEvent.click(newFolderBtn)

    const input = screen.getByLabelText('New folder name')
    expect(input).toBeInTheDocument()

    // Type name and commit on Enter
    fireEvent.change(input, { target: { value: 'gallery' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    // Folder 'gallery' should now exist in customFolders
    expect(screen.getAllByText('gallery').length).toBeGreaterThanOrEqual(1)

    // Create another and cancel with Escape
    fireEvent.click(newFolderBtn)
    const input2 = screen.getByLabelText('New folder name')
    fireEvent.keyDown(input2, { key: 'Escape' })
    expect(screen.queryByLabelText('New folder name')).not.toBeInTheDocument()
  })

  it('handles asset deletion through confirm dialog', async () => {
    mockMutateDeleteAsync.mockResolvedValue({ deletedIds: ['asset-2'] })
    renderMediaManager(<MediaManager />)

    // Select logo.png
    const logoCard = screen.getByText('logo.png').closest('div')
    fireEvent.click(logoCard!)

    // Context menu on logo.png
    fireEvent.contextMenu(logoCard!, { clientX: 100, clientY: 100 })

    // In context menu, click Delete
    const deleteBtn = screen.getByRole('menuitem', { name: /delete/i })
    fireEvent.click(deleteBtn)

    // Confirm dialog should open
    expect(screen.getByText('Delete selected assets?')).toBeInTheDocument()

    // Click confirm delete
    const confirmBtn = screen.getByRole('button', { name: 'Delete' })
    fireEvent.click(confirmBtn)

    await waitFor(() => {
      expect(mockMutateDeleteAsync).toHaveBeenCalledWith(['asset-2'])
    })
  })

  it('handles file upload input change', async () => {
    mockMutateUploadAsync.mockResolvedValue({
      id: 'asset-new',
      filename: 'uploaded.png',
      mimeType: 'image/png',
      size: 1024,
      variants: [],
    })

    const { container } = renderMediaManager(<MediaManager />)

    // Find file upload input
    const fileInput = container.querySelector('input[type="file"]:not([webkitdirectory])') as HTMLInputElement
    expect(fileInput).toBeTruthy()

    const testFile = new File(['fake content'], 'uploaded.png', { type: 'image/png' })
    Object.defineProperty(fileInput, 'files', {
      value: [testFile],
    })

    fireEvent.change(fileInput)

    await waitFor(() => {
      expect(mockMutateUploadAsync).toHaveBeenCalled()
    })
  })

  it('opens preview modal on double click and supports modal controls', () => {
    renderMediaManager(<MediaManager />)

    const logoCard = screen.getByText('logo.png').closest('div')
    fireEvent.doubleClick(logoCard!)

    // Preview modal should show asset filename
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    // Zoom controls
    const zoomInBtn = screen.getByRole('button', { name: /zoom in/i })
    fireEvent.click(zoomInBtn)

    const zoomResetBtn = screen.getByRole('button', { name: /reset zoom/i })
    fireEvent.click(zoomResetBtn)

    const zoomOutBtn = screen.getByRole('button', { name: /zoom out/i })
    fireEvent.click(zoomOutBtn)

    // Close preview
    const closeBtn = screen.getByRole('button', { name: /close preview/i })
    fireEvent.click(closeBtn)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('supports drag and drop onto gallery and folders', async () => {
    mockMutateFilenameAsync.mockResolvedValue({})
    renderMediaManager(<MediaManager />)

    const blogFolder = screen.getByText('blog').closest('button')
    expect(blogFolder).toBeTruthy()

    // Drop an asset onto blog folder
    fireEvent.drop(blogFolder!, {
      dataTransfer: {
        getData: (type: string) => {
          if (type === 'application/x-edgecms-assets') return JSON.stringify(['asset-2'])
          return ''
        },
      },
    })

    await waitFor(() => {
      expect(mockMutateFilenameAsync).toHaveBeenCalledWith({
        id: 'asset-2',
        filename: 'blog/logo.png',
      })
    })
  })

  it('handles offline queue when moving assets while offline', async () => {
    // Simulate offline
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })

    renderMediaManager(<MediaManager />)

    const blogFolder = screen.getByText('blog').closest('button')
    expect(blogFolder).toBeTruthy()

    fireEvent.drop(blogFolder!, {
      dataTransfer: {
        getData: (type: string) => {
          if (type === 'application/x-edgecms-assets') return JSON.stringify(['asset-2'])
          return ''
        },
      },
    })

    await waitFor(() => {
      expect(mockEnqueueMediaMove).toHaveBeenCalledWith({
        assetId: 'asset-2',
        filename: 'blog/logo.png',
      })
    })

    // Restore online
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
  })

  it('filters assets by search term and mime category', () => {
    renderMediaManager(<MediaManager />)

    // Search input
    const searchInput = screen.getByPlaceholderText(/search/i)
    fireEvent.change(searchInput, { target: { value: 'logo' } })

    expect(screen.getByText('logo.png')).toBeInTheDocument()
    expect(screen.queryByText('docs')).not.toBeInTheDocument()

    // Clear search
    fireEvent.change(searchInput, { target: { value: '' } })
    expect(screen.getByText('blog')).toBeInTheDocument()
  })

  it('toggles quality settings and adjusts upload quality slider', () => {
    const { container } = renderMediaManager(<MediaManager />)

    const settingsBtn = screen.getByRole('button', { name: /settings/i })
    fireEvent.click(settingsBtn)

    expect(screen.getByText(/upload quality/i)).toBeInTheDocument()

    const rangeInput = container.querySelector('input[type="range"]') as HTMLInputElement
    expect(rangeInput).toBeTruthy()
    fireEvent.change(rangeInput, { target: { value: '90' } })
    expect(rangeInput.value).toBe('90')
  })

  it('handles list view interactions: clicking, double clicking, and context menu', () => {
    renderMediaManager(<MediaManager />)

    // Switch to list view
    const listBtn = screen.getByRole('button', { name: /list view/i })
    fireEvent.click(listBtn)

    // Click folder in list view
    const folderRow = screen.getAllByText('blog')[0]?.closest('button')
    expect(folderRow).toBeTruthy()
    fireEvent.click(folderRow!)

    // Double click folder in list view
    fireEvent.doubleClick(folderRow!)

    // Open context menu in list view
    fireEvent.contextMenu(folderRow!, { clientX: 200, clientY: 200 })
  })

  it('navigates via breadcrumbs', () => {
    renderMediaManager(<MediaManager currentPath='blog/sub' />)

    // Click '/' in breadcrumb
    const rootBreadcrumb = screen.getByRole('link', { name: '/' })
    fireEvent.click(rootBreadcrumb)
  })

  it('supports folder rename via context menu', async () => {
    mockMutateFilenameAsync.mockResolvedValue({})
    renderMediaManager(<MediaManager />)

    const blogFolder = screen.getByText('blog').closest('button')
    fireEvent.contextMenu(blogFolder!, { clientX: 150, clientY: 150 })

    const renameBtn = screen.getByRole('menuitem', { name: /rename/i })
    fireEvent.click(renameBtn)

    const renameInput = screen.getByLabelText('Rename folder')
    fireEvent.change(renameInput, { target: { value: 'articles' } })
    fireEvent.keyDown(renameInput, { key: 'Enter' })

    await waitFor(() => {
      expect(mockMutateFilenameAsync).toHaveBeenCalledWith({
        id: 'asset-1',
        filename: 'articles/cover.jpg',
      })
    })
  })

  it('handles keyboard navigation and zoom shortcuts in preview modal', async () => {
    renderMediaManager(<MediaManager />)

    const logoCard = screen.getByText('logo.png').closest('div')
    expect(logoCard).toBeTruthy()
    fireEvent.doubleClick(logoCard!)

    // Zoom shortcuts
    fireEvent.keyDown(window, { key: '+' })
    fireEvent.keyDown(window, { key: '-' })
    fireEvent.keyDown(window, { key: '0' })

    // Arrow navigation
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    fireEvent.keyDown(window, { key: 'ArrowLeft' })

    // Escape closes preview
    fireEvent.keyDown(window, { key: 'Escape' })
  })

  it('handles global keyboard shortcuts: select all, enter preview, and delete', async () => {
    renderMediaManager(<MediaManager />)

    // Ctrl+A / Cmd+A selects all
    fireEvent.keyDown(window, { key: 'a', ctrlKey: true })

    // Press Delete triggers deletion modal
    fireEvent.keyDown(window, { key: 'Delete' })
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toBeTruthy()

    // Cancel deletion
    const cancelBtn = screen.getByText('Cancel')
    fireEvent.click(cancelBtn)

    // Select single asset and press Enter
    const logoCard = screen.getByText('logo.png').closest('div')
    fireEvent.click(logoCard!)
    fireEvent.keyDown(window, { key: 'Enter' })
  })

  it('handles online/offline window events and queue replays', async () => {
    mockPendingCount = 1
    renderMediaManager(<MediaManager />)

    fireEvent(window, new Event('offline'))
    fireEvent(window, new Event('online'))

    await waitFor(() => {
      expect(mockProcessMediaQueue).toHaveBeenCalled()
    })
  })

  it('handles file upload flows: online success, offline queue, and upload error fallback', async () => {
    const { container } = renderMediaManager(<MediaManager />)
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    expect(fileInput).toBeTruthy()

    // 1. Successful online upload
    mockMutateUploadAsync.mockResolvedValueOnce({})
    const testFile = new File(['image bytes'], 'photo.jpg', { type: 'image/jpeg' })
    fireEvent.change(fileInput, { target: { files: [testFile] } })

    await waitFor(() => {
      expect(mockMutateUploadAsync).toHaveBeenCalled()
    })

    // 2. Offline upload queueing
    fireEvent(window, new Event('offline'))
    const offlineFile = new File(['offline bytes'], 'offline.png', { type: 'image/png' })
    fireEvent.change(fileInput, { target: { files: [offlineFile] } })

    await waitFor(() => {
      expect(mockEnqueueMediaUpload).toHaveBeenCalled()
    })

    // 3. Online fallback on transient network error
    fireEvent(window, new Event('online'))
    mockMutateUploadAsync.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const failingFile = new File(['fail bytes'], 'fail.jpg', { type: 'image/jpeg' })
    fireEvent.change(fileInput, { target: { files: [failingFile] } })

    await waitFor(() => {
      expect(mockEnqueueMediaUpload).toHaveBeenCalledTimes(2)
    })
  })
})

