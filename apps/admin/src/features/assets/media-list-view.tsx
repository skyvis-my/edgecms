import { FolderOpen, Image as ImageIcon } from 'lucide-react'
import type { RefObject } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { Asset } from './api'
import type { AssetEntry, FileManagerEntry, FolderEntry } from './media-manager-types'
import { formatBytes, splitAssetFilename } from './media-utils'

const DRAG_ASSETS_DATA_TYPE = 'application/x-edgecms-assets'
const DRAG_FOLDER_DATA_TYPE = 'application/x-edgecms-folder'

export interface MediaListViewProps {
  entries: FileManagerEntry[]
  currentPath: string
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
  getPreviewPath: (asset: Asset, variants?: string[]) => string | null
  formatUploadedDate: (date?: string) => string
}

export function MediaListView({
  entries,
  currentPath,
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
  getPreviewPath,
  formatUploadedDate,
}: MediaListViewProps) {
  return (
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
              onContextMenu={(event) =>
                onContextMenuAsset(event, entry, assetIndex >= 0 ? assetIndex : idx)
              }
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
  )
}
