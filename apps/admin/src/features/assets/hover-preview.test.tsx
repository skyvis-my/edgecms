import '../../../test-utils/setup'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import * as React from 'react'
import { HoverPreview } from './hover-preview'
import type { Asset } from './api'

describe('HoverPreview', () => {
  const asset: Asset = {
    id: 'a1',
    filename: 'hero.png',
    mimeType: 'image/png',
    size: 2048,
    variants: [],
  }

  const layout = {
    top: 50,
    left: 100,
    width: 320,
    imageHeight: 200,
  }

  it('renders preview image when previewPath is provided', () => {
    const popupRef = React.createRef<HTMLDivElement>()

    render(
      <HoverPreview
        hoverPreview={{
          asset,
          previewPath: '/media/hero-thumb.webp',
          basename: 'hero.png',
          folder: 'blog',
        }}
        hoverPreviewLayout={layout}
        popupRef={popupRef}
        formatAssetDimensions={() => '800 x 600'}
        formatUpdatedDate={() => 'Today'}
        formatUploadedDate={() => 'Yesterday'}
      />
    )

    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('src', '/media/hero-thumb.webp')
    expect(screen.getByText('hero.png')).toBeInTheDocument()
    expect(screen.getByText('Type: image/png')).toBeInTheDocument()
    expect(screen.getByText(/Dimensions: 800 x 600/)).toBeInTheDocument()
    expect(screen.getByText(/Updated: Today/)).toBeInTheDocument()
    expect(screen.getByText(/Uploaded: Yesterday/)).toBeInTheDocument()
    expect(screen.getByText(/Folder: blog/)).toBeInTheDocument()
  })

  it('renders fallback icon when previewPath is null', () => {
    const popupRef = React.createRef<HTMLDivElement>()

    render(
      <HoverPreview
        hoverPreview={{
          asset,
          previewPath: null,
          basename: 'doc.pdf',
          folder: '',
        }}
        hoverPreviewLayout={layout}
        popupRef={popupRef}
        formatAssetDimensions={() => '-'}
        formatUpdatedDate={() => 'Today'}
        formatUploadedDate={() => 'Yesterday'}
      />
    )

    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('doc.pdf')).toBeInTheDocument()
    expect(screen.getByText(/Folder: \//)).toBeInTheDocument()
  })
})
