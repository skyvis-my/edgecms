import { beforeEach, describe, expect, it, vi } from 'bun:test'

const mockAdd = vi.fn().mockResolvedValue(1)
const mockUpdate = vi.fn().mockResolvedValue(1)
const mockWhereEquals = vi.fn()
const mockToArray = vi.fn().mockResolvedValue([])

vi.mock('@/features/sync/local-db', () => ({
  db: {
    mediaQueue: {
      add: (...args: unknown[]) => mockAdd(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
      where: vi.fn().mockImplementation(() => ({
        equals: (...args: unknown[]) => mockWhereEquals(...args),
        toArray: (...args: unknown[]) => mockToArray(...args),
      })),
      count: vi.fn().mockResolvedValue(0),
    },
  },
}))

const { enqueueMediaUpload, enqueueMediaMove, enqueueMediaDelete, processMediaQueue } =
  await import(`./offline-media-queue?bypass=${Date.now()}`)

describe('offline-media-queue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWhereEquals.mockReturnValue({ toArray: mockToArray })
  })

  it('enqueues upload tasks as pending', async () => {
    await enqueueMediaUpload({
      filename: 'hero.jpg',
      mimeType: 'image/jpeg',
      contentBase64: 'abc',
      variants: [],
    })

    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'upload',
        status: 'pending',
      })
    )
  })

  it('enqueues move tasks as pending', async () => {
    await enqueueMediaMove({ assetId: 'a1', filename: 'campaign/hero.jpg' })
    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'move',
        status: 'pending',
      })
    )
  })

  it('replays pending tasks and marks them synced', async () => {
    mockToArray.mockResolvedValueOnce([
      { id: 1, type: 'upload', payload: { filename: 'x.jpg' } },
      { id: 2, type: 'move', payload: { assetId: 'a1', filename: 'folder/x.jpg' } },
      { id: 3, type: 'delete', payload: { ids: ['a1', 'a2'] } },
    ])

    await processMediaQueue({
      upload: vi.fn().mockResolvedValue(undefined),
      move: vi.fn().mockResolvedValue(undefined),
      deleteAssets: vi.fn().mockResolvedValue(undefined),
    })

    expect(mockUpdate).toHaveBeenCalledWith(1, expect.objectContaining({ status: 'synced' }))
    expect(mockUpdate).toHaveBeenCalledWith(2, expect.objectContaining({ status: 'synced' }))
    expect(mockUpdate).toHaveBeenCalledWith(3, expect.objectContaining({ status: 'synced' }))
  })

  it('continues processing bulk queue tasks when one task fails', async () => {
    mockToArray.mockResolvedValueOnce([
      { id: 1, type: 'upload', payload: { filename: 'x.jpg' } },
      { id: 2, type: 'move', payload: { assetId: 'a1', filename: 'folder/x.jpg' } },
      { id: 3, type: 'delete', payload: { ids: ['a1', 'a2'] } },
    ])

    const upload = vi.fn().mockResolvedValue(undefined)
    const move = vi.fn().mockRejectedValue(new Error('move failed'))
    const deleteAssets = vi.fn().mockResolvedValue(undefined)

    await expect(processMediaQueue({ upload, move, deleteAssets })).rejects.toThrow('move failed')

    expect(upload).toHaveBeenCalledTimes(1)
    expect(move).toHaveBeenCalledTimes(1)
    expect(deleteAssets).toHaveBeenCalledTimes(1)

    expect(mockUpdate).toHaveBeenCalledWith(1, expect.objectContaining({ status: 'synced' }))
    expect(mockUpdate).toHaveBeenCalledWith(
      2,
      expect.objectContaining({ status: 'pending', error: 'move failed' })
    )
    expect(mockUpdate).toHaveBeenCalledWith(3, expect.objectContaining({ status: 'synced' }))
  })

  it('does not upload duplicate queued payloads more than once during replay', async () => {
    const payload = {
      filename: 'ar-logo.png',
      mimeType: 'image/png',
      contentBase64: 'same-file',
      variants: [],
    }
    mockToArray.mockResolvedValueOnce([
      { id: 1, type: 'upload', payload },
      { id: 2, type: 'upload', payload },
      { id: 3, type: 'upload', payload },
    ])
    const upload = vi.fn().mockResolvedValue(undefined)

    await processMediaQueue({
      upload,
      move: vi.fn().mockResolvedValue(undefined),
      deleteAssets: vi.fn().mockResolvedValue(undefined),
    })

    expect(upload).toHaveBeenCalledTimes(1)
    expect(mockUpdate).toHaveBeenCalledWith(1, expect.objectContaining({ status: 'synced' }))
    expect(mockUpdate).toHaveBeenCalledWith(2, expect.objectContaining({ status: 'synced' }))
    expect(mockUpdate).toHaveBeenCalledWith(3, expect.objectContaining({ status: 'synced' }))
  })

  it('marks permanent upload failures as failed so sync does not retry forever', async () => {
    mockToArray.mockResolvedValueOnce([
      { id: 1, type: 'upload', payload: { filename: 'x.jpg' } },
    ])
    const uploadError = Object.assign(new Error('Asset upload failed'), {
      status: 500,
      code: 'ASSET_UPLOAD_FAILED',
    })

    await expect(
      processMediaQueue({
        upload: vi.fn().mockRejectedValue(uploadError),
        move: vi.fn().mockResolvedValue(undefined),
        deleteAssets: vi.fn().mockResolvedValue(undefined),
      })
    ).rejects.toThrow('Asset upload failed')

    expect(mockUpdate).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ status: 'failed', error: 'Asset upload failed' })
    )
  })

  it('enqueues delete tasks as pending', async () => {
    await enqueueMediaDelete({ ids: ['a1', 'a2'] })
    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'delete',
        status: 'pending',
      })
    )
  })
})
