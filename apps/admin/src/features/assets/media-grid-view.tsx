import { Download, FolderOpen, Image as ImageIcon } from 'lucide-react'
import type { RefObject } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { Asset } from './api'
import type { AssetEntry, FolderEntry } from './media-manager-types'
import { formatBytes, splitAssetFilename } from './media-utils'

const DRAG_ASSETS_DATA_TYPE = 'application/x-edgecms-assets'
const DRAG_FOLDER_DATA_TYPE = 'application/x-edgecms-folder'

export interface MediaGridViewProps {
  folderEntries: FolderEntry[]
  assetEntries: AssetEntry[]
  newFolderDraft: string | null
  newFolderInputRef: RefObject<HTMLInputElement | null>
  setNewFolderDraft: (name: string) => void
  commitCreatingFolder: () => void
  cancelCreatingFolder: () => void
  selectedFolderPath: string | null
  renamingFolderPath: string | null
  renameFolderInputRef: RefObject<HTMLInputElement | null>
  renamingFolderName: string
  setRenamingFolderName: (name: string) => void
  commitRenamingFolder: () => Promise<void> | void
  cancelRenamingFolder: () => void
  handleFolderClick: (path: string) => void
  onOpenFolder: (path: string) => void
  onContextMenuFolder: (event: React.MouseEvent, entry: FolderEntry) => void
  onFolderDrop: (targetPath: string, event: React.DragEvent) => Promise<void> | void
  selectedAssetIds: string[]
  visibleAssetIds: string[]
  handleAssetClick: (id: string, index: number, event: React.MouseEvent) => void
  openPreviewAt: (id: string) => void
  onContextMenuAsset: (event: React.MouseEvent, entry: AssetEntry, index: number) => void
  getAssetDownloadPath: (asset: Asset) => string
  getPreviewPath: (asset: Asset, variants?: string[]) => string | null
  scheduleHoverPreview: (
    asset: Asset,
    previewPath: string,
    basename: string,
    folder: string,
    x: number,
    y: number
  ) => void
  clearHoverPreview: () => void
  formatUpdatedDate: (asset: Asset) => string
}

export function MediaGridView({
  folderEntries,
  assetEntries,
  newFolderDraft,
  newFolderInputRef,
  setNewFolderDraft,
  commitCreatingFolder,
  cancelCreatingFolder,
  selectedFolderPath,
  renamingFolderPath,
  renameFolderInputRef,
  renamingFolderName,
  setRenamingFolderName,
  commitRenamingFolder,
  cancelRenamingFolder,
  handleFolderClick,
  onOpenFolder,
  onContextMenuFolder,
  onFolderDrop,
  selectedAssetIds,
  visibleAssetIds,
  handleAssetClick,
  openPreviewAt,
  onContextMenuAsset,
  getAssetDownloadPath,
  getPreviewPath,
  scheduleHoverPreview,
  clearHoverPreview,
  formatUpdatedDate,
}: MediaGridViewProps) {
  return (
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
              onDoubleClick={() => onOpenFolder(entry.path)}
              onContextMenu={(event) => onContextMenuFolder(event, entry)}
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
              onContextMenu={(event) =>
                onContextMenuAsset(event, entry, assetIndex >= 0 ? assetIndex : idx)
              }
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
                onMouseEnter={(event) => {
                  if (previewPath) {
                    scheduleHoverPreview(
                      asset,
                      previewPath,
                      basename,
                      folder,
                      event.clientX,
                      event.clientY
                    )
                  }
                }}
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
  )
}
