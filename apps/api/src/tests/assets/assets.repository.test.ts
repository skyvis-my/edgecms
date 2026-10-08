import { beforeEach, describe, expect, it, vi } from 'bun:test'
import type { Database } from '@/database/db'

const { assetsRepository } = await import(`../../assets/assets.repository?bypass=${Date.now()}`)

describe('assetsRepository', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates and fetches assets/variants', async () => {
    const asset = { id: 'a1', filename: 'x.png' }
    const variant = { id: 'v1', assetId: 'a1', variant: 'md', format: 'webp' }
    const db = createChainableDb({
      returningResult: [asset],
      selectResults: [[asset], [variant], [asset], [variant], [asset], [variant], [asset]],
    })

    const created = await assetsRepository.createAsset(db as unknown as Database, {
      id: 'a1',
      filename: 'x.png',
      mimeType: 'image/png',
      size: 1,
      originalKey: 'k',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    expect(created).toEqual(asset)

    await assetsRepository.createVariants(db as unknown as Database, [
      {
        id: 'v1',
        assetId: 'a1',
        variant: 'md',
        format: 'webp',
        objectKey: 'k',
        width: null,
        height: null,
        createdAt: new Date().toISOString(),
      },
    ])

    const byId = await assetsRepository.findById(db as unknown as Database, 'a1')
    expect(byId).toBeDefined()

    const matchedVariant = await assetsRepository.findVariant(
      db as unknown as Database,
      'a1',
      'md',
      'webp'
    )
    expect(matchedVariant).toEqual(variant)

    const updated = await assetsRepository.updateFilename(
      db as unknown as Database,
      'a1',
      'folder/x.png'
    )
    expect(updated).toBeDefined()

    const deletedIds = await assetsRepository.deleteByIds(db as unknown as Database, ['a1'])
    expect(deletedIds).toEqual(['a1'])
  })

  it('softDeleteByIds marks assets deleted and returns affected ids', async () => {
    const db = createChainableDb({
      selectResults: [[{ id: 'a1' }]],
    })

    const deletedIds = await assetsRepository.softDeleteByIds(db as unknown as Database, ['a1'])

    expect(deletedIds).toEqual(['a1'])
    expect((db.update as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0)
  })

  it('findById returns undefined for filtered rows (e.g. soft-deleted assets)', async () => {
    const db = createChainableDb({
      selectResults: [[]],
    })

    const result = await assetsRepository.findById(db as unknown as Database, 'soft-deleted')
    expect(result).toBeUndefined()
  })

  it('persists blurhash and dimensions on assets', async () => {
    const now = new Date().toISOString()
    const createdRows = [
      {
        id: 'a1',
        tenantId: 'global',
        filename: 'a.jpg',
        mimeType: 'image/jpeg',
        size: 123,
        originalKey: 'k',
        width: 640,
        height: 480,
        blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
        createdAt: now,
        updatedAt: now,
      },
    ]
    const db = createChainableDb({
      returningResult: createdRows,
    })

    const created = await assetsRepository.createAsset(db as unknown as Database, createdRows[0]!)
    expect(created.blurhash).toBeTruthy()
    expect(created.width).toBe(640)
    expect(created.height).toBe(480)
  })
})

function createChainableDb(opts: { selectResults?: unknown[][]; returningResult?: unknown[] }) {
  const selectResults = opts.selectResults ?? [[]]
  const returningResult = opts.returningResult ?? []
  let selectCallIndex = 0

  const makeSelectChain = () => {
    const currentResult = selectResults[selectCallIndex] ?? []
    selectCallIndex++

    const chainBase = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      all: vi.fn().mockResolvedValue(currentResult),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn().mockReturnThis(),
    }
    return Object.assign(Promise.resolve(currentResult), chainBase)
  }

  const returningPromise = Object.assign(Promise.resolve(returningResult), {})
  const mutationChain = {
    values: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnValue(returningPromise),
  }

  return {
    select: vi.fn().mockImplementation(() => makeSelectChain()),
    insert: vi.fn().mockReturnValue(mutationChain),
    update: vi.fn().mockReturnValue(mutationChain),
    delete: vi.fn().mockReturnValue(mutationChain),
  }
}
