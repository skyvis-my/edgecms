import { beforeEach, describe, expect, it, vi } from 'bun:test'
import type { Database } from '@/database/db'
import type { Env } from '@/env'
import {
  extractTextFromContent,
  getEmbedding,
  ragService,
} from '@/ai/rag.service'
import { entriesRepository } from '@/entries/entries.repository'
import { collectionsRepository } from '@/collections/collections.repository'

vi.mock('@/entries/entries.repository', () => ({
  entriesRepository: {
    findById: vi.fn(),
    findAll: vi.fn(),
  },
}))

vi.mock('@/collections/collections.repository', () => ({
  collectionsRepository: {
    findById: vi.fn(),
    findBySlug: vi.fn(),
  },
}))

describe('Vectorize Content RAG Pipeline (C-18)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('extractTextFromContent', () => {
    it('extracts plain string and strips HTML tags', () => {
      const text = extractTextFromContent('<p>Hello <strong>World</strong>!</p>')
      expect(text).toBe('Hello World !')
    })

    it('extracts primitives and arrays', () => {
      expect(extractTextFromContent(42)).toBe('42')
      expect(extractTextFromContent(true)).toBe('true')
      expect(extractTextFromContent(['apple', 'banana'])).toBe('apple banana')
    })

    it('recursively parses TipTap / ProseMirror AST document structures', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'First paragraph with ' },
              { type: 'text', text: 'bold content.' },
            ],
          },
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: 'Section Title' }],
          },
        ],
      }
      const extracted = extractTextFromContent(doc)
      expect(extracted).toContain('First paragraph with')
      expect(extracted).toContain('bold content.')
      expect(extracted).toContain('Section Title')
    })

    it('handles empty or nullish values safely', () => {
      expect(extractTextFromContent(null)).toBe('')
      expect(extractTextFromContent(undefined)).toBe('')
      expect(extractTextFromContent({})).toBe('')
    })
  })

  describe('getEmbedding', () => {
    it('produces deterministic 768-dimensional normalized embeddings for fallback', async () => {
      const vector = await getEmbedding(undefined, 'EdgeCMS Cloudflare Workers')
      expect(vector).toHaveLength(768)
      // Magnitude check
      const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0))
      expect(magnitude).toBeGreaterThan(0.99)
      expect(magnitude).toBeLessThan(1.01)

      // Deterministic identical text produces identical embedding
      const vector2 = await getEmbedding(undefined, 'EdgeCMS Cloudflare Workers')
      expect(vector).toEqual(vector2)
    })
  })

  describe('indexPublishedEntry', () => {
    const mockDb = {} as Database

    it('skips non-existent or draft entries', async () => {
      ;(entriesRepository.findById as any).mockResolvedValueOnce(null)
      const res1 = await ragService.indexPublishedEntry(mockDb, undefined, 'entry-none')
      expect(res1).toBe(false)

      ;(entriesRepository.findById as any).mockResolvedValueOnce({
        id: 'entry-draft',
        status: 'draft',
      })
      const res2 = await ragService.indexPublishedEntry(mockDb, undefined, 'entry-draft')
      expect(res2).toBe(false)
    })

    it('indexes published entry into Vectorize binding when provided', async () => {
      ;(entriesRepository.findById as any).mockResolvedValueOnce({
        id: 'entry-published',
        collectionId: 'articles',
        status: 'published',
        data: {
          title: 'Building Edge CMS',
          body: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Deep dive into D1 and KV' }] }],
          },
        },
      })
      ;(collectionsRepository.findById as any).mockResolvedValueOnce({
        id: 'articles',
        slug: 'articles',
      })

      const mockUpsert = vi.fn().mockResolvedValue({})
      const mockEnv = {
        ASSET_VECTORS: {
          upsert: mockUpsert,
        },
      } as unknown as Env

      const indexed = await ragService.indexPublishedEntry(mockDb, mockEnv, 'entry-published', 'tenant-1')
      expect(indexed).toBe(true)
      expect(mockUpsert).toHaveBeenCalledTimes(1)
      const upsertArgs = mockUpsert.mock.calls[0]![0]
      expect(upsertArgs[0]!.id).toBe('content:tenant-1:entry-published')
      expect(upsertArgs[0]!.metadata.title).toBe('Building Edge CMS')
      expect(upsertArgs[0]!.metadata.collectionSlug).toBe('articles')
    })
  })

  describe('searchRag', () => {
    const mockDb = {} as Database

    it('returns empty array on empty query', async () => {
      const results = await ragService.searchRag({
        db: mockDb,
        env: undefined,
        query: '   ',
      })
      expect(results).toEqual([])
    })

    it('queries Vectorize binding directly when configured', async () => {
      const mockQuery = vi.fn().mockResolvedValue({
        matches: [
          {
            id: 'content:tenant-1:post-1',
            score: 0.9542,
            metadata: {
              entryId: 'post-1',
              collectionSlug: 'posts',
              title: 'Vectorize Search',
              snippet: 'Semantic retrieval on Cloudflare Workers',
            },
          },
        ],
      })

      const mockEnv = {
        ASSET_VECTORS: {
          query: mockQuery,
        },
      } as unknown as Env

      const results = await ragService.searchRag({
        db: mockDb,
        env: mockEnv,
        query: 'semantic vector search',
        tenantId: 'tenant-1',
        limit: 5,
      })

      expect(results).toHaveLength(1)
      expect(results[0]?.entryId).toBe('post-1')
      expect(results[0]?.score).toBe(0.9542)
    })

    it('falls back to database cosine similarity ranking when Vectorize is absent', async () => {
      ;(entriesRepository.findAll as any).mockResolvedValue({
        rows: [
          {
            id: 'post-alpha',
            status: 'published',
            data: {
              title: 'Cloudflare Edge Performance',
              body: 'Running edge functions with sub-millisecond cold starts.',
            },
          },
          {
            id: 'post-beta',
            status: 'published',
            data: {
              title: 'Baking Sourdough Bread',
              body: 'Flour, water, salt, and wild yeast fermentation.',
            },
          },
        ],
      })

      const results = await ragService.searchRag({
        db: mockDb,
        env: undefined,
        query: 'edge performance and latency',
        limit: 2,
      })

      expect(results).toHaveLength(2)
      expect(results[0]?.score).toBeGreaterThan(0)
      expect(results[1]?.score).toBeGreaterThan(0)
      expect(results[0]?.score).toBeGreaterThanOrEqual(results[1]?.score ?? 0)
      expect(results.some((r) => r.entryId === 'post-alpha')).toBe(true)
      expect(results.some((r) => r.entryId === 'post-beta')).toBe(true)
    })

    it('filters database search by collectionSlug and resolves collectionSlug on results', async () => {
      ;(collectionsRepository.findBySlug as any).mockResolvedValue({
        id: 'col-tech',
        slug: 'tech',
      })
      ;(entriesRepository.findAll as any).mockResolvedValue({
        rows: [
          {
            id: 'post-1',
            collectionId: 'col-tech',
            status: 'published',
            data: { title: 'Edge Cloud', body: 'Edge computing is fast.' },
          },
        ],
      })

      const results = await ragService.searchRag({
        db: mockDb,
        env: undefined,
        query: 'edge computing',
        collectionSlug: 'tech',
      })

      expect(results).toHaveLength(1)
      expect(results[0]?.collectionSlug).toBe('tech')
      expect(entriesRepository.findAll).toHaveBeenCalledWith(
        mockDb,
        expect.objectContaining({ collectionId: 'col-tech' })
      )
    })
  })
})
