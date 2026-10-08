import { like } from 'drizzle-orm'
import { assetsRepository } from '@/assets/assets.repository'
import { collectionsRepository } from '@/collections/collections.repository'
import type { Database } from '@/database/db'
import { entries } from '@/database/schema'
import { entriesRepository } from '@/entries/entries.repository'
import { aiImportsRepository } from '../imports.repository'

export type ContextToolName =
  | 'cms.getCollectionSchema'
  | 'cms.searchEntries'
  | 'cms.getEntry'
  | 'cms.searchAssets'
  | 'rag.search'

export type ContextCitation = {
  id: string
  sourceType: 'collection' | 'entry' | 'asset' | 'source'
  sourceId: string
  label: string
  fieldPath?: string
  snippet?: string
  score?: number
}

export type ContextToolCall = {
  tenantId: string
  batchId?: string
  suggestionSetId?: string
  tool: ContextToolName
  input: Record<string, unknown>
  limits: { maxResults: number; timeoutMs: number }
}

const TOOL_ALLOWLIST = new Set<ContextToolName>([
  'cms.getCollectionSchema',
  'cms.searchEntries',
  'cms.getEntry',
  'cms.searchAssets',
  'rag.search',
])

function cap(maxResults: number): number {
  return Math.max(1, Math.min(maxResults, 20))
}

function textValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function snippet(value: unknown): string {
  return textValue(value).replace(/\s+/g, ' ').slice(0, 240)
}

async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function runContextTool(db: Database, call: ContextToolCall): Promise<ContextCitation[]> {
  if (!TOOL_ALLOWLIST.has(call.tool)) {
    throw new Error(`Context tool is not allowed: ${call.tool}`)
  }

  const started = Date.now()
  const limit = cap(call.limits.maxResults)
  let status: 'success' | 'failed' | 'timeout' = 'success'
  let citations: ContextCitation[] = []

  try {
    if (call.limits.timeoutMs <= 0) {
      status = 'timeout'
      return []
    }

    if (call.tool === 'cms.getCollectionSchema') {
      const slug = String(call.input.collectionSlug ?? '')
      const collection = slug
        ? await collectionsRepository.findBySlug(db, slug, call.tenantId)
        : undefined
      citations = collection
        ? [
            {
              id: `collection:${collection.id}`,
              sourceType: 'collection',
              sourceId: collection.id,
              label: collection.name,
              snippet: snippet(collection.fields),
              score: 1,
            },
          ]
        : []
    }

    if (call.tool === 'cms.getEntry') {
      const entryId = String(call.input.entryId ?? '')
      const entry = entryId ? await entriesRepository.findById(db, entryId, call.tenantId) : undefined
      citations = entry
        ? [
            {
              id: `entry:${entry.id}`,
              sourceType: 'entry',
              sourceId: entry.id,
              label: entry.slug,
              snippet: snippet(entry.data),
              score: 1,
            },
          ]
        : []
    }

    if (call.tool === 'cms.searchEntries' || call.tool === 'rag.search') {
      const query = String(call.input.query ?? '').trim()
      const collectionId = call.input.collectionId ? String(call.input.collectionId) : undefined
      const rows = await entriesRepository.findAll(db, {
        tenantId: call.tenantId,
        collectionId,
        perPage: limit,
        extraConditions: query ? [like(entries.data, `%${query.replace(/[%_]/g, '\\$&')}%`)] : [],
      })
      citations = rows.rows.slice(0, limit).map((entry) => ({
        id: `entry:${entry.id}`,
        sourceType: 'entry' as const,
        sourceId: entry.id,
        label: entry.slug,
        snippet: snippet(entry.data),
        score: query ? 0.7 : 0.4,
      }))
    }

    if (call.tool === 'cms.searchAssets') {
      const query = String(call.input.query ?? '').trim()
      const assets = query
        ? await assetsRepository.searchByTerm(db, {
            term: query,
            limit,
            tenantId: call.tenantId,
          })
        : []
      citations = assets.slice(0, limit).map((asset) => ({
        id: `asset:${asset.id}`,
        sourceType: 'asset' as const,
        sourceId: asset.id,
        label: asset.filename,
        snippet: asset.mimeType,
        score: 0.6,
      }))
    }

    return citations.slice(0, limit)
  } catch (err) {
    status = 'failed'
    throw err
  } finally {
    await aiImportsRepository.insertToolInvocation(db, {
      id: crypto.randomUUID(),
      tenantId: call.tenantId,
      batchId: call.batchId,
      suggestionSetId: call.suggestionSetId,
      toolName: call.tool,
      inputJson: call.input,
      inputHash: await sha256(JSON.stringify(call.input)),
      resultCount: citations.length,
      status,
      durationMs: Date.now() - started,
      createdAt: new Date().toISOString(),
    })
  }
}
