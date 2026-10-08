import '../../../test-utils/setup'
import { describe, expect, it, vi } from 'bun:test'
import { render } from '@testing-library/react'
import { MediaPreviewModal } from './media-preview-modal'
import type { Asset } from './api'

function renderModal(asset: Asset) {
  return render(
    <MediaPreviewModal
      previewAsset={asset}
      previewZoom={1}
      previewIndex={0}
      visibleAssetsCount={1}
      previewDialogRef={{ current: null }}
      getPreviewPath={() => '/api/assets/preview'}
      getDownloadPath={(previewAsset) => `/api/assets/${previewAsset.id}/download`}
      getAssetSizeLabel={() => 'File size: 10 B'}
      onClose={vi.fn()}
      onPrev={vi.fn()}
      onNext={vi.fn()}
      onZoomIn={vi.fn()}
      onZoomOut={vi.fn()}
      onZoomReset={vi.fn()}
      onTrapFocus={vi.fn()}
      minZoom={0.5}
      maxZoom={3}
    />
  )
}

function asset(filename: string, mimeType: string): Asset {
  return {
    id: filename,
    filename,
    mimeType,
    size: 10,
    variants: [],
  }
}

describe('MediaPreviewModal', () => {
  it.each([
    ['docs/spec.pdf', 'application/pdf'],
    ['docs/readme.txt', 'text/plain'],
    ['docs/config.yaml', 'text/yaml'],
    ['docs/data.json', 'application/json'],
  ])('renders an embedded viewer for %s', (filename, mimeType) => {
    const { getByTitle, queryByText } = renderModal(asset(filename, mimeType))

    const viewer = getByTitle(filename)
    expect(viewer.tagName).toBe('IFRAME')
    expect(viewer).toHaveAttribute('src', `/api/assets/${filename}/download`)
    expect(queryByText('Use + / - to zoom')).toBeNull()
  })
})
