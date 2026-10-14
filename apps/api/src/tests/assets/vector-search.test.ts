import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import type { Env } from '@/env'
import {
  indexAssetVector,
  removeAssetVectors,
  searchAssetVectorIds,
} from '../../assets/vector-search'

describe('vector-search', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('indexAssetVector', () => {
    it('returns early when ASSET_VECTORS is not configured', async () => {
      const env = {} as Env
      await expect(
        indexAssetVector(env, { id: 'a1', filename: 'images/photo.png', mimeType: 'image/png' })
      ).resolves.toBeUndefined()
    })

    it('returns early when CF credentials are missing', async () => {
      const upsertMock = vi.fn()
      const env = {
        ASSET_VECTORS: { upsert: upsertMock },
      } as unknown as Env

      await expect(
        indexAssetVector(env, { id: 'a1', filename: 'images/photo.png', mimeType: 'image/png' })
      ).resolves.toBeUndefined()
      expect(upsertMock).not.toHaveBeenCalled()
    })

    it('returns early when embedding fetch fails', async () => {
      const upsertMock = vi.fn()
      const env = {
        ASSET_VECTORS: { upsert: upsertMock },
        CF_API_TOKEN: 'cf-token',
        CLOUDFLARE_ACCOUNT_ID: 'cf-account',
      } as unknown as Env

      globalThis.fetch = (vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      } as unknown as Response) as unknown) as typeof fetch

      await indexAssetVector(env, { id: 'a1', filename: 'images/photo.png', mimeType: 'image/png' })
      expect(upsertMock).not.toHaveBeenCalled()
    })

    it('handles various embedding response formats and upserts vector with metadata', async () => {
      const upsertMock = vi.fn().mockResolvedValue({})
      const env = {
        ASSET_VECTORS: { upsert: upsertMock },
        CF_API_TOKEN: 'cf-token',
        CLOUDFLARE_ACCOUNT_ID: 'cf-account',
      } as unknown as Env

      // Nested data embedding format
      globalThis.fetch = (vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          result: {
            data: [[0.1, 0.2, 0.3]],
          },
        }),
      } as unknown as Response) as unknown) as typeof fetch

      await indexAssetVector(
        env,
        { id: 'a1', filename: 'nested/folder/photo.png', mimeType: 'image/png' },
        'tenant-1'
      )

      expect(upsertMock).toHaveBeenCalledTimes(1)
      const [vectors] = upsertMock.mock.calls[0] as [Array<Record<string, unknown>>]
      expect(vectors[0]!.id).toBe('tenant-1:a1')
      expect(vectors[0]!.values).toEqual([0.1, 0.2, 0.3])
      expect(vectors[0]!.metadata).toEqual({
        assetId: 'a1',
        tenantId: 'tenant-1',
        filename: 'nested/folder/photo.png',
        basename: 'photo.png',
        folder: 'nested/folder',
        mimeType: 'image/png',
      })
    })

    it('handles top-level embedding array and single filename without folder', async () => {
      const upsertMock = vi.fn().mockResolvedValue({})
      const env = {
        ASSET_VECTORS: { upsert: upsertMock },
        CF_API_TOKEN: 'cf-token',
        CLOUDFLARE_ACCOUNT_ID: 'cf-account',
      } as unknown as Env

      globalThis.fetch = (vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [0.4, 0.5, 0.6],
      } as unknown as Response) as unknown) as typeof fetch

      await indexAssetVector(
        env,
        { id: 'a2', filename: 'single-file.jpg', mimeType: 'image/jpeg' }
      )

      expect(upsertMock).toHaveBeenCalledTimes(1)
      const [vectors] = upsertMock.mock.calls[0] as [Array<Record<string, unknown>>]
      expect(vectors[0]!.id).toBe('global:a2')
      expect(vectors[0]!.values).toEqual([0.4, 0.5, 0.6])
      expect(vectors[0]!.metadata).toEqual({
        assetId: 'a2',
        tenantId: 'global',
        filename: 'single-file.jpg',
        basename: 'single-file.jpg',
        folder: '',
        mimeType: 'image/jpeg',
      })
    })

    it('does not upsert if payload yields no numeric embeddings', async () => {
      const upsertMock = vi.fn()
      const env = {
        ASSET_VECTORS: { upsert: upsertMock },
        CF_API_TOKEN: 'cf-token',
        CLOUDFLARE_ACCOUNT_ID: 'cf-account',
      } as unknown as Env

      globalThis.fetch = (vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ invalid: 'no numbers' }),
      } as unknown as Response) as unknown) as typeof fetch

      await indexAssetVector(env, { id: 'a3', filename: 'test.pdf', mimeType: 'application/pdf' })
      expect(upsertMock).not.toHaveBeenCalled()

      // Array with non-numbers
      globalThis.fetch = (vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ result: { data: ['not-numbers'] } }),
      } as unknown as Response) as unknown) as typeof fetch

      await indexAssetVector(env, { id: 'a4', filename: 'test.pdf', mimeType: 'application/pdf' })
      expect(upsertMock).not.toHaveBeenCalled()

      // Nested array with non-numbers
      globalThis.fetch = (vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ result: { data: [['not-numbers-in-matrix']] } }),
      } as unknown as Response) as unknown) as typeof fetch

      await indexAssetVector(env, { id: 'a5', filename: 'test.pdf', mimeType: 'application/pdf' })
      expect(upsertMock).not.toHaveBeenCalled()
    })
  })

  describe('removeAssetVectors', () => {
    it('returns early when ASSET_VECTORS is missing or assetIds is empty', async () => {
      const env = {} as Env
      await expect(removeAssetVectors(env, ['a1'])).resolves.toBeUndefined()

      const deleteByIdsMock = vi.fn()
      const envWithVectors = {
        ASSET_VECTORS: { deleteByIds: deleteByIdsMock },
      } as unknown as Env
      await expect(removeAssetVectors(envWithVectors, [])).resolves.toBeUndefined()
      expect(deleteByIdsMock).not.toHaveBeenCalled()
    })

    it('deletes vectors with scoped IDs', async () => {
      const deleteByIdsMock = vi.fn().mockResolvedValue({})
      const env = {
        ASSET_VECTORS: { deleteByIds: deleteByIdsMock },
      } as unknown as Env

      await removeAssetVectors(env, ['a1', 'a2'], 'tenant-xyz')
      expect(deleteByIdsMock).toHaveBeenCalledWith(['tenant-xyz:a1', 'tenant-xyz:a2'])

      await removeAssetVectors(env, ['a3'])
      expect(deleteByIdsMock).toHaveBeenCalledWith(['global:a3'])
    })
  })

  describe('searchAssetVectorIds', () => {
    it('returns empty array when ASSET_VECTORS is missing', async () => {
      const env = {} as Env
      const matches = await searchAssetVectorIds(env, { query: 'logo', topK: 5 })
      expect(matches).toEqual([])
    })

    it('returns empty array when embedding generation fails', async () => {
      const queryMock = vi.fn()
      const env = {
        ASSET_VECTORS: { query: queryMock },
        CF_API_TOKEN: 'cf-token',
        CLOUDFLARE_ACCOUNT_ID: 'cf-account',
      } as unknown as Env

      globalThis.fetch = (vi.fn().mockResolvedValue({
        ok: false,
      } as unknown as Response) as unknown) as typeof fetch

      const matches = await searchAssetVectorIds(env, { query: 'logo', topK: 5 })
      expect(matches).toEqual([])
      expect(queryMock).not.toHaveBeenCalled()
    })

    it('queries index and returns matching ids and scores', async () => {
      const queryMock = vi.fn().mockResolvedValue({
        matches: [
          { id: 'tenant-1:a1', score: 0.95 },
          { id: 'tenant-1:a2', score: 0.82 },
          { id: 123 as unknown as string, score: 0.5 },
        ],
      })
      const env = {
        ASSET_VECTORS: { query: queryMock },
        CF_API_TOKEN: 'cf-token',
        CLOUDFLARE_ACCOUNT_ID: 'cf-account',
      } as unknown as Env

      globalThis.fetch = (vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          result: {
            embedding: [0.1, 0.2, 0.3],
          },
        }),
      } as unknown as Response) as unknown) as typeof fetch

      const matches = await searchAssetVectorIds(
        env,
        { query: 'brand logo', topK: 2 },
        'tenant-1'
      )

      expect(queryMock).toHaveBeenCalledWith([0.1, 0.2, 0.3], {
        topK: 2,
        returnMetadata: false,
        filter: { tenantId: 'tenant-1' },
      })
      expect(matches).toEqual([
        { id: 'tenant-1:a1', score: 0.95 },
        { id: 'tenant-1:a2', score: 0.82 },
      ])
    })

    it('falls back to empty array if query returns undefined matches', async () => {
      const queryMock = vi.fn().mockResolvedValue({})
      const env = {
        ASSET_VECTORS: { query: queryMock },
        CF_API_TOKEN: 'cf-token',
        CLOUDFLARE_ACCOUNT_ID: 'cf-account',
      } as unknown as Env

      globalThis.fetch = (vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          result: [[0.7, 0.8]],
        }),
      } as unknown as Response) as unknown) as typeof fetch

      const matches = await searchAssetVectorIds(env, { query: 'query', topK: 1 })
      expect(matches).toEqual([])
      expect(queryMock).toHaveBeenCalledWith([0.7, 0.8], {
        topK: 1,
        returnMetadata: false,
        filter: { tenantId: 'global' },
      })
    })

    it('falls back to empty array when embedding network fetch rejects', async () => {
      const queryMock = vi.fn()
      const env = {
        ASSET_VECTORS: { query: queryMock },
        CF_API_TOKEN: 'cf-token',
        CLOUDFLARE_ACCOUNT_ID: 'cf-account',
      } as unknown as Env

      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection timed out')) as unknown as typeof fetch

      const matches = await searchAssetVectorIds(env, { query: 'fail', topK: 5 })
      expect(matches).toEqual([])
      expect(queryMock).not.toHaveBeenCalled()
    })

    it('falls back to empty array when Vectorize index.query throws an error', async () => {
      const queryMock = vi.fn().mockRejectedValue(new Error('Vectorize service unavailable'))
      const env = {
        ASSET_VECTORS: { query: queryMock },
        CF_API_TOKEN: 'cf-token',
        CLOUDFLARE_ACCOUNT_ID: 'cf-account',
      } as unknown as Env

      globalThis.fetch = (vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          result: { data: [[0.1, 0.2]] },
        }),
      } as unknown as Response) as unknown) as typeof fetch

      const matches = await searchAssetVectorIds(env, { query: 'query', topK: 5 })
      expect(matches).toEqual([])
      expect(queryMock).toHaveBeenCalled()
    })

    it('filters out malformed or non-string match IDs', async () => {
      const queryMock = vi.fn().mockResolvedValue({
        matches: [
          { id: 'global:valid-1', score: 0.99 },
          { id: null, score: 0.5 },
          { id: undefined, score: 0.4 },
          { id: 999, score: 0.3 },
          { notAnId: 'ignored' },
        ],
      })
      const env = {
        ASSET_VECTORS: { query: queryMock },
        CF_API_TOKEN: 'cf-token',
        CLOUDFLARE_ACCOUNT_ID: 'cf-account',
      } as unknown as Env

      globalThis.fetch = (vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          result: { data: [[0.1, 0.2]] },
        }),
      } as unknown as Response) as unknown) as typeof fetch

      const matches = await searchAssetVectorIds(env, { query: 'query', topK: 5 })
      expect(matches).toEqual([{ id: 'global:valid-1', score: 0.99 }])
    })
  })
})
