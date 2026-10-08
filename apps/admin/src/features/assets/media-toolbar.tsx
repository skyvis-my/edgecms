import {
  ArrowUpDown,
  FolderPlus,
  FolderUp,
  LayoutGrid,
  List,
  SlidersHorizontal,
  Upload,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { AssetSortBy, SortDirection } from './media-manager-utils'
import { formatBytes } from './media-utils'

type BreadcrumbItem = { label: string; path: string }

type AssetSummary = {
  count: number
  totalBytes: number
}

type MediaToolbarProps = {
  searchTerm: string
  onSearchTermChange: (value: string) => void
  mimeCategoryFilter: string
  onMimeCategoryFilterChange: (value: string) => void
  mimeCategoryOptions: string[]
  sortBy: AssetSortBy
  onSortByChange: (value: AssetSortBy) => void
  sortDirection: SortDirection
  onSortDirectionToggle: () => void
  viewMode: 'grid' | 'list'
  onViewModeChange: (value: 'grid' | 'list') => void
  breadcrumbItems: BreadcrumbItem[]
  currentPath: string
  onPathChange: (path: string) => void
  onFolderDrop: (path: string, event: React.DragEvent) => void
  dragAssetDataType: string
  dragFolderDataType: string
  totalAssetCount: number
  librarySummary: AssetSummary
  visibleSummary: AssetSummary
  selectedSummary: AssetSummary
  pendingMediaCount: number
  onStartCreatingFolder: () => void
  onUploadFiles: () => void
  onUploadFolder: () => void
  showQualitySettings: boolean
  onToggleQualitySettings: () => void
  quality: number
  onQualityChange: (value: number) => void
  maxUploadBytes: number
  maxUploadDimension: number
  allowedMimeTypes: string[]
}

export function MediaToolbar({
  searchTerm,
  onSearchTermChange,
  mimeCategoryFilter,
  onMimeCategoryFilterChange,
  mimeCategoryOptions,
  sortBy,
  onSortByChange,
  sortDirection,
  onSortDirectionToggle,
  viewMode,
  onViewModeChange,
  breadcrumbItems,
  currentPath,
  onPathChange,
  onFolderDrop,
  dragAssetDataType,
  dragFolderDataType,
  totalAssetCount,
  librarySummary,
  visibleSummary,
  selectedSummary,
  pendingMediaCount,
  onStartCreatingFolder,
  onUploadFiles,
  onUploadFolder,
  showQualitySettings,
  onToggleQualitySettings,
  quality,
  onQualityChange,
  maxUploadBytes,
  maxUploadDimension,
  allowedMimeTypes,
}: MediaToolbarProps) {
  return (
    <>
      <div className='grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_180px_auto_auto]'>
        <Input
          value={searchTerm}
          onChange={(event) => onSearchTermChange(event.target.value)}
          placeholder='Search filename, folder, or mime type'
        />
        <label className='sr-only' htmlFor='media-mime-filter'>
          Filter by media category
        </label>
        <select
          id='media-mime-filter'
          value={mimeCategoryFilter}
          onChange={(event) =>
            onMimeCategoryFilterChange(event.target.value)
          }
          className='h-9 rounded-md border bg-background px-3 text-sm'
        >
          <option value='all'>All types</option>
          {mimeCategoryOptions.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
        <label className='sr-only' htmlFor='media-sort-by'>
          Sort assets
        </label>
        <select
          id='media-sort-by'
          value={sortBy}
          onChange={(event) =>
            onSortByChange(event.target.value as AssetSortBy)
          }
          className='h-9 rounded-md border bg-background px-3 text-sm'
        >
          <option value='uploadedAt'>Uploaded date</option>
          <option value='filename'>Filename</option>
          <option value='size'>File size</option>
          <option value='mimeType'>MIME type</option>
        </select>
        <Button
          type='button'
          variant='outline'
          onClick={onSortDirectionToggle}
          size='icon'
          aria-label='Toggle sort direction'
          title={`Sort: ${sortDirection === 'asc' ? 'ascending' : 'descending'}`}
        >
          <ArrowUpDown className='h-4 w-4' />
        </Button>
        <div className='flex rounded-md border'>
          <Button
            type='button'
            variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
            className='rounded-r-none border-r'
            onClick={() => onViewModeChange('grid')}
            aria-label='Grid view'
          >
            <LayoutGrid className='h-4 w-4' />
          </Button>
          <Button
            type='button'
            variant={viewMode === 'list' ? 'secondary' : 'ghost'}
            className='rounded-l-none'
            onClick={() => onViewModeChange('list')}
            aria-label='List view'
          >
            <List className='h-4 w-4' />
          </Button>
        </div>
      </div>

      <div className='flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/20 px-3 py-2'>
        <div className='flex flex-wrap items-center gap-1 text-sm text-muted-foreground'>
          {breadcrumbItems.map((item, index) => (
            <div
              key={item.path || '/'}
              className='inline-flex items-center gap-1'
            >
              {index > 0 && (
                <span className='text-muted-foreground/70'>/</span>
              )}
              <a
                href={item.path ? `#${item.path}` : '#/'}
                onClick={(event) => {
                  event.preventDefault()
                  onPathChange(item.path)
                }}
                className={cn(
                  'inline-flex items-center rounded px-2 py-1 hover:bg-muted',
                  item.path === currentPath
                    ? 'font-medium text-foreground'
                    : 'text-muted-foreground'
                )}
                onDragOver={(event) => {
                  if (
                    !event.dataTransfer.types.includes(
                      dragAssetDataType
                    )
                    && !event.dataTransfer.types.includes(
                      dragFolderDataType
                    )
                  ) {
                    return
                  }
                  event.preventDefault()
                }}
                onDrop={(event) => void onFolderDrop(item.path, event)}
              >
                {item.label}
              </a>
            </div>
          ))}
        </div>
        <div className='flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground'>
          <span>
            Total library:{' '}
            <span className='font-medium text-foreground'>
              {totalAssetCount} assets
              <span className='ml-1 text-muted-foreground'>
                {formatBytes(librarySummary.totalBytes)}
              </span>
            </span>
          </span>
          <span>
            Current folder:{' '}
            <span className='font-medium text-foreground'>
              {visibleSummary.count} assets
              <span className='ml-1 text-muted-foreground'>
                {formatBytes(visibleSummary.totalBytes)}
              </span>
            </span>
          </span>
          <span>
            Selection:{' '}
            <span className='font-medium text-foreground'>
              {selectedSummary.count} assets
              <span className='ml-1 text-muted-foreground'>
                {formatBytes(selectedSummary.totalBytes)}
              </span>
            </span>
          </span>
          <span>
            Path:{' '}
            <span className='font-medium text-foreground'>
              {currentPath || '/'}
            </span>
          </span>
          <span>
            Queued:{' '}
            <span className='font-medium text-foreground'>
              {pendingMediaCount}
            </span>
          </span>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          <Button
            type='button'
            variant='outline'
            onClick={onUploadFiles}
            size='sm'
            aria-label='Upload files'
            title='Upload one or more files'
          >
            <Upload className='h-4 w-4' />
            Upload
          </Button>
          <Button
            type='button'
            variant='outline'
            onClick={onUploadFolder}
            size='sm'
            aria-label='Folder upload'
            title='Folder upload'
          >
            <FolderUp className='h-4 w-4' />
            Folder upload
          </Button>
          <Button
            type='button'
            variant='outline'
            onClick={onStartCreatingFolder}
            size='sm'
            aria-label='New folder'
            title='New folder'
          >
            <FolderPlus className='h-4 w-4' />
            New folder
          </Button>
          <Button
            type='button'
            variant='outline'
            onClick={onToggleQualitySettings}
            size='sm'
            aria-label='Settings'
            title='Settings'
          >
            <SlidersHorizontal className='h-4 w-4' />
            Settings
          </Button>
        </div>
      </div>
      {showQualitySettings && (
        <div className='rounded-md border bg-muted/20 p-3'>
          <div className='mb-2 text-xs font-medium text-muted-foreground'>
            Upload quality: {quality}%
          </div>
          <div className='mb-2 text-xs text-muted-foreground'>
            Allowed MIME types: {allowedMimeTypes.join(', ') || 'Not configured'}
          </div>
          <div className='mb-2 text-xs text-muted-foreground'>
            Upload cap: {formatBytes(maxUploadBytes)} / {maxUploadDimension}px
          </div>
          <Input
            type='range'
            min={40}
            max={95}
            step={1}
            value={quality}
            onChange={(event) =>
              onQualityChange(Number(event.target.value))
            }
            title={`Quality ${quality}%`}
          />
        </div>
      )}
    </>
  )
}
