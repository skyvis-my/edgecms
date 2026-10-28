import { describe, expect, it } from 'bun:test'
import { computeReciprocalRankFusion, getEmbedding } from '../../ai/rag.service'
import { ftsService } from '../../search/fts.service'

describe('Domain 2: Edge-Native Search & Reciprocal Rank Fusion (RRF)', () => {
  it('blends lexical and vector results using Reciprocal Rank Fusion', () => {
    const lexicalResults = [
      { entryId: 'e1', title: 'Workers AI Guide' },
      { entryId: 'e2', title: 'Edge Computing Overview' },
    ]
    const vectorResults = [
      { entryId: 'e2', title: 'Edge Computing Overview' },
      { entryId: 'e3', title: 'Cloudflare D1 Database' },
    ]

    const blended = computeReciprocalRankFusion(lexicalResults, vectorResults, 60)

    // e2 appears in both lexical (#2) and vector (#1), so its blended score should be highest!
    expect(blended[0]?.entryId).toBe('e2')
    expect(blended[0]?.rrfScore).toBeGreaterThan(blended[1]?.rrfScore ?? 0)
    expect(blended).toHaveLength(3)
  })

  it('uses native hypervisor env.AI when available', async () => {
    const mockEmbedding = [0.123, 0.456, 0.789]
    const mockEnv = {
      AI: {
        run: async (_model: string, _args: unknown) => ({
          data: [mockEmbedding],
        }),
      },
    }

    const vec = await getEmbedding(mockEnv as any, 'test query')
    expect(vec).toEqual(mockEmbedding)
  })

  it('ftsService formats query string safely and handles empty query', async () => {
    const mockDb = {
      run: async () => undefined,
      all: async () => [],
    } as any

    const results = await ftsService.search(mockDb, '   ')
    expect(results).toEqual([])
  })
})
