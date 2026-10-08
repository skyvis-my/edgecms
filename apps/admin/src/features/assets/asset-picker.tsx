import {
  ArrowUpDown,
  Check,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  RefreshCw,
  Search,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { getCurrentTenantSlug, TENANT_SWITCH_EVENT } from '@/lib/tenant-storage'
import { cn } from '@/lib/utils'
import { type Asset, useAssets, useSemanticAssetSearch } from './api'
import { assetMatchesManagerQuery, buildAssetVariantPath } from './media-manager-utils'
import { splitAssetFilename } from './media-utils'

type AssetSelection = { assetId: string; variant?: string }
type AssetPickerValue = AssetSelection | AssetSelection[] | null | undefined

type AssetPickerProps = {
  value?: AssetPickerValue
  onChange: (value: AssetSelection | AssetSelection[] | null) => void
  disabled?: boolean
  smartKeywords?: string[]
}

function resolveVariant(asset: Asset, variant?: string): string | undefined {
  if (!asset.variants.length) return undefined
  const explicit = asset.variants.find((candidate) => candidate.variant === variant)
  if (explicit) return explicit.variant
  return asset.variants[0]?.variant
}

function buildPreviewSrc(asset: Asset, variant?: string, tenantSlug?: string | null): string | null {
  const preferred =
    asset.variants.find((candidate) => candidate.variant === variant) ??
    ['medium', 'large', 'small', 'thumbnail']
      .map((key) => asset.variants.find((candidate) => candidate.variant === key))
      .find(Boolean) ??
    asset.variants[0]

  if (!preferred) return null
  return buildAssetVariantPath(asset, preferred, tenantSlug)
}

function isImageAsset(asset: Asset): boolean {
  return asset.mimeType.startsWith('image/')
}

function useActiveTenantSlug(): string | null {
  const [tenantSlug, setTenantSlug] = useState(() => getCurrentTenantSlug())

  useEffect(() => {
    const updateTenantSlug = () => setTenantSlug(getCurrentTenantSlug())

    window.addEventListener(TENANT_SWITCH_EVENT, updateTenantSlug)
    window.addEventListener('storage', updateTenantSlug)

    return () => {
      window.removeEventListener(TENANT_SWITCH_EVENT, updateTenantSlug)
      window.removeEventListener('storage', updateTenantSlug)
    }
  }, [])

  return tenantSlug
}

function normalizeSelection(value: AssetPickerValue): AssetSelection[] {
  const raw = Array.isArray(value) ? value : value ? [value] : []
  const unique = new Map<string, AssetSelection>()
  for (const item of raw) {
    if (!item?.assetId) continue
    unique.set(item.assetId, { assetId: item.assetId, variant: item.variant })
  }
  return [...unique.values()]
}

export function AssetPicker({ value, onChange, disabled, smartKeywords }: AssetPickerProps) {
  const assetsQuery = useAssets()
  const tenantSlug = useActiveTenantSlug()
  const [query, setQuery] = useState('')
  const [folderFilter, setFolderFilter] = useState('all')
  const [semanticSearchEnabled, setSemanticSearchEnabled] = useState(true)
  const [sortBy, setSortBy] = useState<'newest' | 'name' | 'size'>('newest')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')

  const normalizedSelection = useMemo(() => normalizeSelection(value), [value])
  const [isSelectorOpen, setIsSelectorOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    if (normalizedSelection.length === 0) {
      setActiveIndex(0)
      return
    }
    setActiveIndex((current) => Math.min(current, normalizedSelection.length - 1))
  }, [normalizedSelection.length])

  const assets = assetsQuery.data ?? []
  const selectedAssetIds = new Set(normalizedSelection.map((item) => item.assetId))

  const selectedAssets = useMemo(
    () =>
      normalizedSelection
        .map((selection) => {
          const asset = assets.find((candidate) => candidate.id === selection.assetId)
          if (!asset) return null
          return {
            asset,
            selection: {
              assetId: selection.assetId,
              variant: resolveVariant(asset, selection.variant),
            },
          }
        })
        .filter(Boolean) as Array<{ asset: Asset; selection: AssetSelection }>,
    [assets, normalizedSelection]
  )

  const smartQuery = useMemo(
    () =>
      (smartKeywords ?? [])
        .map((part) => part.trim())
        .filter(Boolean)
        .join(' ')
        .trim(),
    [smartKeywords]
  )

  const activeQuery = query.trim() || smartQuery
  const semanticQuery = useSemanticAssetSearch(
    {
      query: activeQuery,
      limit: 30,
      folder: folderFilter !== 'all' ? folderFilter : undefined,
      mimeTypePrefix: undefined,
    },
    semanticSearchEnabled
  )

  const filteredAssets = useMemo(() => {
    return assets.filter((asset) => {
      const { folder } = splitAssetFilename(asset.filename)
      const inFolder = folderFilter === 'all' || folder === folderFilter
      if (!inFolder) return false
      return assetMatchesManagerQuery(asset, query)
    })
  }, [assets, query, folderFilter])

  const semanticAssets = semanticQuery.data ?? []
  const queryConstrainedSemanticAssets = useMemo(() => {
    if (!query.trim()) return semanticAssets
    return semanticAssets.filter((asset) => assetMatchesManagerQuery(asset, query))
  }, [semanticAssets, query])
  const displayedAssets = useMemo(() => {
    if (semanticSearchEnabled && queryConstrainedSemanticAssets.length > 0) {
      return queryConstrainedSemanticAssets
    }
    return filteredAssets
  }, [semanticSearchEnabled, queryConstrainedSemanticAssets, filteredAssets])

  const sortedDisplayedAssets = useMemo(() => {
    const next = [...displayedAssets]
    const dir = sortDirection === 'asc' ? 1 : -1
    next.sort((a, b) => {
      if (sortBy === 'name') {
        return a.filename.localeCompare(b.filename) * dir
      }
      if (sortBy === 'size') {
        if (a.size === b.size) return a.filename.localeCompare(b.filename) * dir
        return (a.size - b.size) * dir
      }

      const aTime = Date.parse(a.createdAt ?? '')
      const bTime = Date.parse(b.createdAt ?? '')
      const normalizedATime = Number.isNaN(aTime) ? 0 : aTime
      const normalizedBTime = Number.isNaN(bTime) ? 0 : bTime
      if (normalizedATime === normalizedBTime) return a.filename.localeCompare(b.filename) * dir
      return (normalizedATime - normalizedBTime) * dir
    })
    return next
  }, [displayedAssets, sortBy, sortDirection])

  const activeAsset = selectedAssets[activeIndex]?.asset ?? null
  const activeSelection = selectedAssets[activeIndex]?.selection ?? null
  const previewSrc =
    activeAsset && activeSelection
      ? buildPreviewSrc(activeAsset, activeSelection.variant, tenantSlug)
      : null

  const emitSelection = (next: AssetSelection[]) => {
    if (next.length === 0) {
      onChange(null)
      return
    }

    if (next.length === 1 && !Array.isArray(value)) {
      onChange(next[0])
      return
    }

    onChange(next)
  }

  useEffect(() => {
    if (assetsQuery.isLoading || assetsQuery.error || normalizedSelection.length === 0) {
      return
    }

    const canonicalSelection = selectedAssets.map((item) => item.selection)
    const hasSelectionDrift =
      canonicalSelection.length !== normalizedSelection.length ||
      canonicalSelection.some((selection, index) => {
        const current = normalizedSelection[index]
        return (
          !current ||
          current.assetId !== selection.assetId ||
          current.variant !== selection.variant
        )
      })

    if (hasSelectionDrift) {
      emitSelection(canonicalSelection)
    }
  }, [
    assetsQuery.error,
    assetsQuery.isLoading,
    normalizedSelection,
    selectedAssets,
  ])

  const reselectCurrent = () => {
    if (!activeAsset) return
    const refreshed = {
      assetId: activeAsset.id,
      variant: resolveVariant(activeAsset, activeSelection?.variant),
    }

    const next = [...normalizedSelection]
    const existingIndex = next.findIndex((item) => item.assetId === refreshed.assetId)
    if (existingIndex >= 0) {
      next[existingIndex] = refreshed
    } else {
      next.push(refreshed)
    }
    emitSelection(next)
  }

  const removeAtIndex = (index: number) => {
    const next = normalizedSelection.filter((_, i) => i !== index)
    emitSelection(next)
    setActiveIndex((current) => Math.max(0, Math.min(current, next.length - 1)))
  }

  const toggleAsset = (asset: Asset) => {
    const existingIndex = normalizedSelection.findIndex((item) => item.assetId === asset.id)
    if (existingIndex >= 0) {
      const next = normalizedSelection.filter((item) => item.assetId !== asset.id)
      emitSelection(next)
      return
    }

    const next = [
      ...normalizedSelection,
      {
        assetId: asset.id,
        variant: resolveVariant(asset),
      },
    ]
    emitSelection(next)

    const nextIndex = next.findIndex((item) => item.assetId === asset.id)
    setActiveIndex(nextIndex >= 0 ? nextIndex : 0)
  }

  const showNavigation = selectedAssets.length > 1
  const selectedCount = selectedAssets.length
  const breadcrumbSegments = folderFilter === 'all' ? [] : folderFilter.split('/').filter(Boolean)
  const directChildFolders = useMemo(() => {
    const baseSegments = folderFilter === 'all' ? [] : folderFilter.split('/').filter(Boolean)
    const children = new Set<string>()
    for (const asset of assets) {
      const { folder } = splitAssetFilename(asset.filename)
      if (!folder) continue
      const parts = folder.split('/').filter(Boolean)
      let isUnderBase = true
      for (let i = 0; i < baseSegments.length; i++) {
        if (parts[i] !== baseSegments[i]) {
          isUnderBase = false
          break
        }
      }
      if (!isUnderBase) continue
      if (parts.length > baseSegments.length) {
        children.add(parts.slice(0, baseSegments.length + 1).join('/'))
      }
    }
    return [...children].sort((a, b) => a.localeCompare(b))
  }, [assets, folderFilter])
  const canNavigateUp = folderFilter !== 'all' && breadcrumbSegments.length > 0

  return (
    <div data-testid='asset-picker'>
      <div className='relative h-72 overflow-hidden rounded-xl border bg-muted/20'>
          {activeAsset && previewSrc && isImageAsset(activeAsset) ? (
            <img
              src={previewSrc}
              alt={
                selectedAssets.length > 1
                  ? `Selected asset ${activeIndex + 1} of ${selectedAssets.length}`
                  : 'Selected asset preview'
              }
              className='h-full w-full object-contain'
            />
          ) : (
            <div
              role='button'
              tabIndex={disabled ? -1 : 0}
              className='flex h-full cursor-pointer flex-col items-center justify-center gap-2 bg-muted/40 text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring'
              onClick={() => {
                if (!disabled) setIsSelectorOpen(true)
              }}
              onKeyDown={(event) => {
                if (disabled) return
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  setIsSelectorOpen(true)
                }
              }}
              aria-label='Open asset browser from empty state'
              aria-disabled={disabled ? 'true' : undefined}
            >
              <ImageIcon className='size-8' aria-hidden />
              <p className='text-sm font-medium text-foreground/85'>No asset selected</p>
              <p className='text-xs text-muted-foreground'>
                Tap any thumbnail to add it to the preview queue.
              </p>
            </div>
          )}

          <div className='pointer-events-none absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-black/10' />

          <div className='absolute left-3 top-3'>
            <Button
              type='button'
              variant='secondary'
              size='icon'
              className='size-8 rounded-full border border-white/40 bg-background/70 backdrop-blur-sm'
              onClick={() => setIsSelectorOpen((open) => !open)}
              disabled={disabled}
              aria-label='Open asset browser'
            >
              <Search className='size-4' />
            </Button>
          </div>

          <div className='absolute right-3 top-3 flex items-center gap-2'>
            <Button
              type='button'
              variant='secondary'
              size='icon'
              className='size-8 rounded-full border border-white/40 bg-background/70 backdrop-blur-sm'
              onClick={reselectCurrent}
              disabled={disabled || !activeAsset}
              aria-label='Reselect current asset'
            >
              <RefreshCw className='size-4' />
            </Button>
            <Button
              type='button'
              variant='secondary'
              size='icon'
              className='size-8 rounded-full border border-white/40 bg-background/70 backdrop-blur-sm'
              onClick={() => {
                if (selectedAssets.length <= 1) {
                  emitSelection([])
                  setIsSelectorOpen(true)
                  return
                }
                removeAtIndex(activeIndex)
              }}
              disabled={disabled || selectedAssets.length === 0}
              aria-label='Clear selection'
            >
              <X className='size-4' />
            </Button>
          </div>

          {showNavigation && (
            <>
              <Button
                type='button'
                variant='secondary'
                size='icon'
                className='absolute left-3 top-1/2 size-8 -translate-y-1/2 rounded-full border border-white/40 bg-background/70 backdrop-blur-sm'
                onClick={() =>
                  setActiveIndex((index) => (index - 1 + selectedAssets.length) % selectedAssets.length)
                }
                disabled={disabled}
                aria-label='Previous selected asset'
              >
                <ChevronLeft className='size-4' />
              </Button>
              <Button
                type='button'
                variant='secondary'
                size='icon'
                className='absolute right-3 top-1/2 size-8 -translate-y-1/2 rounded-full border border-white/40 bg-background/70 backdrop-blur-sm'
                onClick={() => setActiveIndex((index) => (index + 1) % selectedAssets.length)}
                disabled={disabled}
                aria-label='Next selected asset'
              >
                <ChevronRight className='size-4' />
              </Button>
            </>
          )}

          {selectedAssets.length > 1 && (
            <div className='absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5'>
              {selectedAssets.map((_, index) => (
                <button
                  key={`selected-dot-${index}`}
                  type='button'
                  onClick={() => setActiveIndex(index)}
                  disabled={disabled}
                  aria-label={`Go to selected asset ${index + 1}`}
                  className={cn(
                    'h-2.5 rounded-full transition-all',
                    index === activeIndex
                      ? 'w-6 bg-white shadow'
                      : 'w-2.5 bg-white/60 hover:bg-white/80'
                  )}
                />
              ))}
            </div>
          )}

          <div className='absolute bottom-3 left-3 rounded-full border border-white/40 bg-background/70 px-2.5 py-1 text-xs text-foreground backdrop-blur-sm'>
            {selectedCount} selected
          </div>
      </div>

      <Dialog open={isSelectorOpen} onOpenChange={setIsSelectorOpen}>
        <DialogContent
          className='max-w-[99vw] sm:max-w-[min(1800px,99vw)] p-0'
          showCloseButton={false}
        >
          <DialogTitle className='sr-only'>Asset browser</DialogTitle>
          <DialogDescription className='sr-only'>
            Select one or more assets for the preview queue.
          </DialogDescription>
          <div className='h-[92vh] max-h-[980px] rounded-xl border bg-background p-3'>
            <div className='flex h-full flex-col gap-3'>
              <div className='flex items-center gap-2'>
                <div className='relative flex-1'>
                  <Search className='absolute left-2.5 top-2.5 size-4 text-muted-foreground' />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder='Search assets'
                    className='pl-8'
                    disabled={disabled}
                  />
                </div>
                <Button
                  type='button'
                  size='icon'
                  variant={semanticSearchEnabled ? 'secondary' : 'outline'}
                  onClick={() => setSemanticSearchEnabled((enabled) => !enabled)}
                  aria-label={semanticSearchEnabled ? 'Disable semantic ranking' : 'Enable semantic ranking'}
                  disabled={disabled}
                >
                  <RefreshCw className='size-4' />
                </Button>
                <label htmlFor='asset-sort' className='sr-only'>
                  Sort assets
                </label>
                <select
                  id='asset-sort'
                  aria-label='Sort assets'
                  value={sortBy}
                  onChange={(event) => setSortBy(event.target.value as 'newest' | 'name' | 'size')}
                  className='h-9 rounded-md border border-input bg-background px-2 text-sm'
                  disabled={disabled}
                >
                  <option value='newest'>Newest</option>
                  <option value='name'>Name</option>
                  <option value='size'>Size</option>
                </select>
                <Button
                  type='button'
                  size='icon'
                  variant='outline'
                  onClick={() =>
                    setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))
                  }
                  aria-label='Toggle sort direction'
                  disabled={disabled}
                >
                  <ArrowUpDown className='size-4' />
                </Button>
                <Button
                  type='button'
                  size='icon'
                  variant='outline'
                  onClick={() => setIsSelectorOpen(false)}
                  aria-label='Close asset browser'
                  disabled={disabled}
                >
                  <X className='size-4' />
                </Button>
              </div>
              <p className='text-xs text-muted-foreground'>
                Tap any thumbnail to add it to the preview queue.
              </p>
              <div className='flex items-center gap-1 overflow-x-auto whitespace-nowrap text-xs text-muted-foreground'>
                <span className='text-foreground/80'>Folder:</span>
                <button
                  type='button'
                  className={cn(
                    'underline-offset-4 hover:underline',
                    folderFilter === 'all' ? 'text-foreground font-medium' : ''
                  )}
                  onClick={() => setFolderFilter('all')}
                >
                  All
                </button>
                {breadcrumbSegments.map((segment, index) => {
                  const nextFolder = breadcrumbSegments.slice(0, index + 1).join('/')
                  return (
                    <span key={nextFolder} className='inline-flex items-center gap-1'>
                      <span>/</span>
                      <button
                        type='button'
                        className={cn(
                          'underline-offset-4 hover:underline',
                          nextFolder === folderFilter ? 'text-foreground font-medium' : ''
                        )}
                        onClick={() => setFolderFilter(nextFolder)}
                      >
                        {segment}
                      </button>
                    </span>
                  )
                })}
              </div>
              <div className='flex items-center gap-2 overflow-x-auto whitespace-nowrap'>
                {canNavigateUp && (
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={() => {
                      const nextSegments = breadcrumbSegments.slice(0, -1)
                      setFolderFilter(nextSegments.length ? nextSegments.join('/') : 'all')
                    }}
                    aria-label='Navigate up directory'
                    disabled={disabled}
                  >
                    Up
                  </Button>
                )}
                {directChildFolders.map((path) => (
                  <Button
                    key={path}
                    type='button'
                    variant='ghost'
                    size='sm'
                    onClick={() => setFolderFilter(path)}
                    aria-label={`Open directory ${path}`}
                    disabled={disabled}
                  >
                    {(() => {
                      const parts = path.split('/')
                      return parts[parts.length - 1]
                    })()}
                  </Button>
                ))}
              </div>

              {assetsQuery.isLoading && (
                <p className='text-sm text-muted-foreground'>Loading assets...</p>
              )}
              {assetsQuery.error && (
                <p className='text-sm text-destructive'>Unable to load assets. Try again shortly.</p>
              )}
              {semanticSearchEnabled && semanticQuery.error && query.trim().length > 1 && (
                <p className='text-sm text-muted-foreground'>
                  Relevance search is unavailable. Showing keyword matches instead.
                </p>
              )}

              {!assetsQuery.isLoading && !assetsQuery.error && (
                <ScrollArea className='min-h-0 flex-1 rounded-md border'>
                  <div className='grid grid-cols-2 gap-3 p-3 md:grid-cols-3 xl:grid-cols-4'>
                    {sortedDisplayedAssets.length === 0 && (
                      <p className='col-span-full px-2 py-3 text-sm text-muted-foreground'>
                        No assets matched this query.
                      </p>
                    )}

                    {sortedDisplayedAssets.map((asset) => {
                      const isSelected = selectedAssetIds.has(asset.id)
                      const cardPreview = buildPreviewSrc(asset, resolveVariant(asset), tenantSlug)
                      const { folder, basename } = splitAssetFilename(asset.filename)
                      const folderSegments = folder.split('/').filter(Boolean)
                      return (
                        <div
                          key={asset.id}
                          role='button'
                          tabIndex={disabled ? -1 : 0}
                          className={cn(
                            'relative overflow-hidden rounded-md border bg-muted/30 text-left transition-all',
                            isSelected
                              ? 'border-primary ring-2 ring-primary/30'
                              : 'border-border hover:border-primary/40'
                          )}
                          onClick={() => toggleAsset(asset)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              toggleAsset(asset)
                            }
                          }}
                          aria-label={`Toggle asset selection ${asset.id}`}
                          aria-disabled={disabled ? 'true' : undefined}
                        >
                          <div className='aspect-square w-full'>
                            {cardPreview && isImageAsset(asset) ? (
                              <img
                                src={cardPreview}
                                alt='Asset option preview'
                                className='h-full w-full object-cover'
                                loading='lazy'
                              />
                            ) : (
                              <div className='flex h-full items-center justify-center bg-muted text-muted-foreground'>
                                <ImageIcon className='size-6' aria-hidden />
                              </div>
                            )}
                          </div>
                          <span
                            className={cn(
                              'absolute right-2 top-2 inline-flex size-6 items-center justify-center rounded-full border backdrop-blur-sm',
                              isSelected
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-white/50 bg-background/60 text-transparent'
                            )}
                            aria-hidden
                          >
                            <Check className='size-3.5' />
                          </span>
                          <div className='pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 pb-2 pt-8 text-left'>
                            <p className='truncate text-[11px] font-medium text-white'>
                              {basename || asset.filename}
                            </p>
                            <div className='pointer-events-auto flex flex-wrap items-center gap-1 text-[10px] text-white/80'>
                              {folderSegments.length === 0 ? (
                                <button
                                  type='button'
                                  className='underline-offset-4 hover:underline'
                                  onClick={(event) => {
                                    event.preventDefault()
                                    event.stopPropagation()
                                    setFolderFilter('all')
                                  }}
                                  aria-label='Filter folder /'
                                >
                                  /
                                </button>
                              ) : (
                                folderSegments.map((segment, index) => {
                                  const nextFolder = folderSegments.slice(0, index + 1).join('/')
                                  return (
                                    <span
                                      key={`${asset.id}-folder-${nextFolder}`}
                                      className='inline-flex items-center gap-1'
                                    >
                                      {index > 0 ? <span>/</span> : null}
                                      <button
                                        type='button'
                                        className='underline-offset-4 hover:underline'
                                        onClick={(event) => {
                                          event.preventDefault()
                                          event.stopPropagation()
                                          setFolderFilter(nextFolder)
                                        }}
                                        aria-label={`Filter folder ${nextFolder}`}
                                      >
                                        {segment}
                                      </button>
                                    </span>
                                  )
                                })
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </ScrollArea>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
