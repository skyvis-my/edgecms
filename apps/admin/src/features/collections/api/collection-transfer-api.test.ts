import { beforeEach, describe, expect, it, vi } from 'bun:test'

const mockEdenGet = vi.fn()
const mockEdenPost = vi.fn()

vi.mock('@/lib/eden-client', () => ({
  edenGet: (...args: unknown[]) => mockEdenGet(...args),
  edenPost: (...args: unknown[]) => mockEdenPost(...args),
  edenPut: vi.fn(),
  edenPatch: vi.fn(),
  edenDelete: vi.fn(),
  edenPostMultipart: vi.fn(),
  edenPostForTenant: vi.fn(),
  normalizeEdenResponse: vi.fn(),
  resolveApiBasePath: () => '/api',
  eden: {},
}))

const api = await import('./collection-transfer-api')

describe('collection transfer API (OP-06)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls the export, preview and execute routes for the collection slug', async () => {
    mockEdenGet.mockResolvedValue({ entries: [] })
    mockEdenPost.mockResolvedValue({})
    const document = { format: 'edgecms.collection-export' }

    await api.exportCollection('blog posts')
    await api.previewCollectionImport('posts', { document, strategy: 'update' })
    await api.executeCollectionImport('posts', { document, strategy: 'update', previewReceipt: 'r-1' })

    expect(mockEdenGet).toHaveBeenCalledWith('/admin/collections/blog%20posts/export')
    expect(mockEdenPost).toHaveBeenNthCalledWith(1, '/admin/collections/posts/import/preview', {
      document,
      strategy: 'update',
    })
    expect(mockEdenPost).toHaveBeenNthCalledWith(2, '/admin/collections/posts/import/execute', {
      document,
      strategy: 'update',
      previewReceipt: 'r-1',
    })
  })

  it('parses an export file and rejects invalid JSON or other formats', async () => {
    const valid = new File([JSON.stringify({ format: 'edgecms.collection-export', entries: [] })], 'a.json')
    expect(await api.parseImportFile(valid)).toEqual({
      ok: true,
      document: { format: 'edgecms.collection-export', entries: [] },
    })

    const broken = await api.parseImportFile(new File(['{nope'], 'b.json'))
    expect(broken).toEqual({ ok: false, message: 'This file is not valid JSON.' })

    const other = await api.parseImportFile(new File([JSON.stringify({ entries: [] })], 'c.json'))
    expect(other.ok).toBe(false)
  })

  it('names export files by collection and date', () => {
    expect(api.exportFileName('posts', new Date('2026-11-05T10:00:00Z'))).toBe('posts-export-2026-11-05.json')
  })

  describe('resolveTransferAccess', () => {
    const viewer = (tenantRole: string | null, globalRole: string | null = 'viewer') => ({
      globalRole,
      tenantSlug: 'acme',
      tenantRole,
    })

    it('fails closed until the viewer is known', () => {
      expect(api.resolveTransferAccess(null)).toEqual({ canExport: false, canImport: false })
      expect(api.resolveTransferAccess(viewer(null))).toEqual({ canExport: false, canImport: false })
    })

    it('mirrors the built-in roles', () => {
      for (const role of ['owner', 'admin', 'editor']) {
        expect(api.resolveTransferAccess(viewer(role))).toEqual({ canExport: true, canImport: true })
      }
      expect(api.resolveTransferAccess(viewer('member'))).toEqual({ canExport: true, canImport: false })
      expect(api.resolveTransferAccess(viewer('viewer'))).toEqual({ canExport: false, canImport: false })
      expect(api.resolveTransferAccess(viewer('custom-reviewer'))).toEqual({ canExport: false, canImport: false })
    })

    it('lets a superadmin use both, and a global admin only through a tenant role', () => {
      expect(api.resolveTransferAccess(viewer(null, 'superadmin'))).toEqual({ canExport: true, canImport: true })
      expect(api.resolveTransferAccess(viewer(null, 'admin'))).toEqual({ canExport: false, canImport: false })
    })
  })
})
