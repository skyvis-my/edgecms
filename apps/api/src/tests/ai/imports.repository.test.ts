import { beforeEach, describe, expect, it, vi } from 'bun:test'
import type { Database } from '@/database/db'
// Cache-busted import (dynamic so TS skips resolution): imports.service.test
// partial-mocks this module, and a plain import would reuse that mock copy.
const { aiImportsRepository } = await import(
  `../../ai/imports.repository?unmocked=${Date.now()}`
)

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

describe('aiImportsRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('createBatch inserts and returns batch or throws if empty', async () => {
    const batch = {
      id: 'b1',
      tenantId: 'tenant-1',
      createdByUserId: 'u1',
      status: 'draft' as const,
      intent: 'test',
      sourceCount: 0,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    }
    const dbSuccess = createChainableDb({ returningResult: [batch] })

    const result = await aiImportsRepository.createBatch(dbSuccess as unknown as Database, {
      id: 'b1',
      createdByUserId: 'u1',
      status: 'draft',
      intent: 'test',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
      tenantId: 'tenant-1',
    })
    expect(result).toEqual(batch as unknown as typeof result)

    const dbFail = createChainableDb({ returningResult: [] })
    await expect(
      aiImportsRepository.createBatch(dbFail as unknown as Database, {
        id: 'b2',
        createdByUserId: 'u1',
        status: 'draft',
        intent: 'test',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      })
    ).rejects.toThrow('Failed to create AI import batch')
  })

  it('findBatch and updateBatch query and update with tenant scoping', async () => {
    const batch = { id: 'b1', tenantId: 'global', status: 'ready_for_review' as const }
    const db = createChainableDb({
      selectResults: [[batch]],
      returningResult: [batch],
    })

    const found = await aiImportsRepository.findBatch(db as unknown as Database, 'b1')
    expect(found).toEqual(batch as unknown as typeof found)

    const updated = await aiImportsRepository.updateBatch(db as unknown as Database, 'b1', undefined, {
      status: 'ready_for_review',
    })
    expect(updated).toEqual(batch as unknown as typeof updated)
  })

  it('creates and lists sources, incrementing batch source count', async () => {
    const source = {
      id: 's1',
      batchId: 'b1',
      kind: 'file' as const,
      expiresAt: '2026-02-01',
      createdAt: '2026-01-01',
      tenantId: 'tenant-1',
    }
    const db = createChainableDb({
      returningResult: [source],
      selectResults: [[source]],
    })

    const created = await aiImportsRepository.createSource(db as unknown as Database, {
      id: 's1',
      batchId: 'b1',
      kind: 'file',
      expiresAt: '2026-02-01',
      createdAt: '2026-01-01',
      tenantId: 'tenant-1',
    })
    expect(created).toEqual(source as unknown as typeof created)

    const list = await aiImportsRepository.listSources(db as unknown as Database, 'b1', 'tenant-1')
    expect(list).toEqual([source] as unknown as typeof list)
  })

  it('createSource throws if returning is empty', async () => {
    const db = createChainableDb({ returningResult: [] })
    await expect(
      aiImportsRepository.createSource(db as unknown as Database, {
        id: 's2',
        batchId: 'b1',
        kind: 'text',
        expiresAt: '2026-02-01',
        createdAt: '2026-01-01',
      })
    ).rejects.toThrow('Failed to create AI import source')
  })

  it('manages suggestion sets', async () => {
    const set = {
      id: 'set-1',
      batchId: 'b1',
      tenantId: 'tenant-1',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    }
    const db = createChainableDb({
      returningResult: [set],
      selectResults: [[set], [set]],
    })

    const created = await aiImportsRepository.createSuggestionSet(db as unknown as Database, {
      id: 'set-1',
      batchId: 'b1',
      tenantId: 'tenant-1',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    })
    expect(created).toEqual(set as unknown as typeof created)

    const latest = await aiImportsRepository.latestSuggestionSet(db as unknown as Database, 'b1', 'tenant-1')
    expect(latest).toEqual(set as unknown as typeof latest)

    const found = await aiImportsRepository.findSuggestionSet(db as unknown as Database, 'set-1', 'tenant-1')
    expect(found).toEqual(set as unknown as typeof found)

    const updated = await aiImportsRepository.updateSuggestionSet(db as unknown as Database, 'set-1', 'tenant-1', {
      status: 'ready',
    })
    expect(updated).toEqual(set as unknown as typeof updated)
  })

  it('createSuggestionSet throws if returning is empty', async () => {
    const db = createChainableDb({ returningResult: [] })
    await expect(
      aiImportsRepository.createSuggestionSet(db as unknown as Database, {
        id: 'set-2',
        batchId: 'b1',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      })
    ).rejects.toThrow('Failed to create AI suggestion set')
  })

  it('manages suggestions with pagination, filters, and batch creation', async () => {
    const db = createChainableDb({
      returningResult: [{ id: 'sug-1' }],
      selectResults: [[{ count: 1 }], [{ id: 'sug-1' }], [{ id: 'sug-1' }]],
    })

    const empty = await aiImportsRepository.createSuggestions(db as unknown as Database, [])
    expect(empty).toEqual([])

    const created = await aiImportsRepository.createSuggestions(db as unknown as Database, [
      {
        id: 'sug-1',
        suggestionSetId: 'set-1',
        operation: 'create_entry',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
    ])
    expect(created).toHaveLength(1)

    const listed = await aiImportsRepository.listSuggestions(db as unknown as Database, 'set-1', 'global', {
      page: 1,
      perPage: 10,
      status: 'pending',
    })
    expect(listed.total).toBe(1)
    expect(listed.rows).toHaveLength(1)

    const found = await aiImportsRepository.findSuggestion(db as unknown as Database, 'sug-1')
    expect(found).toBeDefined()

    const updated = await aiImportsRepository.updateSuggestion(db as unknown as Database, 'sug-1', undefined, {
      status: 'accepted',
    })
    expect(updated).toBeDefined()
  })

  it('inserts tool invocation', async () => {
    const db = createChainableDb({})
    await expect(
      aiImportsRepository.insertToolInvocation(db as unknown as Database, {
        id: 'inv-1',
        toolName: 'parse_wxr',
        status: 'success',
        createdAt: '2026-01-01',
      })
    ).resolves.toBeUndefined()
  })
})
