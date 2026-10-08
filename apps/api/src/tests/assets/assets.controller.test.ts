import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { Elysia } from 'elysia'
import {
  DEFAULT_ASSET_ALLOWED_MIME_TYPES,
  normalizeAllowedAssetMimeTypes,
} from '../../assets/file-policy'

const mockDb = {} as D1Database
const mockR2 = {
  get: vi.fn(),
  put: vi.fn(),
} as unknown as R2Bucket
const mockLoggerError = vi.fn()

vi.mock('cloudflare:workers', () => ({
  env: { DB: mockDb, CACHE: {} as KVNamespace, MEDIA: mockR2 },
}))
vi.mock('@/auth/auth.middleware', () => ({
  betterAuthPlugin: new Elysia(),
}))
vi.mock('@/tenants/tenant-context', () => ({
  hasTenantContext: (ctx: unknown) =>
    typeof ctx === 'object' &&
    ctx !== null &&
    'tenant' in ctx &&
    typeof (ctx as { tenant: unknown }).tenant === 'object' &&
    (ctx as { tenant: unknown }).tenant !== null &&
    'tenant' in ((ctx as { tenant: unknown }).tenant as object) &&
    'resources' in ((ctx as { tenant: unknown }).tenant as object),
  getTenantContext: (ctx: { tenant: unknown }) => ctx.tenant,
  resolveTenantBindings: () => ({ db: mockDb, kv: {} as KVNamespace, r2: mockR2 }),
  verifyTenantMembership: vi.fn(async () => 'owner'),
}))
vi.mock('@/observability/logger', () => ({
  logger: {
    error: (...args: unknown[]) => mockLoggerError(...args),
    warn: vi.fn(),
    info: vi.fn(),
  },
}))
vi.mock('../../assets/assets.service', () => ({
  DEFAULT_ASSET_UPLOAD_MAX_BYTES: 5 * 1024 * 1024,
  DEFAULT_ASSET_UPLOAD_MAX_DIMENSION: 2048,
  DEFAULT_ASSET_ALLOWED_MIME_TYPES,
  normalizeAllowedAssetMimeTypes,
  assetsService: {
    upload: vi.fn(),
    list: vi.fn(),
    usage: vi.fn(),
    getById: vi.fn(),
    updateFilename: vi.fn(),
    softDelete: vi.fn(),
    deleteMany: vi.fn(),
  },
}))

import { assetsService } from '../../assets/assets.service'

const { assetsController } = await import(`../../assets/assets.controller?bypass=${Date.now()}`)

describe('assetsController', () => {
  const app = new Elysia().use(assetsController)
  const mockService = assetsService as unknown as {
    upload: ReturnType<typeof vi.fn>
    list: ReturnType<typeof vi.fn>
    usage: ReturnType<typeof vi.fn>
    getById: ReturnType<typeof vi.fn>
    updateFilename: ReturnType<typeof vi.fn>
    softDelete: ReturnType<typeof vi.fn>
    deleteMany: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('POST /api/admin/assets/upload stores asset metadata + variants', async () => {
    mockService.upload.mockResolvedValue({
      id: 'a1',
      blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
      variants: [{ id: 'v1' }, { id: 'v2' }, { id: 'v3' }, { id: 'v4' }, { id: 'v5' }],
    })

    const response = await app.handle(
      new Request('http://localhost/api/admin/assets/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: 'image.jpg',
          mimeType: 'image/jpeg',
          contentBase64: btoa('hello'),
          variants: [{ variant: 'thumb', format: 'webp' }],
        }),
      })
    )

    expect(response.status).toBe(201)
    const body = (await response.json()) as {
      success: boolean
      data: { id: string; blurhash?: string; variants: unknown[] }
    }
    expect(body.success).toBe(true)
    expect(body.data.id).toBe('a1')
    expect(body.data.blurhash).toBeTruthy()
    expect(body.data.variants.length).toBeGreaterThan(4)
  })

  it('POST /api/admin/assets/upload returns 413 when payload is too large', async () => {
    mockService.upload.mockRejectedValueOnce(
      new Error('Asset upload exceeds maximum size of 5242880 bytes')
    )

    const response = await app.handle(
      new Request('http://localhost/api/admin/assets/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: 'too-large.jpg',
          mimeType: 'image/jpeg',
          contentBase64: btoa('small'),
        }),
      })
    )

    expect(response.status).toBe(413)
    const body = (await response.json()) as { success: boolean; error?: { code?: string } }
    expect(body.success).toBe(false)
    expect(body.error?.code).toBe('PAYLOAD_TOO_LARGE')
  })

  it('POST /api/admin/assets/upload accepts multipart upload payloads', async () => {
    mockService.upload.mockResolvedValue({
      id: 'a2',
      variants: [],
    })

    const formData = new FormData()
    formData.set(
      'file',
      new File([new Uint8Array([0x01, 0x02, 0x03])], 'hero.jpg', { type: 'image/jpeg' })
    )
    formData.set('filename', 'marketing/hero.jpg')

    const response = await app.handle(
      new Request('http://localhost/api/admin/assets/upload', {
        method: 'POST',
        body: formData,
      })
    )

    expect(response.status).toBe(201)
    expect(mockService.upload).toHaveBeenCalledWith(
      mockDb,
      mockR2,
      expect.objectContaining({
        filename: 'marketing/hero.jpg',
        mimeType: 'image/jpeg',
        contentBase64: expect.any(String),
      }),
      undefined,
      expect.objectContaining({
        DB: mockDb,
        MEDIA: mockR2,
      }),
      undefined,
      undefined,
      5 * 1024 * 1024,
      2048,
      DEFAULT_ASSET_ALLOWED_MIME_TYPES
    )
  })

  it('GET /api/admin/assets/config returns default upload cap', async () => {
    const response = await app.handle(new Request('http://localhost/api/admin/assets/config'))

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      success: boolean
      data: { maxUploadBytes: number; maxUploadDimension: number; allowedMimeTypes: string[] }
    }
    expect(body.success).toBe(true)
    expect(body.data.maxUploadBytes).toBe(5 * 1024 * 1024)
    expect(body.data.maxUploadDimension).toBe(2048)
    expect(body.data.allowedMimeTypes).toEqual(DEFAULT_ASSET_ALLOWED_MIME_TYPES)
  })

  it('POST /api/admin/assets/upload returns 415 when file type is blocked', async () => {
    mockService.upload.mockRejectedValueOnce(new Error('Asset upload type is not allowed: text/html'))

    const response = await app.handle(
      new Request('http://localhost/api/admin/assets/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: 'payload.html',
          mimeType: 'text/html',
          contentBase64: btoa('<script>alert(1)</script>'),
        }),
      })
    )

    expect(response.status).toBe(415)
    const body = (await response.json()) as { success: boolean; error?: { code?: string } }
    expect(body.success).toBe(false)
    expect(body.error?.code).toBe('UNSUPPORTED_MEDIA_TYPE')
  })

  it('POST /api/admin/assets/upload returns image processing details when codec fails', async () => {
    mockService.upload.mockRejectedValueOnce(new Error('Unsupported image format'))

    const response = await app.handle(
      new Request('http://localhost/api/admin/assets/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: 'broken.jpg',
          mimeType: 'image/jpeg',
          contentBase64: btoa('not-an-image'),
        }),
      })
    )

    expect(response.status).toBe(422)
    const body = (await response.json()) as {
      success: boolean
      error?: { code?: string; message?: string; details?: { reason?: string } }
    }
    expect(body.success).toBe(false)
    expect(body.error?.code).toBe('IMAGE_PROCESSING_FAILED')
    expect(body.error?.message).toBe('Asset upload failed while processing the image')
    expect(body.error?.details?.reason).toBe('Unsupported image format')
    expect(mockLoggerError).toHaveBeenCalledWith(
      'asset_upload_failed',
      expect.objectContaining({
        code: 'IMAGE_PROCESSING_FAILED',
        status: 422,
        reason: 'Unsupported image format',
        filename: 'broken.jpg',
        mimeType: 'image/jpeg',
      })
    )
  })

  it('GET /api/admin/assets/usage returns grouped tenant media usage', async () => {
    mockService.usage.mockResolvedValue([
      { tenantId: 'tenant_1', assetCount: 3, totalBytes: 1024 },
      { tenantId: 'tenant_2', assetCount: 1, totalBytes: 2048 },
    ])

    const response = await app.handle(new Request('http://localhost/api/admin/assets/usage'))

    expect(response.status).toBe(200)
    expect(mockService.usage).toHaveBeenCalledWith(mockDb, undefined)
    const body = (await response.json()) as {
      success: boolean
      data: Array<{ tenantId: string; assetCount: number; totalBytes: number }>
    }
    expect(body.success).toBe(true)
    expect(body.data).toEqual([
      { tenantId: 'tenant_1', assetCount: 3, totalBytes: 1024 },
      { tenantId: 'tenant_2', assetCount: 1, totalBytes: 2048 },
    ])
  })

  it('GET /api/admin/assets and /api/admin/assets/:assetId return expected metadata', async () => {
    mockService.list.mockResolvedValue([{ id: 'a1' }])
    mockService.getById.mockResolvedValue({ id: 'a1', variants: [] })

    const listRes = await app.handle(new Request('http://localhost/api/admin/assets'))
    expect(listRes.status).toBe(200)

    const detailRes = await app.handle(new Request('http://localhost/api/admin/assets/a1'))
    expect(detailRes.status).toBe(200)
    const detailBody = (await detailRes.json()) as { data: { id: string } }
    expect(detailBody.data.id).toBe('a1')
  })

  it('PUT /api/admin/assets/:assetId updates filename for folder management', async () => {
    mockService.updateFilename.mockResolvedValue({
      id: 'a1',
      filename: 'campaign/spring/image.jpg',
    })

    const response = await app.handle(
      new Request('http://localhost/api/admin/assets/a1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: 'campaign/spring/image.jpg',
        }),
      })
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as { success: boolean; data: { filename: string } }
    expect(body.success).toBe(true)
    expect(body.data.filename).toBe('campaign/spring/image.jpg')
  })

  it('POST /api/admin/assets/delete bulk deletes assets', async () => {
    mockService.deleteMany.mockResolvedValue({ deletedIds: ['a1', 'a2'] })

    const response = await app.handle(
      new Request('http://localhost/api/admin/assets/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: ['a1', 'a2'] }),
      })
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as { success: boolean; data: { deletedIds: string[] } }
    expect(body.success).toBe(true)
    expect(body.data.deletedIds).toEqual(['a1', 'a2'])
  })

  it('DELETE /api/admin/assets/:assetId soft deletes an asset', async () => {
    mockService.softDelete.mockResolvedValue({ deletedIds: ['a1'] })

    const response = await app.handle(
      new Request('http://localhost/api/admin/assets/a1', {
        method: 'DELETE',
      })
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as { success: boolean; data: { deletedIds: string[] } }
    expect(body.success).toBe(true)
    expect(body.data.deletedIds).toEqual(['a1'])
  })

  it('DELETE /api/admin/assets/:assetId returns 404 when asset does not exist', async () => {
    mockService.softDelete.mockResolvedValue({ deletedIds: [] })

    const response = await app.handle(
      new Request('http://localhost/api/admin/assets/missing', {
        method: 'DELETE',
      })
    )

    expect(response.status).toBe(404)
    const body = (await response.json()) as { success: boolean; error?: { code?: string } }
    expect(body.success).toBe(false)
    expect(body.error?.code).toBe('NOT_FOUND')
  })

})
