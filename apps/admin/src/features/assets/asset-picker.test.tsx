import '../../../test-utils/setup'
const { act, cleanup, fireEvent, render, waitFor, within } = await import(
  '@testing-library/react'
)
const userEvent = (await import('@testing-library/user-event')).default

const activeTenantStorageKey = 'edgecms:active-tenant'
const tenantSwitchEvent = 'edgecms:tenant-switch'
let activeTenantSlug: string | null = null

vi.mock('@/lib/tenant-storage', () => ({
  ACTIVE_TENANT_STORAGE_KEY: activeTenantStorageKey,
  TENANT_SWITCH_EVENT: tenantSwitchEvent,
  getCurrentTenantSlug: () => activeTenantSlug,
  setCurrentTenantSlug: (slug: string | null) => {
    activeTenantSlug = slug
    window.dispatchEvent(new CustomEvent(tenantSwitchEvent, { detail: { slug } }))
  },
}))

const { AssetPicker } = await import('./asset-picker')
const { setCurrentTenantSlug } = await import('@/lib/tenant-storage')
const api = await import('./api')

const mockedUseAssets = vi.spyOn(api, 'useAssets')
const mockedUseSemanticAssetSearch = vi.spyOn(api, 'useSemanticAssetSearch')

describe('AssetPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setCurrentTenantSlug(null)
    mockedUseAssets.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    } as never)
    mockedUseSemanticAssetSearch.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    } as never)
  })

  afterEach(() => {
    cleanup()
    setCurrentTenantSlug(null)
    vi.clearAllMocks()
  })

  it('renders preview-first selected state with floating icon controls and no metadata labels', () => {
    setCurrentTenantSlug('acme')
    mockedUseAssets.mockReturnValue({
      data: [
        {
          id: 'asset-1',
          filename: 'blog/covers/hero.jpg',
          mimeType: 'image/jpeg',
          size: 1024,
          variants: [{ id: 'v-1', variant: 'medium', format: 'webp', width: 1024, height: 576 }],
        },
      ],
      isLoading: false,
      error: null,
    } as never)

    const view = render(
      <AssetPicker value={{ assetId: 'asset-1', variant: 'medium' }} onChange={vi.fn()} />
    )

    expect(view.getByRole('img', { name: 'Selected asset preview' }).getAttribute('src')).toBe(
      '/api/tenants/acme/api/public/assets/asset-1/medium.webp'
    )
    expect(view.getByRole('button', { name: 'Open asset browser' })).toBeInTheDocument()
    expect(view.getByRole('button', { name: 'Reselect current asset' })).toBeInTheDocument()
    expect(view.getByRole('button', { name: 'Clear selection' })).toBeInTheDocument()

    expect(view.queryByText(/^Variant$/i)).not.toBeInTheDocument()
    expect(view.queryByText(/Variant/i)).not.toBeInTheDocument()
    expect(view.queryByText(/root/i)).not.toBeInTheDocument()
    expect(view.queryByText(/image\/jpeg/i)).not.toBeInTheDocument()
    expect(view.queryByText(/hero.jpg/i)).not.toBeInTheDocument()
  })

  it('updates selected preview URLs when the active tenant changes', async () => {
    setCurrentTenantSlug('acme')
    mockedUseAssets.mockReturnValue({
      data: [
        {
          id: 'asset-1',
          filename: 'blog/covers/hero.jpg',
          mimeType: 'image/jpeg',
          size: 1024,
          variants: [{ id: 'v-1', variant: 'medium', format: 'webp', width: 1024, height: 576 }],
        },
      ],
      isLoading: false,
      error: null,
    } as never)

    const view = render(
      <AssetPicker value={{ assetId: 'asset-1', variant: 'medium' }} onChange={vi.fn()} />
    )

    expect(view.getByRole('img', { name: 'Selected asset preview' }).getAttribute('src')).toBe(
      '/api/tenants/acme/api/public/assets/asset-1/medium.webp'
    )

    act(() => {
      setCurrentTenantSlug('globex')
    })

    await waitFor(() => {
      expect(view.getByRole('img', { name: 'Selected asset preview' }).getAttribute('src')).toBe(
        '/api/tenants/globex/api/public/assets/asset-1/medium.webp'
      )
    })
  })

  it('supports multiple selection with preview navigation controls', () => {
    mockedUseAssets.mockReturnValue({
      data: [
        {
          id: 'asset-1',
          filename: 'blog/covers/hero.jpg',
          mimeType: 'image/jpeg',
          size: 1024,
          variants: [{ id: 'v-1', variant: 'medium', format: 'webp', width: 1024, height: 576 }],
        },
        {
          id: 'asset-2',
          filename: 'products/gallery/item.png',
          mimeType: 'image/png',
          size: 2048,
          variants: [{ id: 'v-2', variant: 'small', format: 'webp', width: 480, height: 320 }],
        },
        {
          id: 'asset-3',
          filename: 'team/headshot.webp',
          mimeType: 'image/webp',
          size: 1536,
          variants: [{ id: 'v-3', variant: 'medium', format: 'webp', width: 640, height: 640 }],
        },
      ],
      isLoading: false,
      error: null,
    } as never)

    const onChange = vi.fn()
    const view = render(
      <AssetPicker
        value={[
          { assetId: 'asset-1', variant: 'medium' },
          { assetId: 'asset-2', variant: 'small' },
          { assetId: 'asset-3', variant: 'medium' },
        ]}
        onChange={onChange}
      />
    )

    expect(view.getByRole('button', { name: 'Previous selected asset' })).toBeInTheDocument()
    expect(view.getByRole('button', { name: 'Next selected asset' })).toBeInTheDocument()

    fireEvent.click(view.getByRole('button', { name: 'Next selected asset' }))
    expect(view.getByRole('img', { name: 'Selected asset 2 of 3' })).toBeInTheDocument()

    fireEvent.click(view.getByRole('button', { name: 'Previous selected asset' }))
    expect(view.getByRole('img', { name: 'Selected asset 1 of 3' })).toBeInTheDocument()

    fireEvent.click(view.getByRole('button', { name: 'Open asset browser' }))
    fireEvent.click(view.getByRole('button', { name: 'Toggle asset selection asset-2' }))

    expect(onChange).toHaveBeenCalledWith([
      { assetId: 'asset-1', variant: 'medium' },
      { assetId: 'asset-3', variant: 'medium' },
    ])
  })

  it('shows guidance and selection summary to improve discoverability', () => {
    mockedUseAssets.mockReturnValue({
      data: [
        {
          id: 'asset-1',
          filename: 'blog/covers/hero.jpg',
          mimeType: 'image/jpeg',
          size: 1024,
          variants: [{ id: 'v-1', variant: 'medium', format: 'webp', width: 1024, height: 576 }],
        },
        {
          id: 'asset-2',
          filename: 'products/gallery/item.png',
          mimeType: 'image/png',
          size: 2048,
          variants: [{ id: 'v-2', variant: 'small', format: 'webp', width: 480, height: 320 }],
        },
      ],
      isLoading: false,
      error: null,
    } as never)

    const onChange = vi.fn()
    const view = render(<AssetPicker value={null} onChange={onChange} />)

    expect(view.getByText('No asset selected')).toBeInTheDocument()
    expect(view.getByText('0 selected')).toBeInTheDocument()

    fireEvent.click(view.getByRole('button', { name: 'Open asset browser' }))
    expect(view.getByRole('dialog')).toBeInTheDocument()
    expect(view.getAllByText('Tap any thumbnail to add it to the preview queue.').length).toBe(2)
    expect(view.getByRole('button', { name: 'Close asset browser' })).toBeInTheDocument()

    fireEvent.click(view.getByRole('button', { name: 'Toggle asset selection asset-1' }))
    expect(onChange).toHaveBeenCalledWith({ assetId: 'asset-1', variant: 'medium' })
  })

  it('opens the modal when empty preview state is clicked', () => {
    mockedUseAssets.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    } as never)

    const view = render(<AssetPicker value={null} onChange={vi.fn()} />)

    fireEvent.click(view.getByText('No asset selected'))
    expect(view.getByRole('dialog')).toBeInTheDocument()
  })

  it('shows filename and directory in search results and supports directory filtering', () => {
    mockedUseAssets.mockReturnValue({
      data: [
        {
          id: 'asset-1',
          filename: 'blog/covers/hero.jpg',
          mimeType: 'image/jpeg',
          size: 1024,
          variants: [{ id: 'v-1', variant: 'medium', format: 'webp', width: 1024, height: 576 }],
        },
        {
          id: 'asset-2',
          filename: 'team/avatar.png',
          mimeType: 'image/png',
          size: 512,
          variants: [{ id: 'v-2', variant: 'small', format: 'webp', width: 320, height: 320 }],
        },
      ],
      isLoading: false,
      error: null,
    } as never)

    const view = render(<AssetPicker value={null} onChange={vi.fn()} />)

    fireEvent.click(view.getByRole('button', { name: 'Open asset browser' }))

    expect(view.getByText('hero.jpg')).toBeInTheDocument()
    expect(view.getByText('Folder:')).toBeInTheDocument()
    expect(view.getByRole('button', { name: 'Filter folder blog' })).toBeInTheDocument()

    fireEvent.click(view.getByRole('button', { name: 'Filter folder team' }))

    expect(view.queryByText('hero.jpg')).not.toBeInTheDocument()
    expect(view.getByText('avatar.png')).toBeInTheDocument()
  })

  it('supports directory navigation and sorting controls in modal', () => {
    mockedUseAssets.mockReturnValue({
      data: [
        {
          id: 'asset-1',
          filename: 'blog/covers/zeta.jpg',
          mimeType: 'image/jpeg',
          size: 300,
          createdAt: '2026-02-01T00:00:00.000Z',
          variants: [{ id: 'v-1', variant: 'medium', format: 'webp', width: 800, height: 450 }],
        },
        {
          id: 'asset-2',
          filename: 'blog/covers/alpha.jpg',
          mimeType: 'image/jpeg',
          size: 100,
          createdAt: '2026-02-02T00:00:00.000Z',
          variants: [{ id: 'v-2', variant: 'medium', format: 'webp', width: 800, height: 450 }],
        },
        {
          id: 'asset-3',
          filename: 'team/avatar.png',
          mimeType: 'image/png',
          size: 200,
          createdAt: '2026-02-03T00:00:00.000Z',
          variants: [{ id: 'v-3', variant: 'small', format: 'webp', width: 320, height: 320 }],
        },
      ],
      isLoading: false,
      error: null,
    } as never)

    const view = render(<AssetPicker value={null} onChange={vi.fn()} />)
    fireEvent.click(view.getByRole('button', { name: 'Open asset browser' }))
    const modal = view.getByRole('dialog')

    fireEvent.click(within(modal).getByRole('button', { name: 'Disable semantic ranking' }))

    expect(view.getByRole('button', { name: 'Open directory blog' })).toBeInTheDocument()
    fireEvent.click(view.getByRole('button', { name: 'Open directory blog' }))
    expect(view.getByRole('button', { name: 'Navigate up directory' })).toBeInTheDocument()
    expect(view.getByRole('button', { name: 'Open directory blog/covers' })).toBeInTheDocument()

    fireEvent.click(view.getByRole('button', { name: 'Open directory blog/covers' }))
    fireEvent.change(view.getByLabelText('Sort assets'), { target: { value: 'name' } })
    fireEvent.click(view.getByRole('button', { name: 'Toggle sort direction' }))

    const ordered = view.getAllByRole('button', { name: /Toggle asset selection/ })
    expect(ordered[0]?.getAttribute('aria-label')).toBe('Toggle asset selection asset-2')
    expect(ordered[1]?.getAttribute('aria-label')).toBe('Toggle asset selection asset-1')
  })

  it('normalizes duplicate or stale asset IDs into one live selected state', async () => {
    mockedUseAssets.mockReturnValue({
      data: [
        {
          id: 'asset-1',
          filename: 'products/catalog/hero.jpg',
          mimeType: 'image/jpeg',
          size: 1024,
          variants: [{ id: 'v-1', variant: 'medium', format: 'webp', width: 1024, height: 576 }],
        },
        {
          id: 'asset-2',
          filename: 'team/avatar.png',
          mimeType: 'image/png',
          size: 512,
          variants: [{ id: 'v-2', variant: 'small', format: 'webp', width: 512, height: 512 }],
        },
      ],
      isLoading: false,
      error: null,
    } as never)

    const onChange = vi.fn()
    const view = render(
      <AssetPicker
        value={[
          { assetId: 'asset-1', variant: 'unknown' },
          { assetId: 'asset-1', variant: 'small' },
          { assetId: 'asset-missing', variant: 'small' },
        ]}
        onChange={onChange}
      />
    )

    expect(view.getByText('1 selected')).toBeInTheDocument()
    expect(
      view
        .getByRole('img', {
          name: 'Selected asset preview',
        })
        .getAttribute('src')
    ).toBe('/api/public/assets/asset-1/medium.webp')
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith([{ assetId: 'asset-1', variant: 'medium' }])
    })
  })

  it('supports clearing a single-value selection and returns scalar shape', () => {
    mockedUseAssets.mockReturnValue({
      data: [
        {
          id: 'asset-1',
          filename: 'blog/covers/hero.jpg',
          mimeType: 'image/jpeg',
          size: 1024,
          variants: [{ id: 'v-1', variant: 'medium', format: 'webp', width: 1024, height: 576 }],
        },
      ],
      isLoading: false,
      error: null,
    } as never)

    const onChange = vi.fn()
    const view = render(<AssetPicker value={{ assetId: 'asset-1', variant: 'medium' }} onChange={onChange} />)

    fireEvent.click(view.getByRole('button', { name: 'Open asset browser' }))
    fireEvent.click(view.getAllByRole('button', { name: 'Toggle asset selection asset-1' })[0])

    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('supports keyword search in modal results', async () => {
    const searchableAssets = [
      {
        id: 'asset-1',
        filename: 'blog/covers/hero.jpg',
        mimeType: 'image/jpeg',
        size: 1024,
        variants: [{ id: 'v-1', variant: 'medium', format: 'webp', width: 1024, height: 576 }],
      },
      {
        id: 'asset-2',
        filename: 'team/avatar.png',
        mimeType: 'image/png',
        size: 512,
        variants: [{ id: 'v-2', variant: 'small', format: 'webp', width: 320, height: 320 }],
      },
    ]

    const searchAsset = searchableAssets[1]!
    mockedUseAssets.mockReturnValue({
      data: searchableAssets,
      isLoading: false,
      error: null,
    } as never)
    mockedUseSemanticAssetSearch.mockImplementation((input) => ({
      data: input?.query === 'avatar' ? [searchAsset] : searchableAssets,
      isLoading: false,
      error: null,
    } as never))

    const view = render(<AssetPicker value={null} onChange={vi.fn()} />)
    fireEvent.click(view.getByRole('button', { name: 'Open asset browser' }))
    const modal = view.getByRole('dialog')

    const user = userEvent.setup()
    const searchInput = view.getByPlaceholderText('Search assets')
    await user.type(searchInput, 'avatar')

    await waitFor(() => {
      expect(mockedUseSemanticAssetSearch).toHaveBeenLastCalledWith(
        expect.objectContaining({ query: 'avatar' }),
        true
      )
      expect(within(modal).getByText('avatar.png')).toBeInTheDocument()
      expect(
        within(modal).getByRole('button', { name: 'Toggle asset selection asset-2' })
      ).toBeInTheDocument()
    })

    await waitFor(() => {
      expect(
        within(modal).queryByText('hero.jpg')
      ).not.toBeInTheDocument()
      expect(
        within(modal).queryAllByRole('button', { name: /Toggle asset selection/ })
      ).toHaveLength(1)
    })
  })
})
