import '../../../test-utils/setup'
import { afterEach, describe, expect, it, vi } from 'bun:test'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { MediaContextMenu } from './media-context-menu'
import type { Asset } from './api'

const asset: Asset = {
  id: 'asset-1',
  filename: 'docs/menu.pdf',
  mimeType: 'application/pdf',
  size: 10,
  variants: [],
}

describe('MediaContextMenu', () => {
  afterEach(() => {
    cleanup()
  })

  it('offers copy link for asset entries', () => {
    const onCopyAssetLink = vi.fn()
    const onClose = vi.fn()

    const { getByRole } = render(
      <MediaContextMenu
        contextMenu={{ open: true, x: 0, y: 0, entry: { type: 'asset', asset } }}
        selectedAssetIds={['asset-1']}
        getAssetDownloadPath={() => '/api/admin/assets/asset-1/download'}
        getAssetSizeLabel={() => 'File size: 10 B'}
        onOpenFolder={vi.fn()}
        onMoveSelectedToFolder={vi.fn()}
        onRenameFolder={vi.fn()}
        onOpenPreview={vi.fn()}
        onCopyAssetLink={onCopyAssetLink}
        onOpenContainingFolder={vi.fn()}
        onDeleteAsset={vi.fn()}
        onClose={onClose}
      />
    )

    fireEvent.click(getByRole('menuitem', { name: 'Copy Link' }))

    expect(onCopyAssetLink).toHaveBeenCalledWith(asset)
    expect(onClose).toHaveBeenCalled()
  })

  it('supports folder actions and keeps selection context', () => {
    const onOpenFolder = vi.fn()
    const onMoveSelectedToFolder = vi.fn()
    const onRenameFolder = vi.fn()

    const folderEntry = render(
      <MediaContextMenu
        contextMenu={{ open: true, x: 0, y: 0, entry: { type: 'folder', path: 'marketing', name: 'marketing' } }}
        selectedAssetIds={['asset-1']}
        getAssetDownloadPath={() => '/api/admin/assets/asset-1/download'}
        getAssetSizeLabel={() => 'File size: 10 B'}
        onOpenFolder={onOpenFolder}
        onMoveSelectedToFolder={onMoveSelectedToFolder}
        onRenameFolder={onRenameFolder}
        onOpenPreview={vi.fn()}
        onCopyAssetLink={vi.fn()}
        onOpenContainingFolder={vi.fn()}
        onDeleteAsset={vi.fn()}
        onClose={vi.fn()}
      />
    )

    fireEvent.click(folderEntry.getByRole('menuitem', { name: 'Open Folder' }))
    fireEvent.click(folderEntry.getByRole('menuitem', { name: 'Rename Folder' }))
    fireEvent.click(folderEntry.getByRole('menuitem', { name: 'Move Selected Here' }))

    expect(onOpenFolder).toHaveBeenCalledWith('marketing')
    expect(onRenameFolder).toHaveBeenCalledWith('marketing')
    expect(onMoveSelectedToFolder).toHaveBeenCalledWith('marketing')
  })

  it('ignores move-selected action when nothing is selected', () => {
    const onMoveSelectedToFolder = vi.fn()
    const { getByRole } = render(
      <MediaContextMenu
        contextMenu={{ open: true, x: 0, y: 0, entry: { type: 'folder', path: 'marketing', name: 'marketing' } }}
        selectedAssetIds={[]}
        getAssetDownloadPath={() => '/api/admin/assets/asset-1/download'}
        getAssetSizeLabel={() => 'File size: 10 B'}
        onOpenFolder={vi.fn()}
        onMoveSelectedToFolder={onMoveSelectedToFolder}
        onRenameFolder={vi.fn()}
        onOpenPreview={vi.fn()}
        onCopyAssetLink={vi.fn()}
        onOpenContainingFolder={vi.fn()}
        onDeleteAsset={vi.fn()}
        onClose={vi.fn()}
      />
    )

    fireEvent.click(getByRole('menuitem', { name: 'Move Selected Here' }))

    expect(onMoveSelectedToFolder).not.toHaveBeenCalled()
  })

  it('runs asset actions and closes menu for selected entry', () => {
    const onOpenPreview = vi.fn()
    const onOpenContainingFolder = vi.fn()
    const onDeleteAsset = vi.fn()
    const onClose = vi.fn()

    const { getByRole } = render(
      <MediaContextMenu
        contextMenu={{ open: true, x: 0, y: 0, entry: { type: 'asset', asset } }}
        selectedAssetIds={['asset-1']}
        getAssetDownloadPath={() => '/api/admin/assets/asset-1/download'}
        getAssetSizeLabel={() => 'File size: 10 B'}
        onOpenFolder={vi.fn()}
        onMoveSelectedToFolder={vi.fn()}
        onRenameFolder={vi.fn()}
        onOpenPreview={onOpenPreview}
        onCopyAssetLink={vi.fn()}
        onOpenContainingFolder={onOpenContainingFolder}
        onDeleteAsset={onDeleteAsset}
        onClose={onClose}
      />
    )

    fireEvent.click(getByRole('menuitem', { name: 'Open Preview' }))
    fireEvent.click(getByRole('menuitem', { name: 'Open Containing Folder' }))
    fireEvent.click(getByRole('menuitem', { name: 'Delete' }))

    expect(onOpenPreview).toHaveBeenCalledWith('asset-1')
    expect(onOpenContainingFolder).toHaveBeenCalledWith('docs')
    expect(onDeleteAsset).toHaveBeenCalledWith('asset-1')
    expect(onClose).toHaveBeenCalledTimes(3)
  })
})
