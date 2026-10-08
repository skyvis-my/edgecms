import { Image as ImageIcon } from 'lucide-react'
import { formatBytes } from './media-utils'
import type { HoverPreviewLayout, HoverPreviewState } from './media-manager-types'
import type { Asset } from './api'

type HoverPreviewProps = {
  hoverPreview: HoverPreviewState
  hoverPreviewLayout: HoverPreviewLayout
  popupRef: React.RefObject<HTMLDivElement | null>
  formatAssetDimensions: (asset: Asset) => string
  formatUpdatedDate: (asset: Asset) => string
  formatUploadedDate: (value?: string) => string
}

export function HoverPreview({
  hoverPreview,
  hoverPreviewLayout,
  popupRef,
  formatAssetDimensions,
  formatUpdatedDate,
  formatUploadedDate,
}: HoverPreviewProps) {
  return (
    <div
      ref={popupRef}
      className='pointer-events-none fixed z-40 rounded-xl border border-border/80 bg-background/95 p-2 shadow-2xl backdrop-blur-sm'
      style={{
        top: `${hoverPreviewLayout.top}px`,
        left: `${hoverPreviewLayout.left}px`,
        width: `${hoverPreviewLayout.width}px`,
      }}
    >
      <div className='overflow-hidden rounded-lg border bg-muted'>
        {hoverPreview.previewPath ? (
          <img
            src={hoverPreview.previewPath}
            alt={hoverPreview.asset.filename}
            className='w-full object-cover'
            style={{ height: `${hoverPreviewLayout.imageHeight}px` }}
            loading='lazy'
          />
        ) : (
          <div
            className='flex items-center justify-center text-muted-foreground'
            style={{ height: `${hoverPreviewLayout.imageHeight}px` }}
          >
            <ImageIcon className='h-10 w-10' />
          </div>
        )}
      </div>
      <div className='mt-2 space-y-1 text-xs'>
        <p className='truncate font-medium text-foreground'>
          {hoverPreview.basename}
        </p>
        <p className='truncate text-muted-foreground'>
          Type: {hoverPreview.asset.mimeType}
        </p>
        <p className='truncate text-muted-foreground'>
          Size: {formatBytes(hoverPreview.asset.size)} • Dimensions:{' '}
          {formatAssetDimensions(hoverPreview.asset)}
        </p>
        <p className='truncate text-muted-foreground'>
          Folder: {hoverPreview.folder || '/'} • Variants:{' '}
          {hoverPreview.asset.variants.length}
        </p>
        <p className='truncate text-muted-foreground'>
          Updated: {formatUpdatedDate(hoverPreview.asset)} • Uploaded:{' '}
          {formatUploadedDate(hoverPreview.asset.createdAt)}
        </p>
      </div>
    </div>
  )
}
