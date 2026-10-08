import { describe, expect, it, vi } from 'bun:test'
import type { Database } from '@/database/db'

const { entriesRepository } = await import(`../../entries/entries.repository?bypass=${Date.now()}`)
const { collectionsRepository } = await import(
  `../../collections/collections.repository?bypass=${Date.now()}`
)
const { assetsRepository } = await import(`../../assets/assets.repository?bypass=${Date.now()}`)

function createSelectOnlyDb(selectResult: unknown[] = []) {
  const chainBase = {
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    all: vi.fn().mockResolvedValue(selectResult),
  }
  const chain = Object.assign(Promise.resolve(selectResult), chainBase)
  return {
    select: vi.fn().mockReturnValue(chain),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    chainBase,
  }
}

describe('tenant repository isolation', () => {
  it('prevents cross-tenant reads for entries by forcing tenant join checks', async () => {
    const { select, chainBase } = createSelectOnlyDb([])
    const db = { select } as unknown as Database

    const entry = await entriesRepository.findById(db, 'entry-1')

    expect(entry).toBeUndefined()
    expect(chainBase.innerJoin).toHaveBeenCalledTimes(1)
    expect(chainBase.where).toHaveBeenCalledTimes(1)
  })

  it('defaults collection queries to global tenant scope', async () => {
    const { select, chainBase } = createSelectOnlyDb([])
    const db = { select } as unknown as Database

    await collectionsRepository.findAll(db)

    expect(chainBase.where).toHaveBeenCalledTimes(1)
  })

  it('defaults asset writes to global tenant scope when omitted', async () => {
    const values = vi.fn().mockReturnThis()
    const returning = vi.fn().mockResolvedValue([
      {
        id: 'asset-1',
        tenantId: 'global',
      },
    ])
    const db = {
      insert: vi.fn().mockReturnValue({ values, returning }),
    } as unknown as Database

    await assetsRepository.createAsset(db, {
      id: 'asset-1',
      filename: 'hero.png',
      mimeType: 'image/png',
      size: 128,
      originalKey: 'media/hero.png',
      createdAt: '2026-02-17T00:00:00.000Z',
      updatedAt: '2026-02-17T00:00:00.000Z',
    })

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'global',
      })
    )
  })
})
