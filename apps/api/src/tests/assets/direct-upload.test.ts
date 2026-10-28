import { describe, expect, it } from 'bun:test'
import { assetsService } from '../../assets/assets.service'

describe('Domain 3: Direct-to-R2 Upload Ingestion', () => {
  it('creates presigned upload intent with correct metadata and headers', async () => {
    const intent = await assetsService.createDirectUploadIntent(
      {
        filename: 'large-video.mp4',
        mimeType: 'video/mp4',
        size: 500 * 1024 * 1024, // 500MB
      },
      'tenant-alpha'
    )

    expect(intent.assetId).toBeDefined()
    expect(intent.objectKey).toBe(`tenant-alpha/${intent.assetId}/original.mp4`)
    expect(intent.headers['Content-Type']).toBe('video/mp4')
    expect(intent.headers['x-amz-meta-tenant']).toBe('tenant-alpha')
    expect(intent.headers['x-amz-meta-asset-id']).toBe(intent.assetId)
    expect(intent.uploadUrl).toBe(`/api/admin/assets/direct-upload/${intent.assetId}`)
    expect(new Date(intent.expiresAt).getTime()).toBeGreaterThan(Date.now())
  })
})
