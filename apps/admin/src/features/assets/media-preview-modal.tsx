import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Link as LinkIcon,
  Minus,
  Plus,
  X,
} from 'lucide-react'
import type { Asset } from './api'
import { splitAssetFilename } from './media-utils'

type MediaPreviewModalProps = {
  previewAsset: Asset
  previewZoom: number
  previewIndex: number
  visibleAssetsCount: number
  previewDialogRef: React.RefObject<HTMLDivElement | null>
  getPreviewPath: (
    asset: Asset,
    preferred?: string[]
  ) => string
  getDownloadPath: (asset: Asset) => string
  getAssetSizeLabel: (asset: Asset) => string
  onClose: () => void
  onPrev: () => void
  onNext: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomReset: () => void
  onTrapFocus: (event: React.KeyboardEvent<HTMLDivElement>) => void
  minZoom: number
  maxZoom: number
}

function getPreviewKind(asset: Asset) {
  const mimeType = asset.mimeType.toLowerCase()
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType === 'application/pdf') return 'pdf'
  if (
    mimeType === 'application/json'
    || mimeType === 'text/plain'
    || mimeType === 'text/yaml'
    || mimeType === 'application/yaml'
    || mimeType === 'application/x-yaml'
  ) {
    return 'text'
  }
  return 'unsupported'
}

export function MediaPreviewModal({
  previewAsset,
  previewZoom,
  previewIndex,
  visibleAssetsCount,
  previewDialogRef,
  getPreviewPath,
  getDownloadPath,
  getAssetSizeLabel,
  onClose,
  onPrev,
  onNext,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onTrapFocus,
  minZoom,
  maxZoom,
}: MediaPreviewModalProps) {
  const previewKind = getPreviewKind(previewAsset)
  const canZoom = previewKind === 'image'
  const originalPath = getDownloadPath(previewAsset)

  return (
    <div
      className='fixed inset-0 z-50 bg-black/80 backdrop-blur-sm'
      role='dialog'
      aria-modal='true'
      aria-label='Media preview'
      tabIndex={-1}
      ref={previewDialogRef}
      onKeyDown={onTrapFocus}
    >
      <a
        className='absolute right-16 top-4 z-20 rounded-full bg-white/10 p-2 text-white hover:bg-white/20'
        href={getDownloadPath(previewAsset)}
        download={splitAssetFilename(previewAsset.filename).basename}
        aria-label='Download original file'
      >
        <Download className='h-5 w-5' />
      </a>
      <button
        type='button'
        className='absolute right-4 top-4 z-20 rounded-full bg-white/10 p-2 text-white hover:bg-white/20'
        onClick={onClose}
        aria-label='Close preview'
      >
        <X className='h-5 w-5' />
      </button>
      {canZoom && (
        <div className='absolute left-4 top-4 z-10 flex items-center gap-2 rounded-full bg-black/40 p-1 backdrop-blur-sm'>
          <button
            type='button'
            className='rounded-full p-2 text-white hover:bg-white/20'
            onClick={onZoomOut}
            disabled={previewZoom <= minZoom}
            aria-label='Zoom out'
          >
            <Minus className='h-4 w-4' />
          </button>
          <button
            type='button'
            className='min-w-14 rounded-full px-3 py-1 text-xs font-medium text-white hover:bg-white/20'
            onClick={onZoomReset}
            aria-label='Reset zoom'
          >
            {Math.round(previewZoom * 100)}%
          </button>
          <button
            type='button'
            className='rounded-full p-2 text-white hover:bg-white/20'
            onClick={onZoomIn}
            disabled={previewZoom >= maxZoom}
            aria-label='Zoom in'
          >
            <Plus className='h-4 w-4' />
          </button>
        </div>
      )}
      <div className='h-full w-full'>
        {previewKind === 'image' && (
          <img
            src={getPreviewPath(previewAsset, [
              'large',
              'medium',
              'thumbnail',
            ])}
            alt={previewAsset.filename}
            className='h-full w-full object-contain transition-transform duration-200 ease-out'
            style={{
              transform: `scale(${previewZoom})`,
            }}
          />
        )}
        {previewKind === 'pdf' && (
          <div className='h-full w-full px-6 py-16'>
            <iframe
              src={originalPath}
              title={previewAsset.filename}
              className='h-full w-full rounded-lg border border-white/10 bg-white'
            />
          </div>
        )}
        {previewKind === 'text' && (
          <div className='h-full w-full px-6 py-16'>
            <iframe
              src={originalPath}
              title={previewAsset.filename}
              sandbox=''
              className='h-full w-full rounded-lg border border-white/10 bg-white'
            />
          </div>
        )}
        {previewKind === 'unsupported' && (
          <div className='flex h-full w-full flex-col items-center justify-center gap-3 text-white/80'>
            <FileText className='h-12 w-12' />
            <p className='text-sm font-medium'>Preview unavailable for this file type</p>
          </div>
        )}
      </div>
      <div className='pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/45 to-transparent px-6 pb-6 pt-16 text-white'>
        <div className='truncate text-sm font-medium opacity-50'>
          {previewAsset.filename}
        </div>
        <div className='mt-1 flex items-center gap-2 text-xs text-white/80'>
          <LinkIcon className='h-3.5 w-3.5' />
          {getAssetSizeLabel(previewAsset)}
        </div>
        <div className='pointer-events-auto mt-3 flex items-center gap-2 text-xs text-white/70'>
          <ChevronLeft className='h-4 w-4' />
          <span>Prev</span>
          <ChevronRight className='ml-1 h-4 w-4' />
          <span>Next</span>
          {canZoom && <span className='ml-2'>Use + / - to zoom</span>}
        </div>
      </div>
      <button
        type='button'
        className='absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40'
        onClick={onPrev}
        disabled={previewIndex <= 0}
        aria-label='Previous image'
      >
        <ChevronLeft className='h-6 w-6' />
      </button>
      <button
        type='button'
        className='absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40'
        onClick={onNext}
        disabled={
          previewIndex < 0
          || previewIndex >= visibleAssetsCount - 1
        }
        aria-label='Next image'
      >
        <ChevronRight className='h-6 w-6' />
      </button>
    </div>
  )
}
