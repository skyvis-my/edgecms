import '../../../test-utils/setup'
const { render } = await import('@testing-library/react')

import { MediaToolbar } from './media-toolbar'

const noop = () => undefined

describe('MediaToolbar', () => {
  const commonProps = {
    searchTerm: '',
    onSearchTermChange: noop,
    mimeCategoryFilter: 'all',
    onMimeCategoryFilterChange: noop,
    mimeCategoryOptions: ['application', 'image', 'video'],
    sortBy: 'uploadedAt' as const,
    onSortByChange: noop,
    sortDirection: 'desc' as const,
    onSortDirectionToggle: noop,
    viewMode: 'grid' as const,
    onViewModeChange: noop,
    breadcrumbItems: [{ label: '/', path: '' }],
    currentPath: '',
    onPathChange: noop,
    onFolderDrop: noop,
    dragAssetDataType: 'application/x-edgecms-assets',
    dragFolderDataType: 'application/x-edgecms-folder',
    totalAssetCount: 3,
    librarySummary: { count: 3, totalBytes: 1024 },
    visibleSummary: { count: 1, totalBytes: 256 },
    selectedSummary: { count: 0, totalBytes: 0 },
    pendingMediaCount: 1,
    onStartCreatingFolder: noop,
    onUploadFiles: noop,
    onUploadFolder: noop,
    showQualitySettings: true,
    onToggleQualitySettings: noop,
    quality: 80,
    onQualityChange: noop,
    maxUploadBytes: 5 * 1024 * 1024,
    maxUploadDimension: 2048,
    allowedMimeTypes: ['image/*', 'application/pdf'],
  }

  it('shows upload constraints and allowed mime policy when settings are open', () => {
    const view = render(
      <MediaToolbar
        {...commonProps}
        allowedMimeTypes={['image/*', 'application/pdf', 'video/mp4']}
      />
    )

    expect(view.getByText('Upload quality: 80%')).toBeInTheDocument()
    expect(view.getByText('Allowed MIME types: image/*, application/pdf, video/mp4')).toBeInTheDocument()
    expect(view.getByText('Upload cap: 5.0 MB / 2048px')).toBeInTheDocument()
  })

  it('shows policy as not configured when allowed mime list is empty', () => {
    const view = render(<MediaToolbar {...commonProps} allowedMimeTypes={[]} />)

    expect(view.getByText('Allowed MIME types: Not configured')).toBeInTheDocument()
  })
})
