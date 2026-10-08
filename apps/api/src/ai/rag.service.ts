import type { Database } from '@/database/db'
import type { Env } from '@/env'
import { entriesRepository } from '@/entries/entries.repository'
import { collectionsRepository } from '@/collections/collections.repository'
import { logger } from '@/observability/logger'

const EMBEDDING_MODEL = '@cf/baai/bge-base-en-v1.5'
const EMBEDDING_DIMENSION = 768

export type RagSearchResult = {
  entryId: string
  collectionSlug: string
  title: string
  snippet: string
  score: number
}

/**
 * Recursively extracts plain text from entry data values, including
 * TipTap / ProseMirror JSON AST and nested fields.
 */
export function extractTextFromContent(value: unknown): string {
  if (!value) return ''
  if (typeof value === 'string') {
    // Strip simple HTML tags if string contains HTML
    return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (Array.isArray(value)) {
    return value.map(extractTextFromContent).filter(Boolean).join(' ')
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    // TipTap / ProseMirror node
    if (obj.text && typeof obj.text === 'string') {
      return obj.text
    }
    if (Array.isArray(obj.content)) {
      return obj.content.map(extractTextFromContent).filter(Boolean).join(' ')
    }
    return Object.values(obj).map(extractTextFromContent).filter(Boolean).join(' ')
  }
  return ''
}

/**
 * Builds a deterministic mock embedding for tests / environments without Workers AI.
 */
function createDeterministicEmbedding(text: string): number[] {
  const vector = Array.from({ length: EMBEDDING_DIMENSION }, () => 0)
  for (let i = 0; i < text.length; i++) {
    const charCode = text.charCodeAt(i)
    const idx = (charCode * 31 + i) % EMBEDDING_DIMENSION
    vector[idx] = ((vector[idx] ?? 0) + (charCode / 255)) % 1
  }
  // Normalize vector
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0)) || 1
  return vector.map((val) => Number((val / magnitude).toFixed(6)))
}

/**
 * Computes cosine similarity between two numeric vectors.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dotProduct = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    const valA = a[i] ?? 0
    const valB = b[i] ?? 0
    dotProduct += valA * valB
    normA += valA * valA
    normB += valB * valB
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dotProduct / denom
}

/**
 * Computes embedding for text using Cloudflare Workers AI or deterministic fallback.
 */
export async function getEmbedding(env: Env | undefined, text: string): Promise<number[]> {
  if (env?.CF_API_TOKEN && env?.CLOUDFLARE_ACCOUNT_ID) {
    try {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/run/${EMBEDDING_MODEL}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.CF_API_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ text: [text.slice(0, 2048)] }),
        }
      )
      if (response.ok) {
        const payload = (await response.json()) as { result?: { data?: number[][] } }
        const vec = payload?.result?.data?.[0]
        if (Array.isArray(vec) && vec.length > 0) {
          return vec
        }
      }
    } catch {
      // Fall through to deterministic fallback
    }
  }

  return createDeterministicEmbedding(text)
}

export const ragService = {
  /**
   * Indexes a published entry's content into Vectorize for semantic retrieval.
   */
  async indexPublishedEntry(
    db: Database,
    env: Env | undefined,
    entryId: string,
    tenantId?: string
  ): Promise<boolean> {
    try {
      const entry = await entriesRepository.findById(db, entryId, tenantId)
      if (!entry || entry.status !== 'published') {
        return false
      }

      const collection = await collectionsRepository.findById(db, entry.collectionId, tenantId)
      const collectionSlug = collection?.slug ?? entry.collectionId

      const entryData = (entry.data ?? {}) as Record<string, unknown>
      const title = String(entryData.title || entryData.name || entry.slug || entry.id)
      const fullText = `${title} ${extractTextFromContent(entryData)}`.trim()

      if (!fullText) return false

      const vector = await getEmbedding(env, fullText)
      const vectorId = `content:${tenantId ?? 'global'}:${entryId}`

      // If Vectorize binding is available, upsert vector with metadata
      const vectorize = env?.ASSET_VECTORS as unknown as {
        upsert?: (vectors: Array<{ id: string; values: number[]; metadata?: Record<string, unknown> }>) => Promise<unknown>
      } | undefined

      if (vectorize && typeof vectorize.upsert === 'function') {
        await vectorize.upsert([
          {
            id: vectorId,
            values: vector,
            metadata: {
              entryId,
              collectionSlug,
              title: title.slice(0, 100),
              snippet: fullText.slice(0, 300),
              tenantId: tenantId ?? 'global',
            },
          },
        ])
      }

      return true
    } catch (err) {
      logger.warn('rag_indexing_failed', {
        entryId,
        error: err instanceof Error ? err.message : String(err),
      })
      return false
    }
  },

  /**
   * Searches content semantically across published entries using natural language queries.
   */
  async searchRag(params: {
    db: Database
    env: Env | undefined
    query: string
    tenantId?: string
    collectionSlug?: string
    limit?: number
  }): Promise<RagSearchResult[]> {
    const { db, env, query, tenantId, collectionSlug, limit = 5 } = params
    const cleanQuery = query.trim()
    if (!cleanQuery) return []

    const queryVector = await getEmbedding(env, cleanQuery)

    // 1. If Vectorize binding is available, perform vector similarity search
    const vectorize = env?.ASSET_VECTORS as unknown as {
      query?: (
        vector: number[],
        options?: { topK?: number; filter?: Record<string, unknown>; returnMetadata?: boolean }
      ) => Promise<{ matches?: Array<{ id: string; score: number; metadata?: Record<string, unknown> }> }>
    } | undefined

    if (vectorize && typeof vectorize.query === 'function') {
      try {
        const queryRes = await vectorize.query(queryVector, {
          topK: limit,
          returnMetadata: true,
        })

        const matches = (queryRes.matches ?? [])
          .filter((m) => m.id.startsWith(`content:${tenantId ?? 'global'}:`))
          .map((m) => {
            const meta = (m.metadata ?? {}) as Record<string, string>
            return {
              entryId: meta.entryId ?? m.id.split(':').pop() ?? '',
              collectionSlug: meta.collectionSlug ?? '',
              title: meta.title ?? '',
              snippet: meta.snippet ?? '',
              score: Number((m.score ?? 0).toFixed(4)),
            }
          })

        if (matches.length > 0) {
          if (collectionSlug) {
            return matches.filter((m) => m.collectionSlug === collectionSlug).slice(0, limit)
          }
          return matches.slice(0, limit)
        }
      } catch (err) {
        logger.warn('vectorize_query_failed_falling_back', {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    // 2. Resilient fallback: Query published entries from database and rank by embedding similarity
    try {
      let filterCollectionId: string | undefined
      if (collectionSlug) {
        try {
          if (typeof collectionsRepository?.findBySlug === 'function') {
            const targetCol = await collectionsRepository.findBySlug(db, collectionSlug, tenantId)
            if (!targetCol) return []
            filterCollectionId = targetCol.id
          }
        } catch {
          // Fall through
        }
      }

      const entriesResult = await entriesRepository.findAll(db, {
        tenantId,
        collectionId: filterCollectionId,
        status: 'published',
        perPage: Math.max(limit * 3, 20),
      })

      const rows = Array.isArray(entriesResult) ? entriesResult : (entriesResult?.rows ?? [])
      const slugMap = new Map<string, string>()
      if (collectionSlug && filterCollectionId) {
        slugMap.set(filterCollectionId, collectionSlug)
      }

      const scored: RagSearchResult[] = []
      for (const entry of rows) {
        const entryData = (entry.data ?? {}) as Record<string, unknown>
        const title = String(entryData.title || entryData.name || entry.slug || entry.id)
        const fullText = `${title} ${extractTextFromContent(entryData)}`.trim()
        if (!fullText) continue

        let entryColSlug = slugMap.get(entry.collectionId)
        if (!entryColSlug) {
          try {
            if (typeof collectionsRepository?.findById === 'function') {
              const col = await collectionsRepository.findById(db, entry.collectionId, tenantId)
              entryColSlug = col?.slug
            }
          } catch {
            // Ignore collection lookup failure
          }
          entryColSlug = entryColSlug || entry.collectionId || ''
          if (entryColSlug) slugMap.set(entry.collectionId, entryColSlug)
        }

        const entryVector = createDeterministicEmbedding(fullText)
        const score = cosineSimilarity(queryVector, entryVector)

        scored.push({
          entryId: entry.id,
          collectionSlug: entryColSlug ?? '',
          title,
          snippet: fullText.slice(0, 200),
          score: Number(score.toFixed(4)),
        })
      }

      scored.sort((a, b) => b.score - a.score)
      return scored.slice(0, limit)
    } catch {
      return []
    }
  },
}
