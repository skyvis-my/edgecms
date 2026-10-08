import { computePosition, flip, offset, shift } from '@floating-ui/dom'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  CheckCircle2,
  Download,
  FolderOpen,
  Image as ImageIcon,
  RefreshCw,
  Trash2,
  WifiOff,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { AuthPageHeader } from '@/components/layout/auth-page-header'
import { Main } from '@/components/layout/main'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { db } from '@/features/sync/local-db'
import { ApiClientError } from '@/lib/api-error'
import { toRelativeTime } from '@/lib/date-time'
import { cn } from '@/lib/utils'
import { ActivityLogPanel } from './activity-log-panel'
import {
  buildAssetAcceptValue,
  isFileAllowedForUpload,
  normalizeAllowedAssetMimeTypes,
  resolveFileMimeType,
} from './file-policy'
import { HoverPreview } from './hover-preview'
import { MediaContextMenu } from './media-context-menu'
import { MediaPreviewModal } from './media-preview-modal'
import { MediaToolbar } from './media-toolbar'
import {
  type Asset,
  useAssetUploadConfig,
  useAssets,
  useDeleteAssets,
  useUpdateAssetFilename,
  useUploadAsset,
} from './api'
import type {
  AssetEntry,
  ContextMenuState,
  FileManagerEntry,
  FolderEntry,
  HoverPreviewLayout,
  HoverPreviewState,
  MediaActivity,
} from './media-manager-types'
import {
  type AssetSortBy,
  buildAssetDownloadPath,
  buildAssetVariantPath,
  filterAssetsForManager,
  getMimeCategoryOptions,
  type SortDirection,
  sortAssetsForManager,
  summarizeAssets,
} from './media-manager-utils'
import { optimizeImageForUpload } from './media-optimizer'
import {
  buildAssetFilename,
  formatBytes,
  getMovedFolderPath,
  normalizeFolderPath,
  splitAssetFilename,
} from './media-utils'
import {
  enqueueMediaDelete,
  enqueueMediaMove,
  enqueueMediaUpload,
  processMediaQueue,
} from './offline-media-queue'

const MAX_UPLOAD_BATCH_SIZE = 50
const DEFAULT_UPLOAD_MAX_BYTES = 5 * 1024 * 1024
const DEFAULT_UPLOAD_MAX_DIMENSION = 2048
const MAX_ACTIVITY_ITEMS = 12
const DRAG_ASSETS_DATA_TYPE = 'application/x-edgecms-assets'
const DRAG_FOLDER_DATA_TYPE = 'application/x-edgecms-folder'
const PREVIEW_MIN_ZOOM = 1
const PREVIEW_MAX_ZOOM = 4
const PREVIEW_ZOOM_STEP = 0.25
const HOVER_PREVIEW_DELAY_MS = 400
const EMPTY_ASSETS: Asset[] = []

function isPermanentUploadFailure(error: unknown) {
  if (!(error instanceof ApiClientError)) return false
  return Boolean(
    error.status ||
      error.code?.startsWith('ASSET_') ||
      error.code === 'IMAGE_PROCESSING_FAILED'
  )
}
const HOVER_PREVIEW_MIN_WIDTH = 480
const HOVER_PREVIEW_MAX_WIDTH = 480
const HOVER_PREVIEW_MAX_HEIGHT_RATIO = 0.85
const HOVER_PREVIEW_IMAGE_ASPECT_RATIO = 16 / 9
const HOVER_PREVIEW_VIEWPORT_PADDING = 12
const HOVER_PREVIEW_CURSOR_OFFSET = 14

function computeHoverPreviewDimensions(viewportWidth: number, viewportHeight: number) {
  const maxWidthByViewport = Math.max(240, viewportWidth - HOVER_PREVIEW_VIEWPORT_PADDING * 2)
  const width =
    maxWidthByViewport >= HOVER_PREVIEW_MIN_WIDTH
      ? HOVER_PREVIEW_MIN_WIDTH
      : Math.min(HOVER_PREVIEW_MAX_WIDTH, maxWidthByViewport)
  const metadataHeight = 104
  const popupMaxHeight = viewportHeight * HOVER_PREVIEW_MAX_HEIGHT_RATIO
  const imageHeightByWidth = width / HOVER_PREVIEW_IMAGE_ASPECT_RATIO
  const imageHeight = Math.max(160, Math.min(imageHeightByWidth, popupMaxHeight - metadataHeight))
  return { width, imageHeight }
}

type MediaManagerProps = {
  currentPath?: string
  onPathChange?: (path: string) => void
  tenantSlug?: string | null
}

type UploadFileSelection = {
  file: File
  folderPath: string
}

type DirectoryInputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  webkitdirectory?: string
}

function getFileRelativePath(file: File): string {
  return (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? file.name
}

function buildUploadSelections(files: File[], currentPath: string): UploadFileSelection[] {
  return files.map((file) => {
    const relativePath = getFileRelativePath(file)
      .replace(/\\/g, '/')
      .split('/')
      .map((segment) => segment.trim())
      .filter(Boolean)
    const relativeFolders = relativePath.slice(0, -1)
    return {
      file,
      folderPath: normalizeFolderPath([currentPath, ...relativeFolders].filter(Boolean).join('/')),
    }
  })
}

export function MediaManager({
  currentPath: controlledCurrentPath,
  onPathChange,
  tenantSlug,
}: MediaManagerProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [internalCurrentPath, setInternalCurrentPath] = useState(() =>
    normalizeFolderPath(controlledCurrentPath ?? '')
  )
  const [showQualitySettings, setShowQualitySettings] = useState(false)
  const [quality, setQuality] = useState(80)
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([])
  const [selectedFolderPath, setSelectedFolderPath] = useState<string | null>(null)
  const [anchorIndex, setAnchorIndex] = useState<number | null>(null)
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine
  )
  const [isSyncingQueue, setIsSyncingQueue] = useState(false)
  const [activityLog, setActivityLog] = useState<MediaActivity[]>([])
  const [previewAssetId, setPreviewAssetId] = useState<string | null>(null)
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[] | null>(null)
  const [previewZoom, setPreviewZoom] = useState(1)
  const [hoverPreview, setHoverPreview] = useState<HoverPreviewState | null>(null)
  const [hoverPreviewLayout, setHoverPreviewLayout] = useState<HoverPreviewLayout | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ open: false, x: 0, y: 0 })
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [sortBy, setSortBy] = useState<AssetSortBy>('uploadedAt')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [mimeCategoryFilter, setMimeCategoryFilter] = useState('all')
  const [customFolders, setCustomFolders] = useState<string[]>(() => {
    if (typeof window === 'undefined') return []
    try {
      const raw = window.localStorage.getItem('edgecms:media-manager:folders')
      const parsed = raw ? (JSON.parse(raw) as string[]) : []
      return Array.isArray(parsed) ? parsed.filter(Boolean) : []
    } catch {
      return []
    }
  })
  const [newFolderDraft, setNewFolderDraft] = useState<string | null>(null)
  const [renamingFolderPath, setRenamingFolderPath] = useState<string | null>(null)
  const [renamingFolderName, setRenamingFolderName] = useState('')
  const newFolderInputRef = useRef<HTMLInputElement>(null)
  const renameFolderInputRef = useRef<HTMLInputElement>(null)
  const filesUploadInputRef = useRef<HTMLInputElement>(null)
  const folderUploadInputRef = useRef<HTMLInputElement>(null)
  const hoverPreviewTimerRef = useRef<number | null>(null)
  const hoverPreviewPopupRef = useRef<HTMLDivElement>(null)
  const previewDialogRef = useRef<HTMLDivElement>(null)

  const trapPreviewFocus = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return
    const container = previewDialogRef.current
    if (!container) return
    const focusable = Array.from(
      container.querySelectorAll<HTMLElement>('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')
    ).filter((el) => !el.hasAttribute('disabled'))
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement as HTMLElement | null
    if (event.shiftKey && active === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first?.focus()
    }
  }, [])

  const assetsQuery = useAssets()
  const uploadConfigQuery = useAssetUploadConfig()
  const uploadMutation = useUploadAsset()
  const updateFilenameMutation = useUpdateAssetFilename()
  const deleteAssetsMutation = useDeleteAssets()
  const pendingMediaCount = useLiveQuery(
    async () => db.mediaQueue.where('status').equals('pending').count(),
    [],
    0
  )

  const currentPath =
    controlledCurrentPath === undefined
      ? internalCurrentPath
      : normalizeFolderPath(controlledCurrentPath)
  const setCurrentPath = useCallback(
    (nextPath: React.SetStateAction<string>) => {
      const resolvePath = (previousPath: string) =>
        normalizeFolderPath(
          typeof nextPath === 'function'
            ? (nextPath as (value: string) => string)(previousPath)
            : nextPath
        )

      if (controlledCurrentPath !== undefined) {
        onPathChange?.(resolvePath(currentPath))
        return
      }

      setInternalCurrentPath((previousPath) => {
        const resolvedPath = resolvePath(previousPath)
        onPathChange?.(resolvedPath)
        return resolvedPath
      })
    },
    [controlledCurrentPath, currentPath, onPathChange]
  )

  const pathSegments = currentPath.split('/').filter(Boolean)
  const breadcrumbItems = useMemo(
    () => [
      { label: '/', path: '' },
      ...pathSegments.map((_, idx) => {
        const path = pathSegments.slice(0, idx + 1).join('/')
        return { label: pathSegments[idx] ?? path, path }
      }),
    ],
    [pathSegments]
  )

  const assets = assetsQuery.data ?? EMPTY_ASSETS
  const maxUploadBytes = uploadConfigQuery.data?.maxUploadBytes ?? DEFAULT_UPLOAD_MAX_BYTES
  const maxUploadDimension =
    uploadConfigQuery.data?.maxUploadDimension ?? DEFAULT_UPLOAD_MAX_DIMENSION
  const allowedMimeTypes = normalizeAllowedAssetMimeTypes(
    uploadConfigQuery.data?.allowedMimeTypes ?? []
  )
  const uploadAccept = buildAssetAcceptValue(allowedMimeTypes)
  const mimeCategoryOptions = useMemo(() => getMimeCategoryOptions(assets), [assets])
  const filteredAssets = useMemo(
    () => filterAssetsForManager(assets, searchTerm, mimeCategoryFilter),
    [assets, searchTerm, mimeCategoryFilter]
  )
  const sortedAssets = useMemo(
    () => sortAssetsForManager(filteredAssets, sortBy, sortDirection),
    [filteredAssets, sortBy, sortDirection]
  )
  const normalizedSearchTerm = searchTerm.trim().toLowerCase()

  const entries = useMemo<FileManagerEntry[]>(() => {
    const subfolders = new Set<string>()
    const directAssets: Asset[] = []

    const currentParts = currentPath.split('/').filter(Boolean)
    const folderPool = new Set<string>(customFolders)

    for (const asset of assets) {
      const { folder } = splitAssetFilename(asset.filename)
      if (folder) folderPool.add(folder)
    }

    for (const folder of folderPool) {
      const folderParts = folder.split('/').filter(Boolean)
      let isUnderCurrent = true
      for (let i = 0; i < currentParts.length; i++) {
        if (folderParts[i] !== currentParts[i]) {
          isUnderCurrent = false
          break
        }
      }
      if (!isUnderCurrent) continue

      const nextSegment = folderParts[currentParts.length]
      if (!nextSegment) continue
      const path = [...currentParts, nextSegment].join('/')
      subfolders.add(path)
    }

    for (const asset of sortedAssets) {
      const { folder } = splitAssetFilename(asset.filename)
      if (folder !== currentPath) continue
      directAssets.push(asset)
    }

    const folderEntries: FolderEntry[] = [...subfolders]
      .sort((a, b) => a.localeCompare(b))
      .map((path): FolderEntry => {
        const segments = path.split('/')
        return { type: 'folder', path, name: segments[segments.length - 1] ?? path }
      })
      .filter((entry) => {
        if (!normalizedSearchTerm) return true
        return (
          entry.name.toLowerCase().includes(normalizedSearchTerm) ||
          entry.path.toLowerCase().includes(normalizedSearchTerm)
        )
      })

    const assetEntries: AssetEntry[] = directAssets.map((asset) => ({ type: 'asset', asset }))

    return [...folderEntries, ...assetEntries]
  }, [assets, sortedAssets, currentPath, normalizedSearchTerm, customFolders])

  const visibleAssetIds = entries
    .filter((entry): entry is AssetEntry => entry.type === 'asset')
    .map((entry) => entry.asset.id)

  const closeContextMenu = useCallback(() => setContextMenu({ open: false, x: 0, y: 0 }), [])
  const visibleAssets = entries
    .filter((entry): entry is AssetEntry => entry.type === 'asset')
    .map((entry) => entry.asset)
  const folderEntries = useMemo(
    () => entries.filter((entry): entry is FolderEntry => entry.type === 'folder'),
    [entries]
  )
  const assetEntries = useMemo(
    () => entries.filter((entry): entry is AssetEntry => entry.type === 'asset'),
    [entries]
  )
  const librarySummary = useMemo(() => summarizeAssets(assets), [assets])
  const visibleSummary = useMemo(() => summarizeAssets(visibleAssets), [visibleAssets])
  const selectedAssets = useMemo(
    () => assets.filter((asset) => selectedAssetIds.includes(asset.id)),
    [assets, selectedAssetIds]
  )
  const selectedDownloadAsset = selectedAssets.length === 1 ? selectedAssets[0] : null
  const selectedSummary = useMemo(() => summarizeAssets(selectedAssets), [selectedAssets])
  const previewIndex = previewAssetId
    ? visibleAssets.findIndex((asset) => asset.id === previewAssetId)
    : -1
  const previewAsset = previewIndex >= 0 ? visibleAssets[previewIndex] : null

  const getPreviewPath = (asset: Asset, preferred: string[] = ['large', 'medium']) => {
    const variant =
      preferred.map((key) => asset.variants.find((v) => v.variant === key)).find(Boolean) ??
      asset.variants[0]
    if (!variant) return ''
    return buildAssetVariantPath(asset, variant, tenantSlug)
  }
  const getAssetDownloadPath = (asset: Asset) => buildAssetDownloadPath(asset, tenantSlug)

  const copyAssetLink = useCallback(
    async (asset: Asset) => {
      const path = getAssetDownloadPath(asset)
      const url =
        typeof window === 'undefined'
          ? path
          : new URL(path, window.location.origin).toString()

      try {
        await navigator.clipboard.writeText(url)
        toast.success('Asset link copied to clipboard')
      } catch {
        toast.error('Failed to copy asset link')
      }
    },
    [tenantSlug]
  )

  const getAssetSizeLabel = (asset: Asset) => {
    const sizedVariant =
      asset.variants.find((v) => v.variant === 'large' && v.width && v.height) ??
      asset.variants.find((v) => v.variant === 'medium' && v.width && v.height) ??
      asset.variants.find((v) => v.width && v.height)
    if (!sizedVariant?.width || !sizedVariant?.height) return 'Image size: unknown'
    return `Image size: ${sizedVariant.width} × ${sizedVariant.height}`
  }

  const recordActivity = useCallback((activity: Omit<MediaActivity, 'id' | 'createdAt'>) => {
    const next: MediaActivity = {
      ...activity,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
    }
    setActivityLog((prev) => [next, ...prev].slice(0, MAX_ACTIVITY_ITEMS))
  }, [])

  const persistFolders = useCallback((folders: string[]) => {
    setCustomFolders(folders)
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem('edgecms:media-manager:folders', JSON.stringify(folders))
      } catch {
        // storage disabled or quota exceeded
      }
    }
  }, [])

  const getExistingFolderSet = useCallback(() => {
    const set = new Set<string>(customFolders)
    for (const asset of assets) {
      const { folder } = splitAssetFilename(asset.filename)
      if (!folder) continue
      const segments = folder.split('/').filter(Boolean)
      for (let i = 1; i <= segments.length; i++) {
        set.add(segments.slice(0, i).join('/'))
      }
    }
    return set
  }, [assets, customFolders])

  const startCreatingFolder = () => {
    setNewFolderDraft('New Folder')
    setSelectedFolderPath(null)
    setSelectedAssetIds([])
  }

  const cancelCreatingFolder = () => {
    setNewFolderDraft(null)
  }

  const commitCreatingFolder = () => {
    if (newFolderDraft === null) return
    const cleanName = normalizeFolderPath(newFolderDraft)
    if (!cleanName) {
      setNewFolderDraft(null)
      return
    }
    const nextPath = normalizeFolderPath(currentPath ? `${currentPath}/${cleanName}` : cleanName)
    const existingFolders = getExistingFolderSet()
    if (existingFolders.has(nextPath)) {
      toast.info('Folder already exists')
      setCurrentPath(nextPath)
      setSelectedFolderPath(nextPath)
      setNewFolderDraft(null)
      return
    }
    const nextFolders = [...customFolders, nextPath]
    persistFolders(nextFolders)
    setSelectedFolderPath(nextPath)
    setNewFolderDraft(null)
    recordActivity({
      title: 'Folder created',
      detail: nextPath,
      status: 'success',
    })
  }

  const startRenamingFolder = (folderPath: string) => {
    if (!folderPath) return
    const parts = folderPath.split('/').filter(Boolean)
    const basename = parts[parts.length - 1] ?? folderPath
    setRenamingFolderPath(folderPath)
    setRenamingFolderName(basename)
    setSelectedFolderPath(folderPath)
    setContextMenu({ open: false, x: 0, y: 0 })
  }

  const cancelRenamingFolder = () => {
    setRenamingFolderPath(null)
    setRenamingFolderName('')
  }

  const remapFolderPath = async ({
    oldPath,
    newPath,
    successTitle,
    queuedTitle,
  }: {
    oldPath: string
    newPath: string
    successTitle: string
    queuedTitle: string
  }) => {
    const normalizedOldPath = normalizeFolderPath(oldPath)
    const normalizedNewPath = normalizeFolderPath(newPath)
    if (!normalizedOldPath || !normalizedNewPath || normalizedOldPath === normalizedNewPath) {
      return false
    }

    const existingFolders = getExistingFolderSet()
    if (existingFolders.has(normalizedNewPath)) {
      toast.error('Folder name already exists')
      return false
    }

    const affectedAssets = assets.filter((asset) => {
      const folder = splitAssetFilename(asset.filename).folder
      return folder === normalizedOldPath || folder.startsWith(`${normalizedOldPath}/`)
    })

    let moved = 0
    let queued = 0
    for (const asset of affectedAssets) {
      const { folder, basename } = splitAssetFilename(asset.filename)
      const nextFolder =
        folder === normalizedOldPath
          ? normalizedNewPath
          : `${normalizedNewPath}${folder.slice(normalizedOldPath.length)}`
      const nextFilename = buildAssetFilename(nextFolder, basename)
      if (!isOnline) {
        await enqueueMediaMove({ assetId: asset.id, filename: nextFilename })
        queued++
        continue
      }
      try {
        await updateFilenameMutation.mutateAsync({ id: asset.id, filename: nextFilename })
        moved++
      } catch {
        await enqueueMediaMove({ assetId: asset.id, filename: nextFilename })
        queued++
      }
    }

    const remappedFolders = customFolders.map((folder) => {
      if (folder === normalizedOldPath) return normalizedNewPath
      if (folder.startsWith(`${normalizedOldPath}/`)) {
        return `${normalizedNewPath}${folder.slice(normalizedOldPath.length)}`
      }
      return folder
    })
    persistFolders([...new Set(remappedFolders)])

    setCurrentPath((prev) => {
      if (prev === normalizedOldPath) return normalizedNewPath
      if (prev.startsWith(`${normalizedOldPath}/`)) {
        return `${normalizedNewPath}${prev.slice(normalizedOldPath.length)}`
      }
      return prev
    })
    setSelectedFolderPath(normalizedNewPath)
    cancelRenamingFolder()

    if (moved > 0) {
      recordActivity({
        title: successTitle,
        detail: `${normalizedOldPath} -> ${normalizedNewPath} (${moved} moved)`,
        status: 'success',
      })
    }
    if (queued > 0) {
      recordActivity({
        title: queuedTitle,
        detail: `${normalizedOldPath} -> ${normalizedNewPath} (${queued} queued)`,
        status: 'queued',
      })
    }
    await assetsQuery.refetch()
    return true
  }

  const commitRenamingFolder = async () => {
    const oldPath = renamingFolderPath
    if (!oldPath) return
    const cleanName = normalizeFolderPath(renamingFolderName)
    if (!cleanName) {
      cancelRenamingFolder()
      return
    }
    const oldParts = oldPath.split('/').filter(Boolean)
    const parentPath = oldParts.slice(0, -1).join('/')
    const newPath = normalizeFolderPath(parentPath ? `${parentPath}/${cleanName}` : cleanName)
    if (newPath === oldPath) {
      cancelRenamingFolder()
      return
    }

    await remapFolderPath({
      oldPath,
      newPath,
      successTitle: 'Folder renamed',
      queuedTitle: 'Folder rename queued',
    })
  }

  const setPreviewState = useCallback((assetId: string | null) => {
    setPreviewAssetId(assetId)
    setPreviewZoom(1)
  }, [])
  const openPreviewAt = useCallback(
    (assetId: string) => {
      setPreviewState(assetId)
    },
    [setPreviewState]
  )

  const goPreview = useCallback(
    (direction: -1 | 1) => {
      if (previewIndex < 0) return
      const nextIndex = previewIndex + direction
      if (nextIndex < 0 || nextIndex >= visibleAssets.length) return
      setPreviewState(visibleAssets[nextIndex]?.id ?? null)
    },
    [previewIndex, setPreviewState, visibleAssets]
  )
  const changePreviewZoom = useCallback((delta: number) => {
    setPreviewZoom((prev) => {
      const next = Math.min(PREVIEW_MAX_ZOOM, Math.max(PREVIEW_MIN_ZOOM, prev + delta))
      return Number(next.toFixed(2))
    })
  }, [])
  const resetPreviewZoom = useCallback(() => setPreviewZoom(1), [])

  const deleteAssetsByIds = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return
      if (!isOnline) {
        await enqueueMediaDelete({ ids })
        setSelectedAssetIds((prev) => prev.filter((id) => !ids.includes(id)))
        toast.success('Delete queued for offline sync')
        recordActivity({
          title: 'Delete queued',
          detail: `${ids.length} asset${ids.length === 1 ? '' : 's'} queued for deletion`,
          status: 'queued',
        })
        return
      }
      try {
        await deleteAssetsMutation.mutateAsync(ids)
        recordActivity({
          title: 'Delete completed',
          detail: `${ids.length} asset${ids.length === 1 ? '' : 's'} deleted`,
          status: 'success',
        })
      } catch {
        await enqueueMediaDelete({ ids })
        recordActivity({
          title: 'Delete queued',
          detail: `${ids.length} asset${ids.length === 1 ? '' : 's'} queued for deletion`,
          status: 'queued',
        })
      }
      setSelectedAssetIds((prev) => prev.filter((id) => !ids.includes(id)))
      await assetsQuery.refetch()
    },
    [assetsQuery, deleteAssetsMutation, isOnline, recordActivity]
  )

  useEffect(() => {
    const onClick = () => closeContextMenu()
    window.addEventListener('click', onClick)
    return () => window.removeEventListener('click', onClick)
  }, [closeContextMenu])

  useEffect(() => {
    if (newFolderDraft === null) return
    const id = window.requestAnimationFrame(() => {
      newFolderInputRef.current?.focus()
      newFolderInputRef.current?.select()
    })
    return () => window.cancelAnimationFrame(id)
  }, [newFolderDraft])

  useEffect(() => {
    if (!renamingFolderPath) return
    const id = window.requestAnimationFrame(() => {
      renameFolderInputRef.current?.focus()
      renameFolderInputRef.current?.select()
    })
    return () => window.cancelAnimationFrame(id)
  }, [renamingFolderPath])

  useEffect(() => {
    if (!hoverPreview) return

    let isDisposed = false
    let viewportRaf: number | null = null
    const updatePosition = async () => {
      const floatingEl = hoverPreviewPopupRef.current
      if (!floatingEl) return

      const dimensions = computeHoverPreviewDimensions(window.innerWidth, window.innerHeight)
      const virtualAnchor = {
        getBoundingClientRect: () => new DOMRect(hoverPreview.anchorX, hoverPreview.anchorY, 0, 0),
      }
      const { x, y } = await computePosition(virtualAnchor, floatingEl, {
        strategy: 'fixed',
        placement: 'right-start',
        middleware: [
          offset({
            mainAxis: HOVER_PREVIEW_CURSOR_OFFSET,
            crossAxis: HOVER_PREVIEW_CURSOR_OFFSET * 0.4,
          }),
          flip({
            padding: HOVER_PREVIEW_VIEWPORT_PADDING,
            fallbackPlacements: [
              'left-start',
              'right-end',
              'left-end',
              'bottom-start',
              'top-start',
            ],
          }),
          shift({ padding: HOVER_PREVIEW_VIEWPORT_PADDING }),
        ],
      })

      if (isDisposed) return
      setHoverPreviewLayout({
        left: x,
        top: y,
        width: dimensions.width,
        imageHeight: dimensions.imageHeight,
      })
    }

    const handleViewportChange = () => {
      if (viewportRaf !== null) return
      viewportRaf = window.requestAnimationFrame(() => {
        viewportRaf = null
        void updatePosition()
      })
    }

    void updatePosition()
    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('scroll', handleViewportChange, { capture: true, passive: true })

    return () => {
      isDisposed = true
      if (viewportRaf !== null) {
        window.cancelAnimationFrame(viewportRaf)
      }
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('scroll', handleViewportChange, true)
    }
  }, [hoverPreview])

  useEffect(
    () => () => {
      if (hoverPreviewTimerRef.current !== null) {
        window.clearTimeout(hoverPreviewTimerRef.current)
      }
    },
    []
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!previewAssetId) return
      if (event.key === 'Escape') {
        setPreviewState(null)
        return
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        goPreview(-1)
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        goPreview(1)
      }
      if (event.key === '+' || event.key === '=') {
        event.preventDefault()
        changePreviewZoom(PREVIEW_ZOOM_STEP)
      }
      if (event.key === '-' || event.key === '_') {
        event.preventDefault()
        changePreviewZoom(-PREVIEW_ZOOM_STEP)
      }
      if (event.key === '0') {
        event.preventDefault()
        resetPreviewZoom()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [changePreviewZoom, goPreview, previewAssetId, resetPreviewZoom, setPreviewState])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return
      }
      if (previewAssetId) return
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        setSelectedAssetIds(visibleAssetIds)
        setSelectedFolderPath(null)
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selectedAssetIds.length === 0) return
        event.preventDefault()
        setPendingDeleteIds(selectedAssetIds)
        return
      }
      if (event.key === 'Enter') {
        if (selectedFolderPath) {
          event.preventDefault()
          setCurrentPath(selectedFolderPath)
          setSelectedFolderPath(null)
          return
        }
        if (selectedAssetIds.length === 1) {
          event.preventDefault()
          setPreviewState(selectedAssetIds[0] ?? null)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    deleteAssetsByIds,
    previewAssetId,
    selectedAssetIds,
    selectedFolderPath,
    setCurrentPath,
    setPreviewState,
    visibleAssetIds,
  ])

  useEffect(() => {
    if (!previewAssetId) return
    previewDialogRef.current?.focus()
  }, [previewAssetId])

  useEffect(() => {
    setSelectedAssetIds((prev) => {
      if (prev.length === 0) return prev
      const next = prev.filter((id) => assets.some((asset) => asset.id === id))
      return next.length === prev.length ? prev : next
    })
  }, [assets])

  const replayQueuedMedia = useCallback(
    async (silent = false) => {
      if (!isOnline) return
      const pendingBefore = await db.mediaQueue.where('status').equals('pending').count()
      if (pendingBefore === 0) {
        if (!silent) toast.info('No queued media operations')
        return
      }

      setIsSyncingQueue(true)
      try {
        await processMediaQueue({
          upload: async (payload) => {
            await uploadMutation.mutateAsync(payload)
          },
          move: async ({ assetId, filename }) => {
            await updateFilenameMutation.mutateAsync({ id: assetId, filename })
          },
          deleteAssets: async ({ ids }) => {
            await deleteAssetsMutation.mutateAsync(ids)
          },
        })
        await assetsQuery.refetch()
        recordActivity({
          title: 'Queue sync completed',
          detail: `${pendingBefore} queued operation${pendingBefore === 1 ? '' : 's'} processed`,
          status: 'success',
        })
      } catch {
        recordActivity({
          title: 'Queue sync failed',
          detail: 'Some offline tasks remain pending',
          status: 'error',
        })
        toast.error('Some offline media tasks remain queued')
      } finally {
        setIsSyncingQueue(false)
      }
    },
    [
      assetsQuery,
      deleteAssetsMutation,
      isOnline,
      recordActivity,
      updateFilenameMutation,
      uploadMutation,
    ]
  )

  const replayQueuedMediaRef = useRef(replayQueuedMedia)
  replayQueuedMediaRef.current = replayQueuedMedia

  useEffect(() => {
    setIsOnline(typeof navigator === 'undefined' ? true : navigator.onLine)
    const onOnline = () => {
      setIsOnline(true)
      void replayQueuedMediaRef.current(true)
    }
    const onOffline = () => {
      setIsOnline(false)
    }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  useEffect(() => {
    void replayQueuedMediaRef.current(true)
  }, [])

  const queueAwareUpload = async (files: File[]) => {
    const selections = buildUploadSelections(files, currentPath)
    const uploadBatch = selections.slice(0, MAX_UPLOAD_BATCH_SIZE)
    if (selections.length > MAX_UPLOAD_BATCH_SIZE) {
      toast.info(
        `Upload batch limited to ${MAX_UPLOAD_BATCH_SIZE} files. ${selections.length - MAX_UPLOAD_BATCH_SIZE} skipped.`
      )
    }

    let uploaded = 0
    let queued = 0
    let blocked = 0
    let failed = 0

    for (const { file, folderPath } of uploadBatch) {
      const mimeType = resolveFileMimeType(file)
      if (
        !isFileAllowedForUpload(file, allowedMimeTypes) ||
        (!mimeType.startsWith('image/') && file.size > maxUploadBytes)
      ) {
        blocked++
        continue
      }
      if (!isOnline) {
        try {
          const optimized = await optimizeImageForUpload({
            file,
            folderPath,
            quality: quality / 100,
            maxDimension: maxUploadDimension,
            maxUploadBytes,
          })
          await enqueueMediaUpload(optimized)
          queued++
        } catch {
          failed++
        }
        continue
      }

      try {
        const optimized = await optimizeImageForUpload({
          file,
          folderPath,
          quality: quality / 100,
          maxDimension: maxUploadDimension,
          maxUploadBytes,
        })
        await uploadMutation.mutateAsync(optimized)
        uploaded++
      } catch (error) {
        if (isPermanentUploadFailure(error)) {
          failed++
          continue
        }
        try {
          const optimized = await optimizeImageForUpload({
            file,
            folderPath,
            quality: quality / 100,
            maxDimension: maxUploadDimension,
            maxUploadBytes,
          })
          await enqueueMediaUpload(optimized)
          queued++
        } catch {
          failed++
        }
      }
    }

    if (uploaded > 0) {
      recordActivity({
        title: 'Upload completed',
        detail: `${uploaded} asset${uploaded === 1 ? '' : 's'} uploaded`,
        status: 'success',
      })
    }
    if (queued > 0) {
      recordActivity({
        title: 'Upload queued',
        detail: `${queued} asset${queued === 1 ? '' : 's'} queued for sync`,
        status: 'queued',
      })
    }
    if (failed > 0) {
      recordActivity({
        title: 'Upload failed',
        detail: `${failed} file${failed === 1 ? '' : 's'} failed processing`,
        status: 'error',
      })
      toast.error('Some files could not be processed')
    }

    if (uploaded > 0 || queued > 0) {
      toast.success(
        `Processed uploads: ${uploaded} uploaded, ${queued} queued${blocked > 0 ? `, ${blocked} blocked` : ''}`
      )
    } else if (blocked > 0) {
      toast.info(
        `No files uploaded. ${blocked} blocked by tenant file policy.`
      )
    }

    await assetsQuery.refetch()
  }

  const handleUploadInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length === 0) return
    await queueAwareUpload(files)
  }

  const moveAssetsToFolder = async (assetIds: string[], folderPath: string) => {
    const normalizedFolder = normalizeFolderPath(folderPath)

    const targets = assets.filter((asset) => assetIds.includes(asset.id))
    let moved = 0
    let queued = 0

    for (const asset of targets) {
      const { basename } = splitAssetFilename(asset.filename)
      const filename = buildAssetFilename(normalizedFolder, basename)
      if (filename === asset.filename) continue
      if (!isOnline) {
        await enqueueMediaMove({ assetId: asset.id, filename })
        queued++
        continue
      }
      try {
        await updateFilenameMutation.mutateAsync({ id: asset.id, filename })
        moved++
      } catch {
        await enqueueMediaMove({ assetId: asset.id, filename })
        queued++
      }
    }

    if (moved > 0) {
      recordActivity({
        title: 'Move completed',
        detail: `${moved} asset${moved === 1 ? '' : 's'} moved to ${normalizedFolder || '/'}`,
        status: 'success',
      })
    }
    if (queued > 0) {
      recordActivity({
        title: 'Move queued',
        detail: `${queued} asset${queued === 1 ? '' : 's'} queued to move to ${normalizedFolder || '/'}`,
        status: 'queued',
      })
    }

    await assetsQuery.refetch()
  }

  const handleAssetClick = (assetId: string, index: number, event: React.MouseEvent) => {
    setSelectedFolderPath(null)
    if (event.shiftKey && anchorIndex !== null) {
      const start = Math.min(anchorIndex, index)
      const end = Math.max(anchorIndex, index)
      const range = visibleAssetIds.slice(start, end + 1)
      setSelectedAssetIds((prev) => [...new Set([...prev, ...range])])
      return
    }

    if (event.metaKey || event.ctrlKey) {
      setSelectedAssetIds((prev) =>
        prev.includes(assetId) ? prev.filter((id) => id !== assetId) : [...prev, assetId]
      )
      setAnchorIndex(index)
      return
    }

    setSelectedAssetIds([assetId])
    setAnchorIndex(index)
  }

  const handleFolderClick = (folderPath: string) => {
    setSelectedFolderPath(folderPath)
    setSelectedAssetIds([])
    setAnchorIndex(null)
  }

  const onGalleryDrop: React.DragEventHandler<HTMLDivElement> = async (event) => {
    event.preventDefault()
    setIsDraggingFiles(false)
    const files = Array.from(event.dataTransfer.files ?? [])
    if (files.length > 0) {
      await queueAwareUpload(files)
      return
    }
  }

  const onFolderDrop = async (folderPath: string, event: React.DragEvent) => {
    event.preventDefault()
    const draggedFolderPath = event.dataTransfer.getData(DRAG_FOLDER_DATA_TYPE)
    if (draggedFolderPath) {
      const nextFolderPath = getMovedFolderPath(draggedFolderPath, folderPath)
      if (!nextFolderPath) return
      await remapFolderPath({
        oldPath: draggedFolderPath,
        newPath: nextFolderPath,
        successTitle: 'Folder moved',
        queuedTitle: 'Folder move queued',
      })
      return
    }

    const raw = event.dataTransfer.getData(DRAG_ASSETS_DATA_TYPE)
    if (!raw) return
    let draggedIds: string[] = []
    try {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        draggedIds = parsed.filter((value): value is string => typeof value === 'string')
      }
    } catch {
      toast.error('Could not resolve dragged assets')
      return
    }
    if (draggedIds.length === 0) return
    const normalizedTarget = normalizeFolderPath(folderPath)
    const movableIds = draggedIds.filter((id) => {
      const asset = assets.find((candidate) => candidate.id === id)
      if (!asset) return false
      return splitAssetFilename(asset.filename).folder !== normalizedTarget
    })
    if (movableIds.length === 0) return
    await moveAssetsToFolder(movableIds, normalizedTarget)
  }

  const formatUploadedDate = (value?: string) => (value ? toRelativeTime(value) : '—')
  const formatUpdatedDate = (asset: Asset) => {
    const value = asset.updatedAt ?? asset.createdAt
    return value ? toRelativeTime(value) : '—'
  }
  const formatAssetDimensions = (asset: Asset) => {
    const sizedVariant =
      asset.variants.find((v) => v.variant === 'large' && v.width && v.height) ??
      asset.variants.find((v) => v.variant === 'medium' && v.width && v.height) ??
      asset.variants.find((v) => v.width && v.height)
    if (!sizedVariant?.width || !sizedVariant?.height) return 'unknown'
    return `${sizedVariant.width}x${sizedVariant.height}`
  }

  const clearHoverPreview = useCallback(() => {
    if (hoverPreviewTimerRef.current !== null) {
      window.clearTimeout(hoverPreviewTimerRef.current)
      hoverPreviewTimerRef.current = null
    }
    setHoverPreview(null)
    setHoverPreviewLayout(null)
  }, [])

  const scheduleHoverPreview = useCallback(
    (asset: Asset, previewPath: string, basename: string, folder: string, x: number, y: number) => {
      if (hoverPreviewTimerRef.current !== null) {
        window.clearTimeout(hoverPreviewTimerRef.current)
      }
      hoverPreviewTimerRef.current = window.setTimeout(() => {
        const dimensions = computeHoverPreviewDimensions(window.innerWidth, window.innerHeight)
        setHoverPreview({ asset, previewPath, basename, folder, anchorX: x, anchorY: y })
        setHoverPreviewLayout({
          left: x + HOVER_PREVIEW_CURSOR_OFFSET,
          top: y + HOVER_PREVIEW_CURSOR_OFFSET,
          width: dimensions.width,
          imageHeight: dimensions.imageHeight,
        })
        hoverPreviewTimerRef.current = null
      }, HOVER_PREVIEW_DELAY_MS)
    },
    []
  )

  return (
    <>
      <AuthPageHeader />

      <Main
        className='flex flex-1 flex-col gap-3 sm:gap-4'
        onDragOver={(event) => {
          event.preventDefault()
          if (event.dataTransfer.types.includes('Files')) setIsDraggingFiles(true)
        }}
        onDragLeave={() => setIsDraggingFiles(false)}
        onDrop={onGalleryDrop}
      >
        <div className='flex flex-wrap items-end justify-between gap-3'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>Media File Manager</h2>
            <p className='text-muted-foreground'>
              Enterprise controls for upload governance, bulk operations, filtering, and offline
              queue recovery.
            </p>
          </div>
          <div className='flex flex-wrap items-center gap-2'>
            {isOnline ? (
              <Badge variant='outline' className='gap-1'>
                <CheckCircle2 className='h-3.5 w-3.5 text-emerald-600' />
                Online
              </Badge>
            ) : (
              <Badge variant='destructive' className='gap-1'>
                <WifiOff className='h-3.5 w-3.5' />
                Offline
              </Badge>
            )}
            <Badge variant='secondary'>{pendingMediaCount} queued</Badge>
            <Badge variant='outline'>{selectedSummary.count} selected</Badge>
            {selectedDownloadAsset ? (
              <Button variant='outline' size='sm' asChild>
                <a
                  href={getAssetDownloadPath(selectedDownloadAsset)}
                  download={splitAssetFilename(selectedDownloadAsset.filename).basename}
                >
                  <Download className='h-4 w-4' />
                  Download Selected
                </a>
              </Button>
            ) : (
              <Button variant='outline' size='sm' disabled>
                <Download className='h-4 w-4' />
                Download Selected
              </Button>
            )}
            <Button
              variant='outline'
              onClick={() => void replayQueuedMedia()}
              disabled={!isOnline || isSyncingQueue}
              size='sm'
            >
              <RefreshCw className={cn('h-4 w-4', isSyncingQueue && 'animate-spin')} />
              Sync Queue
            </Button>
            <Button
              variant='destructive'
              onClick={() => setPendingDeleteIds(selectedAssetIds)}
              disabled={selectedAssetIds.length === 0}
              size='sm'
            >
              <Trash2 className='h-4 w-4' />
              Delete Selected
            </Button>
          </div>
        </div>

        <Card className='mt-4'>
          <CardContent className='space-y-4 p-4 sm:p-5'>
            <MediaToolbar
              searchTerm={searchTerm}
              onSearchTermChange={setSearchTerm}
              mimeCategoryFilter={mimeCategoryFilter}
              onMimeCategoryFilterChange={setMimeCategoryFilter}
              mimeCategoryOptions={mimeCategoryOptions}
              sortBy={sortBy}
              onSortByChange={setSortBy}
              sortDirection={sortDirection}
              onSortDirectionToggle={() =>
                setSortDirection((prev) =>
                  prev === 'asc' ? 'desc' : 'asc'
                )
              }
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              breadcrumbItems={breadcrumbItems}
              currentPath={currentPath}
              onPathChange={(path) => {
                setCurrentPath(path)
                setSelectedFolderPath(null)
              }}
              onFolderDrop={onFolderDrop}
              dragAssetDataType={DRAG_ASSETS_DATA_TYPE}
              dragFolderDataType={DRAG_FOLDER_DATA_TYPE}
              totalAssetCount={assets.length}
              librarySummary={librarySummary}
              visibleSummary={visibleSummary}
              selectedSummary={selectedSummary}
              pendingMediaCount={pendingMediaCount}
              onStartCreatingFolder={startCreatingFolder}
              onUploadFiles={() => filesUploadInputRef.current?.click()}
              onUploadFolder={() => folderUploadInputRef.current?.click()}
              showQualitySettings={showQualitySettings}
              onToggleQualitySettings={() =>
                setShowQualitySettings((prev) => !prev)
              }
              quality={quality}
              onQualityChange={setQuality}
              maxUploadBytes={maxUploadBytes}
              maxUploadDimension={maxUploadDimension}
              allowedMimeTypes={allowedMimeTypes}
            />
            <input
              ref={filesUploadInputRef}
              type='file'
              accept={uploadAccept}
              multiple
              className='hidden'
              onChange={(event) => void handleUploadInputChange(event)}
            />
            <input
              ref={folderUploadInputRef}
              type='file'
              accept={uploadAccept}
              multiple
              className='hidden'
              onChange={(event) => void handleUploadInputChange(event)}
              {...({ webkitdirectory: '' } satisfies DirectoryInputProps)}
            />
            {assetsQuery.error && (
              <div className='flex items-center justify-between rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm'>
                <span>Failed to load media assets. Retry to recover.</span>
                <Button variant='outline' size='sm' onClick={() => void assetsQuery.refetch()}>
                  Retry
                </Button>
              </div>
            )}

            {assetsQuery.isLoading ? (
              <div className='rounded-md border border-dashed p-6 text-sm text-muted-foreground'>
                Loading media library...
              </div>
            ) : entries.length === 0 ? (
              <div className='rounded-md border border-dashed p-6 text-sm text-muted-foreground'>
                No assets or folders found for this folder/filter combination.
              </div>
            ) : viewMode === 'grid' ? (
              <div className='space-y-3'>
                {(newFolderDraft !== null || folderEntries.length > 0) && (
                  <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
                    {newFolderDraft !== null && (
                      <div className='h-[92px] rounded-lg border border-primary/60 bg-card p-3'>
                        <div className='flex items-center gap-2'>
                          <FolderOpen className='h-5 w-5 text-amber-500' />
                          <Input
                            ref={newFolderInputRef}
                            value={newFolderDraft}
                            onChange={(event) => setNewFolderDraft(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault()
                                commitCreatingFolder()
                              }
                              if (event.key === 'Escape') {
                                event.preventDefault()
                                cancelCreatingFolder()
                              }
                            }}
                            onBlur={commitCreatingFolder}
                            className='h-7'
                            aria-label='New folder name'
                          />
                        </div>
                      </div>
                    )}
                    {folderEntries.map((entry) => (
                      <button
                        key={`folder:${entry.path}`}
                        type='button'
                        className={cn(
                          'relative h-[92px] rounded-lg border bg-card p-3 text-left hover:bg-muted/50',
                          'border-border'
                        )}
                        onClick={() => handleFolderClick(entry.path)}
                        onDoubleClick={() => {
                          setCurrentPath(entry.path)
                          setSelectedFolderPath(null)
                        }}
                        onContextMenu={(event) => {
                          event.preventDefault()
                          setSelectedFolderPath(entry.path)
                          setSelectedAssetIds([])
                          setContextMenu({ open: true, x: event.clientX, y: event.clientY, entry })
                        }}
                        draggable={renamingFolderPath !== entry.path}
                        onDragStart={(event) => {
                          event.dataTransfer.setData(DRAG_FOLDER_DATA_TYPE, entry.path)
                        }}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => void onFolderDrop(entry.path, event)}
                      >
                        {selectedFolderPath === entry.path && (
                          <span className='pointer-events-none absolute left-1.5 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-primary/80' />
                        )}
                        <div className='flex items-center gap-2'>
                          <FolderOpen className='h-5 w-5 text-amber-500' />
                          {renamingFolderPath === entry.path ? (
                            <Input
                              ref={renameFolderInputRef}
                              value={renamingFolderName}
                              onChange={(event) => setRenamingFolderName(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault()
                                  void commitRenamingFolder()
                                }
                                if (event.key === 'Escape') {
                                  event.preventDefault()
                                  cancelRenamingFolder()
                                }
                              }}
                              onBlur={() => void commitRenamingFolder()}
                              className='h-7'
                              aria-label='Rename folder'
                            />
                          ) : (
                            <span className='truncate font-medium'>{entry.name}</span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
                  {assetEntries.map((entry, idx) => {
                    const asset = entry.asset
                    const previewPath = getPreviewPath(asset, ['medium', 'small'])
                    const isSelected = selectedAssetIds.includes(asset.id)
                    const assetIndex = visibleAssetIds.indexOf(asset.id)
                    const dragIds = isSelected ? selectedAssetIds : [asset.id]
                    const { basename, folder } = splitAssetFilename(asset.filename)

                    return (
                      <div
                        key={`asset:${asset.id}`}
                        className={cn(
                          'group relative flex h-full cursor-pointer flex-col rounded-lg border bg-card',
                          'border-border'
                        )}
                        onClick={(event) =>
                          handleAssetClick(asset.id, assetIndex >= 0 ? assetIndex : idx, event)
                        }
                        onDoubleClick={() => openPreviewAt(asset.id)}
                        onContextMenu={(event) => {
                          event.preventDefault()
                          if (!selectedAssetIds.includes(asset.id)) {
                            setSelectedAssetIds([asset.id])
                            setAnchorIndex(assetIndex >= 0 ? assetIndex : idx)
                          }
                          setSelectedFolderPath(null)
                          setContextMenu({
                            open: true,
                            x: event.clientX,
                            y: event.clientY,
                            entry,
                          })
                        }}
                      >
                        {isSelected && (
                          <span className='pointer-events-none absolute left-1.5 top-1/2 z-20 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-primary/80' />
                        )}
                        <a
                          className='absolute right-2 top-2 z-20 rounded-md bg-background/90 p-1.5 text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-foreground focus:opacity-100 group-hover:opacity-100'
                          href={getAssetDownloadPath(asset)}
                          download={basename}
                          aria-label={`Download original file ${basename}`}
                          title='Download original'
                          onClick={(event) => event.stopPropagation()}
                          onDoubleClick={(event) => event.stopPropagation()}
                        >
                          <Download className='h-4 w-4' />
                        </a>
                        <div
                          className='relative block h-40 w-full overflow-hidden bg-muted'
                          draggable
                          onMouseEnter={(event) =>
                            scheduleHoverPreview(
                              asset,
                              previewPath,
                              basename,
                              folder,
                              event.clientX,
                              event.clientY
                            )
                          }
                          onMouseLeave={clearHoverPreview}
                          onDragStart={(event) => {
                            event.dataTransfer.setData(
                              DRAG_ASSETS_DATA_TYPE,
                              JSON.stringify(dragIds)
                            )
                          }}
                        >
                          {previewPath ? (
                            <img
                              src={previewPath}
                              alt={asset.filename}
                              className='h-full w-full object-cover'
                              loading='lazy'
                            />
                          ) : (
                            <div className='flex h-full items-center justify-center text-muted-foreground'>
                              <ImageIcon className='h-8 w-8' />
                            </div>
                          )}
                        </div>
                        <div className='p-3 text-sm'>
                          <p className='truncate font-medium'>{basename}</p>
                          <div className='mt-0.5 flex items-center justify-between gap-2 text-xs text-muted-foreground'>
                            <span className='truncate'>{formatBytes(asset.size)}</span>
                            <span className='shrink-0'>{formatUpdatedDate(asset)}</span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : (
              <div className='overflow-hidden rounded-md border'>
                <div className='grid grid-cols-[minmax(0,1fr)_140px_110px_150px] border-b bg-muted/30 px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground'>
                  <span>Asset / Folder</span>
                  <span>Type</span>
                  <span>Size</span>
                  <span>Uploaded</span>
                </div>
                <div className='divide-y'>
                  {newFolderDraft !== null && (
                    <div className='grid grid-cols-[minmax(0,1fr)_140px_110px_150px] items-center px-3 py-2'>
                      <span className='flex items-center gap-2'>
                        <FolderOpen className='h-4 w-4 text-amber-500' />
                        <Input
                          ref={newFolderInputRef}
                          value={newFolderDraft}
                          onChange={(event) => setNewFolderDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              commitCreatingFolder()
                            }
                            if (event.key === 'Escape') {
                              event.preventDefault()
                              cancelCreatingFolder()
                            }
                          }}
                          onBlur={commitCreatingFolder}
                          className='h-7'
                          aria-label='New folder name'
                        />
                      </span>
                      <span className='text-xs text-muted-foreground'>Folder</span>
                      <span className='text-xs text-muted-foreground'>-</span>
                      <span className='text-xs text-muted-foreground'>{currentPath || '/'}</span>
                    </div>
                  )}
                  {entries.map((entry, idx) => {
                    if (entry.type === 'folder') {
                      return (
                        <button
                          key={`list-folder:${entry.path}`}
                          type='button'
                          className={cn(
                            'relative grid w-full grid-cols-[minmax(0,1fr)_140px_110px_150px] items-center px-3 py-2 ps-5 text-left text-sm hover:bg-muted/40'
                          )}
                          onClick={() => handleFolderClick(entry.path)}
                          onDoubleClick={() => {
                            setCurrentPath(entry.path)
                            setSelectedFolderPath(null)
                          }}
                          onContextMenu={(event) => {
                            event.preventDefault()
                            setSelectedFolderPath(entry.path)
                            setSelectedAssetIds([])
                            setContextMenu({
                              open: true,
                              x: event.clientX,
                              y: event.clientY,
                              entry,
                            })
                          }}
                          draggable={renamingFolderPath !== entry.path}
                          onDragStart={(event) => {
                            event.dataTransfer.setData(DRAG_FOLDER_DATA_TYPE, entry.path)
                          }}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => void onFolderDrop(entry.path, event)}
                        >
                          {selectedFolderPath === entry.path && (
                            <span className='pointer-events-none absolute left-2 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-primary/80' />
                          )}
                          <span className='flex items-center gap-2 truncate'>
                            <FolderOpen className='h-4 w-4 text-amber-500' />
                            {renamingFolderPath === entry.path ? (
                              <Input
                                ref={renameFolderInputRef}
                                value={renamingFolderName}
                                onChange={(event) => setRenamingFolderName(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') {
                                    event.preventDefault()
                                    void commitRenamingFolder()
                                  }
                                  if (event.key === 'Escape') {
                                    event.preventDefault()
                                    cancelRenamingFolder()
                                  }
                                }}
                                onBlur={() => void commitRenamingFolder()}
                                className='h-7'
                                aria-label='Rename folder'
                              />
                            ) : (
                              <span className='truncate'>{entry.name}</span>
                            )}
                          </span>
                          <span className='text-xs text-muted-foreground'>Folder</span>
                          <span className='text-xs text-muted-foreground'>-</span>
                          <span className='text-xs text-muted-foreground'>{entry.path}</span>
                        </button>
                      )
                    }

                    const asset = entry.asset
                    const previewPath = getPreviewPath(asset, ['small', 'medium'])
                    const isSelected = selectedAssetIds.includes(asset.id)
                    const assetIndex = visibleAssetIds.indexOf(asset.id)
                    const dragIds = isSelected ? selectedAssetIds : [asset.id]

                    return (
                      <button
                        key={`list-asset:${asset.id}`}
                        type='button'
                        className={cn(
                          'relative grid w-full grid-cols-[minmax(0,1fr)_140px_110px_150px] items-center px-3 py-2 ps-5 text-left text-sm hover:bg-muted/40'
                        )}
                        draggable
                        onDragStart={(event) => {
                          event.dataTransfer.setData(DRAG_ASSETS_DATA_TYPE, JSON.stringify(dragIds))
                        }}
                        onClick={(event) =>
                          handleAssetClick(asset.id, assetIndex >= 0 ? assetIndex : idx, event)
                        }
                        onDoubleClick={() => openPreviewAt(asset.id)}
                        onContextMenu={(event) => {
                          event.preventDefault()
                          if (!selectedAssetIds.includes(asset.id)) {
                            setSelectedAssetIds([asset.id])
                            setAnchorIndex(assetIndex >= 0 ? assetIndex : idx)
                          }
                          setSelectedFolderPath(null)
                          setContextMenu({ open: true, x: event.clientX, y: event.clientY, entry })
                        }}
                      >
                        {isSelected && (
                          <span className='pointer-events-none absolute left-2 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-primary/80' />
                        )}
                        <span className='flex min-w-0 items-center gap-2'>
                          {previewPath ? (
                            <img
                              src={previewPath}
                              alt={asset.filename}
                              className='h-8 w-8 rounded object-cover'
                              loading='lazy'
                            />
                          ) : (
                            <span className='flex h-8 w-8 items-center justify-center rounded bg-muted'>
                              <ImageIcon className='h-4 w-4 text-muted-foreground' />
                            </span>
                          )}
                          <span className='min-w-0'>
                            <span className='block truncate font-medium'>
                              {splitAssetFilename(asset.filename).basename}
                            </span>
                            <span className='block truncate text-xs text-muted-foreground'>
                              {splitAssetFilename(asset.filename).folder || '/'}
                            </span>
                          </span>
                        </span>
                        <span className='truncate text-xs text-muted-foreground'>
                          {asset.mimeType}
                        </span>
                        <span className='text-xs text-muted-foreground'>
                          {formatBytes(asset.size)}
                        </span>
                        <span className='truncate text-xs text-muted-foreground'>
                          {formatUploadedDate(asset.createdAt)}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            <ActivityLogPanel
              activityLog={activityLog}
              onClear={() => setActivityLog([])}
            />
          </CardContent>
        </Card>

        {isDraggingFiles && (
          <div className='pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-background/70 backdrop-blur-sm'>
            <div className='rounded-lg border border-dashed border-primary bg-card px-6 py-4 text-sm font-medium'>
              Drop images anywhere to upload into{' '}
              <span className='font-bold'>{currentPath || '/'}</span>
            </div>
          </div>
        )}

        {hoverPreview && hoverPreviewLayout && (
          <HoverPreview
            hoverPreview={hoverPreview}
            hoverPreviewLayout={hoverPreviewLayout}
            popupRef={hoverPreviewPopupRef}
            formatAssetDimensions={formatAssetDimensions}
            formatUpdatedDate={formatUpdatedDate}
            formatUploadedDate={formatUploadedDate}
          />
        )}

        {contextMenu.open && (
          <MediaContextMenu
            contextMenu={contextMenu}
            selectedAssetIds={selectedAssetIds}
            getAssetDownloadPath={getAssetDownloadPath}
            getAssetSizeLabel={getAssetSizeLabel}
            onOpenFolder={setCurrentPath}
            onMoveSelectedToFolder={(path) =>
              void moveAssetsToFolder(selectedAssetIds, path)
            }
            onRenameFolder={startRenamingFolder}
            onOpenPreview={openPreviewAt}
            onCopyAssetLink={(asset) => void copyAssetLink(asset)}
            onOpenContainingFolder={setCurrentPath}
            onDeleteAsset={(id) => setPendingDeleteIds([id])}
            onClose={closeContextMenu}
          />
        )}

        {previewAsset && (
          <MediaPreviewModal
            previewAsset={previewAsset}
            previewZoom={previewZoom}
            previewIndex={previewIndex}
            visibleAssetsCount={visibleAssets.length}
            previewDialogRef={previewDialogRef}
            getPreviewPath={getPreviewPath}
            getDownloadPath={getAssetDownloadPath}
            getAssetSizeLabel={getAssetSizeLabel}
            onClose={() => setPreviewState(null)}
            onPrev={() => goPreview(-1)}
            onNext={() => goPreview(1)}
            onZoomIn={() => changePreviewZoom(PREVIEW_ZOOM_STEP)}
            onZoomOut={() => changePreviewZoom(-PREVIEW_ZOOM_STEP)}
            onZoomReset={resetPreviewZoom}
            onTrapFocus={trapPreviewFocus}
            minZoom={PREVIEW_MIN_ZOOM}
            maxZoom={PREVIEW_MAX_ZOOM}
          />
        )}
      </Main>
      <ConfirmDialog
        open={!!pendingDeleteIds}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteIds(null)
        }}
        title='Delete selected assets?'
        desc='This action permanently deletes assets and cannot be undone.'
        confirmText='Delete'
        destructive
        handleConfirm={async () => {
          if (!pendingDeleteIds?.length) return
          await deleteAssetsByIds(pendingDeleteIds)
          setPendingDeleteIds(null)
        }}
      />
    </>
  )
}
