import { describe, expect, it, vi } from 'bun:test'
import type { Database } from '@/database/db'

const { webhooksRepository } = await import(
  `../../webhooks/webhooks.repository?bypass=${Date.now()}`
)

describe('webhooksRepository', () => {
  it('covers webhook CRUD methods', async () => {
    const webhook = {
      id: 'w1',
      tenantId: 'global',
      url: 'https://example.com',
      events: ['entry.created'],
      secret: 's1',
      headers: null,
      enabled: true,
      retryMaxRetries: 5,
      retryBackoff: 'exponential',
      retryTimeout: 30,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    }

    const db = createDbMock({
      selectResults: [[webhook], [webhook], [webhook], [webhook], [{ id: 'd1' }], [{ id: 'd1' }]],
      returningResults: [[webhook], [webhook], [{ id: 'w1' }], [{ id: 'd1' }], [{ id: 'd1' }]],
    })

    expect(await webhooksRepository.findAll(db as unknown as Database)).toEqual([webhook])
    expect(await webhooksRepository.findById(db as unknown as Database, 'w1')).toEqual(webhook)
    expect(await webhooksRepository.create(db as unknown as Database, webhook)).toEqual(webhook)
    expect(
      await webhooksRepository.update(db as unknown as Database, 'w1', { enabled: false })
    ).toEqual(webhook)
    expect(await webhooksRepository.deleteById(db as unknown as Database, 'w1')).toBe(true)
    expect(
      await webhooksRepository.findDeliveries(db as unknown as Database, 'w1', {
        limit: 10,
        offset: 5,
      })
    ).toEqual([{ id: 'd1' }])
    expect(
      await webhooksRepository.createDelivery(db as unknown as Database, {
        id: 'd1',
        webhookId: 'w1',
        event: 'entry.created',
        payload: {},
        statusCode: null,
        responseBody: null,
        success: false,
        attempt: 1,
        durationMs: null,
        error: null,
        createdAt: '2024-01-01T00:00:00.000Z',
      })
    ).toEqual({ id: 'd1' })
    expect(
      await webhooksRepository.updateDelivery(db as unknown as Database, 'd1', {
        success: true,
        statusCode: 200,
      })
    ).toEqual({ id: 'd1' })
  })

  it('returns undefined/false for missing records and uses delivery defaults', async () => {
    const db = createDbMock({
      selectResults: [[], []],
      returningResults: [[], [], []],
    })

    expect(await webhooksRepository.findById(db as unknown as Database, 'missing')).toBeUndefined()
    expect(
      await webhooksRepository.update(db as unknown as Database, 'missing', { enabled: false })
    ).toBe(undefined)
    expect(await webhooksRepository.deleteById(db as unknown as Database, 'missing')).toBe(false)
    expect(
      await webhooksRepository.updateDelivery(db as unknown as Database, 'missing', {})
    ).toBeUndefined()
    expect(await webhooksRepository.findDeliveries(db as unknown as Database, 'missing')).toEqual(
      []
    )
  })
})

function createDbMock(opts: { selectResults: unknown[][]; returningResults: unknown[][] }) {
  let selectIndex = 0
  let returningIndex = 0

  const select = vi.fn().mockImplementation(() => {
    const result = opts.selectResults[selectIndex] ?? []
    selectIndex++

    const chain = {
      where: vi.fn(),
      orderBy: vi.fn(),
      limit: vi.fn(),
      offset: vi.fn(),
      all: vi.fn().mockResolvedValue(result),
    }
    chain.where.mockImplementation(() => chain)
    chain.orderBy.mockImplementation(() => chain)
    chain.limit.mockImplementation(() => chain)
    chain.offset.mockImplementation(() => chain)

    return {
      from: vi.fn().mockReturnValue(chain),
    }
  })

  const mutationChain = {
    values: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockImplementation(() => {
      const result = opts.returningResults[returningIndex] ?? []
      returningIndex++
      return Promise.resolve(result)
    }),
  }

  return {
    select,
    insert: vi.fn().mockReturnValue(mutationChain),
    update: vi.fn().mockReturnValue(mutationChain),
    delete: vi.fn().mockReturnValue(mutationChain),
  }
}
