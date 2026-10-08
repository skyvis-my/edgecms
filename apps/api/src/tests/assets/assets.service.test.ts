import { beforeEach, describe, expect, it, vi } from 'bun:test'
import type { Database } from '@/database/db'

vi.mock('../../assets/assets.repository', () => ({
  assetsRepository: {
    createAsset: vi.fn(),
    createVariants: vi.fn(),
    findAll: vi.fn(),
    findById: vi.fn(),
    findVariant: vi.fn(),
    updateFilename: vi.fn(),
    findByIds: vi.fn(),
    softDeleteByIds: vi.fn(),
    deleteByIds: vi.fn(),
  },
}))

import { assetsRepository } from '../../assets/assets.repository'

const { assetsService } = await import(`../../assets/assets.service?bypass=${Date.now()}`)

const VALID_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQAASABIAAD/4QBARXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAAqACAAQAAAABAAAABKADAAQAAAABAAAAAwAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/+IRrElDQ19QUk9GSUxFAAEBAAARnGFwcGwCAAAAbW50ckdSQVlYWVogB9wACAAXAA8ALgAPYWNzcEFQUEwAAAAAbm9uZQAAAAAAAAAAAAAAAAAAAAAAAPbWAAEAAAAA0y1hcHBsAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFZGVzYwAAAMAAAAB5ZHNjbQAAATwAAAgaY3BydAAACVgAAAAjd3RwdAAACXwAAAAUa1RSQwAACZAAAAgMZGVzYwAAAAAAAAAfR2VuZXJpYyBHcmF5IEdhbW1hIDIuMiBQcm9maWxlAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAG1sdWMAAAAAAAAAHwAAAAxza1NLAAAALgAAAYRkYURLAAAAOgAAAbJjYUVTAAAAOAAAAex2aVZOAAAAQAAAAiRwdEJSAAAASgAAAmR1a1VBAAAALAAAAq5mckZVAAAAPgAAAtpodUhVAAAANAAAAxh6aFRXAAAAGgAAA0xrb0tSAAAAIgAAA2ZuYk5PAAAAOgAAA4hjc0NaAAAAKAAAA8JoZUlMAAAAJAAAA+pyb1JPAAAAKgAABA5kZURFAAAATgAABDhpdElUAAAATgAABIZzdlNFAAAAOAAABNR6aENOAAAAGgAABQxqYUpQAAAAJgAABSZlbEdSAAAAKgAABUxwdFBPAAAAUgAABXZubE5MAAAAQAAABchlc0VTAAAATAAABgh0aFRIAAAAMgAABlR0clRSAAAAJAAABoZmaUZJAAAARgAABqpockhSAAAAPgAABvBwbFBMAAAASgAABy5hckVHAAAALAAAB3hydVJVAAAAOgAAB6RlblVTAAAAPAAAB94AVgFhAGUAbwBiAGUAYwBuAOEAIABzAGkAdgDhACAAZwBhAG0AYQAgADIALAAyAEcAZQBuAGUAcgBpAHMAawAgAGcAcgDlACAAMgAsADIAIABnAGEAbQBtAGEALQBwAHIAbwBmAGkAbABHAGEAbQBtAGEAIABkAGUAIABnAHIAaQBzAG8AcwAgAGcAZQBuAOgAcgBpAGMAYQAgADIALgAyAEMepQB1ACAAaADsAG4AaAAgAE0A4AB1ACAAeADhAG0AIABDAGgAdQBuAGcAIABHAGEAbQBtAGEAIAAyAC4AMgBQAGUAcgBmAGkAbAAgAEcAZQBuAOkAcgBpAGMAbwAgAGQAYQAgAEcAYQBtAGEAIABkAGUAIABDAGkAbgB6AGEAcwAgADIALAAyBBcEMAQzBDAEOwRMBD0EMAAgAEcAcgBhAHkALQQzBDAEPAQwACAAMgAuADIAUAByAG8AZgBpAGwAIABnAOkAbgDpAHIAaQBxAHUAZQAgAGcAcgBpAHMAIABnAGEAbQBtAGEAIAAyACwAMgDBAGwAdABhAGwA4QBuAG8AcwAgAHMAegD8AHIAawBlACAAZwBhAG0AbQBhACAAMgAuADKQGnUocHCWjlFJXqYAMgAuADKCcl9pY8+P8Md8vBgAINaMwMkAIKwQucgAIAAyAC4AMgAg1QS4XNMMx3wARwBlAG4AZQByAGkAcwBrACAAZwByAOUAIABnAGEAbQBtAGEAIAAyACwAMgAtAHAAcgBvAGYAaQBsAE8AYgBlAGMAbgDhACABYQBlAGQA4QAgAGcAYQBtAGEAIAAyAC4AMgXSBdAF3gXUACAF0AXkBdUF6AAgBdsF3AXcBdkAIAAyAC4AMgBHAGEAbQBhACAAZwByAGkAIABnAGUAbgBlAHIAaQBjAQMAIAAyACwAMgBBAGwAbABnAGUAbQBlAGkAbgBlAHMAIABHAHIAYQB1AHMAdAB1AGYAZQBuAC0AUAByAG8AZgBpAGwAIABHAGEAbQBtAGEAIAAyACwAMgBQAHIAbwBmAGkAbABvACAAZwByAGkAZwBpAG8AIABnAGUAbgBlAHIAaQBjAG8AIABkAGUAbABsAGEAIABnAGEAbQBtAGEAIAAyACwAMgBHAGUAbgBlAHIAaQBzAGsAIABnAHIA5QAgADIALAAyACAAZwBhAG0AbQBhAHAAcgBvAGYAaQBsZm6QGnBwXqZ8+2VwADIALgAyY8+P8GWHTvZOAIIsMLAw7DCkMKww8zDeACAAMgAuADIAIDDXMO0w1TChMKQw6wOTA7UDvQO5A7oDzAAgA5MDugPBA7kAIAOTA6wDvAO8A7EAIAAyAC4AMgBQAGUAcgBmAGkAbAAgAGcAZQBuAOkAcgBpAGMAbwAgAGQAZQAgAGMAaQBuAHoAZQBuAHQAbwBzACAAZABhACAARwBhAG0AbQBhACAAMgAsADIAQQBsAGcAZQBtAGUAZQBuACAAZwByAGkAagBzACAAZwBhAG0AbQBhACAAMgAsADIALQBwAHIAbwBmAGkAZQBsAFAAZQByAGYAaQBsACAAZwBlAG4A6QByAGkAYwBvACAAZABlACAAZwBhAG0AbQBhACAAZABlACAAZwByAGkAcwBlAHMAIAAyACwAMg4jDjEOBw4qDjUOQQ4BDiEOIQ4yDkAOAQ4jDiIOTA4XDjEOSA4nDkQOGwAgADIALgAyAEcAZQBuAGUAbAAgAEcAcgBpACAARwBhAG0AYQAgADIALAAyAFkAbABlAGkAbgBlAG4AIABoAGEAcgBtAGEAYQBuACAAZwBhAG0AbQBhACAAMgAsADIAIAAtAHAAcgBvAGYAaQBpAGwAaQBHAGUAbgBlAHIAaQENAGsAaQAgAEcAcgBhAHkAIABHAGEAbQBtAGEAIAAyAC4AMgAgAHAAcgBvAGYAaQBsAFUAbgBpAHcAZQByAHMAYQBsAG4AeQAgAHAAcgBvAGYAaQBsACAAcwB6AGEAcgBvAVsAYwBpACAAZwBhAG0AbQBhACAAMgAsADIGOgYnBkUGJwAgADIALgAyACAGRAZIBkYAIAYxBkUGJwYvBkoAIAY5BicGRQQeBDEESQQwBE8AIARBBDUEQAQwBE8AIAQzBDAEPAQ8BDAAIAAyACwAMgAtBD8EQAQ+BEQEOAQ7BEwARwBlAG4AZQByAGkAYwAgAEcAcgBhAHkAIABHAGEAbQBtAGEAIAAyAC4AMgAgAFAAcgBvAGYAaQBsAGUAAHRleHQAAAAAQ29weXJpZ2h0IEFwcGxlIEluYy4sIDIwMTIAAFhZWiAAAAAAAADzUQABAAAAARbMY3VydgAAAAAAAAQAAAAABQAKAA8AFAAZAB4AIwAoAC0AMgA3ADsAQABFAEoATwBUAFkAXgBjAGgAbQByAHcAfACBAIYAiwCQAJUAmgCfAKQAqQCuALIAtwC8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'

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.slice(start, start + length))
}

const mockRepo = assetsRepository as unknown as {
  createAsset: ReturnType<typeof vi.fn>
  createVariants: ReturnType<typeof vi.fn>
  findAll: ReturnType<typeof vi.fn>
  findById: ReturnType<typeof vi.fn>
  findVariant: ReturnType<typeof vi.fn>
  updateFilename: ReturnType<typeof vi.fn>
  findByIds: ReturnType<typeof vi.fn>
  softDeleteByIds: ReturnType<typeof vi.fn>
  deleteByIds: ReturnType<typeof vi.fn>
}

describe('assetsService', () => {
  const db = {} as Database
  const r2 = {
    put: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
  } as unknown as R2Bucket

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('upload stores metadata and variants', async () => {
    mockRepo.createAsset.mockResolvedValue({ id: 'a1' })
    mockRepo.findById.mockResolvedValue({ id: 'a1', variants: [{ id: 'v1' }] })

    const base64 = VALID_JPEG_BASE64
    const result = await assetsService.upload(db, r2, {
      filename: 'photo.jpg',
      mimeType: 'image/jpeg',
      contentBase64: base64,
      variants: [
        {
          variant: 'thumbnail',
          format: 'webp',
          width: 120,
          height: 120,
          contentBase64: Buffer.from('RIFFxxxxWEBP').toString('base64'),
        },
      ],
    })

    expect(r2.put).toHaveBeenCalledTimes(2)
    const putCalls = (r2.put as unknown as ReturnType<typeof vi.fn>).mock.calls as Array<
      [string, Uint8Array, unknown]
    >
    const anyWebp = putCalls.find(([key]) => key.endsWith('.webp'))
    expect(anyWebp).toBeDefined()
    if (!anyWebp) {
      throw new Error('Expected a WebP variant upload call')
    }
    expect(ascii(anyWebp[1], 0, 4)).toBe('RIFF')
    expect(ascii(anyWebp[1], 8, 4)).toBe('WEBP')
    expect(mockRepo.createAsset).toHaveBeenCalled()
    expect(mockRepo.createVariants).toHaveBeenCalled()
    expect(result?.id).toBe('a1')
  })

  it('upload stores createdBy actor reference when provided', async () => {
    mockRepo.createAsset.mockResolvedValue({ id: 'a1' })
    mockRepo.findById.mockResolvedValue({ id: 'a1', variants: [] })

    await assetsService.upload(
      db,
      r2,
      {
        filename: 'photo.jpg',
        mimeType: 'image/jpeg',
        contentBase64: VALID_JPEG_BASE64,
      },
      'global',
      undefined,
      'user-123'
    )

    expect(mockRepo.createAsset).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        createdBy: 'user-123',
      })
    )
  })

  it('rejects uploads larger than the default 5MB cap', async () => {
    const oversized = Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64')

    await expect(
      assetsService.upload(db, r2, {
        filename: 'too-large.jpg',
        mimeType: 'image/jpeg',
        contentBase64: oversized,
      })
    ).rejects.toThrow('Asset upload exceeds maximum size of 5242880 bytes')
  })

  it('uses caller-provided upload cap for tenant-specific limits', async () => {
    const customCap = 6 * 1024 * 1024
    const oversized = Buffer.alloc(customCap + 1).toString('base64')

    await expect(
      assetsService.upload(
        db,
        r2,
        {
          filename: 'too-large.jpg',
          mimeType: 'image/jpeg',
          contentBase64: oversized,
        },
        'tenant-1',
        undefined,
        undefined,
        undefined,
        customCap,
        2048
      )
    ).rejects.toThrow(`Asset upload exceeds maximum size of ${customCap} bytes`)
  })

  it('uploads safe non-image files without generating image variants', async () => {
    mockRepo.createAsset.mockResolvedValue({ id: 'a-doc' })
    mockRepo.findById.mockResolvedValue({ id: 'a-doc', variants: [] })

    await assetsService.upload(db, r2, {
      filename: 'docs/menu.pdf',
      mimeType: 'application/pdf',
      contentBase64: Buffer.from('%PDF-1.7').toString('base64'),
    })

    expect(mockRepo.createAsset).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        filename: 'docs/menu.pdf',
        mimeType: 'application/pdf',
        width: null,
        height: null,
      })
    )
    expect(mockRepo.createVariants).toHaveBeenCalledWith(db, [])
  })

  it('rejects dangerous MIME types even when tenant config allows them', async () => {
    await expect(
      assetsService.upload(
        db,
        r2,
        {
          filename: 'payload.html',
          mimeType: 'text/html',
          contentBase64: Buffer.from('<script>alert(1)</script>').toString('base64'),
        },
        'tenant-1',
        undefined,
        undefined,
        undefined,
        5 * 1024 * 1024,
        2048,
        ['text/html']
      )
    ).rejects.toThrow('Asset upload type is not allowed: text/html')
  })

  it('rejects dangerous filename extensions when MIME type is misleading', async () => {
    await expect(
      assetsService.upload(db, r2, {
        filename: 'payload.svg',
        mimeType: 'image/png',
        contentBase64: Buffer.from('<svg onload="alert(1)" />').toString('base64'),
      })
    ).rejects.toThrow('Asset upload type is not allowed: image/png')
  })

  it('does not generate image variants on the Worker when the client did not provide them', async () => {
    mockRepo.createAsset.mockResolvedValue({ id: 'a1' })
    mockRepo.findById.mockResolvedValue({ id: 'a1', variants: [{ id: 'v1' }] })

    await assetsService.upload(
      db,
      r2,
      {
        filename: 'hero.jpg',
        mimeType: 'image/jpeg',
        contentBase64: VALID_JPEG_BASE64,
      },
      'tenant-1',
      undefined,
      undefined,
      undefined,
      5 * 1024 * 1024,
      2
    )

    expect(mockRepo.createVariants).toHaveBeenCalledWith(db, [])
  })

  it('upload uses tenant-prefixed object keys for tenant-scoped uploads', async () => {
    mockRepo.createAsset.mockResolvedValue({ id: 'a1' })
    mockRepo.findById.mockResolvedValue({ id: 'a1', variants: [{ id: 'v1' }] })

    const result = await assetsService.upload(
      db,
      r2,
      {
        filename: 'hero banner.jpg',
        mimeType: 'image/jpeg',
        contentBase64: VALID_JPEG_BASE64,
        variants: [{ variant: 'thumbnail', format: 'webp' }],
      },
      'tenant-acme'
    )

    expect(mockRepo.createAsset).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        originalKey: expect.stringContaining('tenants/tenant-acme/assets/'),
      })
    )
    expect(r2.put).toHaveBeenCalledWith(
      expect.stringContaining('tenants/tenant-acme/assets/'),
      expect.any(Uint8Array),
      expect.any(Object)
    )
    expect(result?.id).toBe('a1')
  })

  it('getPublicVariant resolves variant and returns object', async () => {
    mockRepo.findVariant.mockResolvedValue({
      objectKey: 'assets/a1/thumbnail.webp',
      variant: 'thumbnail',
    })
    ;(r2.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      body: new ReadableStream(),
      httpMetadata: { contentType: 'image/webp' },
    })

    const result = await assetsService.getPublicVariant(db, r2, 'a1', 'thumbnail', 'webp')
    expect(result?.variant.variant).toBe('thumbnail')
  })

  it('resolvePublicVariant negotiates AVIF > WebP > original', async () => {
    mockRepo.findById.mockResolvedValue({
      id: 'a1',
      originalKey: 'assets/a1/original.jpg',
      mimeType: 'image/jpeg',
      variants: [
        { variant: 'medium', format: 'webp', objectKey: 'assets/a1/medium.webp' },
        { variant: 'medium', format: 'avif', objectKey: 'assets/a1/medium.avif' },
      ],
    })

    const avif = await assetsService.resolvePublicVariant(
      db,
      'a1',
      'medium',
      'image/avif,image/webp'
    )
    expect(avif).toEqual({
      success: true,
      data: { key: 'assets/a1/medium.avif', contentType: 'image/avif' },
    })

    const webp = await assetsService.resolvePublicVariant(db, 'a1', 'medium', 'image/webp')
    expect(webp).toEqual({
      success: true,
      data: { key: 'assets/a1/medium.webp', contentType: 'image/webp' },
    })

    const original = await assetsService.resolvePublicVariant(db, 'a1', 'medium', 'image/png')
    expect(original).toEqual({
      success: true,
      data: { key: 'assets/a1/original.jpg', contentType: 'image/jpeg' },
    })
  })

  it('updateFilename trims separators and updates an asset path', async () => {
    mockRepo.updateFilename.mockResolvedValue({ id: 'a1', filename: 'marketing/hero.jpg' })

    const result = await assetsService.updateFilename(db, 'a1', '/marketing//hero.jpg')

    expect(mockRepo.updateFilename).toHaveBeenCalledWith(db, 'a1', 'marketing/hero.jpg', 'global')
    expect(result?.filename).toBe('marketing/hero.jpg')
  })

  it('deleteMany soft deletes matching assets and leaves R2 cleanup deferred', async () => {
    mockRepo.findByIds.mockResolvedValueOnce([
      {
        id: 'a1',
        originalKey: 'assets/original/a1.jpg',
        variants: [{ objectKey: 'assets/variants/a1.webp' }],
      },
    ])
    mockRepo.softDeleteByIds.mockResolvedValue(['a1'])

    const result = await assetsService.deleteMany(db, r2, ['a1', 'missing'])

    expect(r2.delete).not.toHaveBeenCalled()
    expect(mockRepo.softDeleteByIds).toHaveBeenCalledWith(db, ['a1'], 'global')
    expect(result).toEqual({ deletedIds: ['a1'] })
  })

  it('softDelete soft deletes a single asset id', async () => {
    mockRepo.findByIds.mockResolvedValueOnce([
      {
        id: 'a1',
        originalKey: 'assets/original/a1.jpg',
        variants: [],
      },
    ])
    mockRepo.softDeleteByIds.mockResolvedValueOnce(['a1'])

    const result = await assetsService.softDelete(db, r2, 'a1')

    expect(result).toEqual({ deletedIds: ['a1'] })
    expect(mockRepo.softDeleteByIds).toHaveBeenCalledWith(db, ['a1'], 'global')
  })
})
