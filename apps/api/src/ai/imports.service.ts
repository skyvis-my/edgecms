import type { CommandContext } from '@/commands/engine'
import { executeCommand } from '@/commands/engine'
import { collectionsRepository } from '@/collections/collections.repository'
import type { CollectionRow } from '@/collections/collections.repository'
import type { Database } from '@/database/db'
import { entriesRepository } from '@/entries/entries.repository'
import type { Env } from '@/env'
import type { CommandEnvelope, CommandResult } from '@edgecms/schemas/commands'
import { runContextTool, type ContextCitation } from './context/context-gateway'
import { aiImportsRepository, type AiImportBatch, type AiSuggestion } from './imports.repository'
import {
  stageWordPressImportCommands,
  parseWordPressWxr,
  gutenbergToTipTap,
  type WordPressPostItem,
  type StageWordPressResult,
} from './wordpress-wxr-parser'

export {
  stageWordPressImportCommands,
  parseWordPressWxr,
  gutenbergToTipTap,
  type WordPressPostItem,
  type StageWordPressResult,
}

const TEXT_LIMIT = 100_000
const FILE_LIMIT = 5_000_000
const RETENTION_DAYS = 30
const TEXT_CONTENT_TYPES = new Set([
  'text/plain',
  'text/csv',
  'application/json',
  'text/markdown',
  'application/octet-stream',
])

type FieldDefinition = {
  name: string
  type: string
  required: boolean
  localizable: boolean
}

export type CreateImportBatchInput = {
  intent: string
  targetCollectionSlug?: string
  targetEntryId?: string
  sourceLocale?: string
  targetLocales?: string[]
}

export type AddImportSourceInput =
  | { kind: 'text'; text: string }
  | { kind: 'file'; file: File }
  | { kind: 'asset'; existingAssetId: string }

export type ImportBatchDetail = {
  batch: AiImportBatch
  sources: Awaited<ReturnType<typeof aiImportsRepository.listSources>>
  suggestionSet: Awaited<ReturnType<typeof aiImportsRepository.latestSuggestionSet>>
  suggestions: Awaited<ReturnType<typeof aiImportsRepository.listSuggestions>>
  localeMatrix: { sourceLocale: string; targetLocales: string[] }
  warnings: string[]
}

function tenantScope(tenantId?: string): string {
  return tenantId ?? 'global'
}

function nowIso(): string {
  return new Date().toISOString()
}

function expiresAt(): string {
  return new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
}

function assertLocale(locale: string | undefined): void {
  if (locale && !/^[a-z]{2}(-[A-Z]{2})?$/.test(locale)) {
    throw new Error(`Unsupported locale code: ${locale}`)
  }
}

async function sha256(input: string | ArrayBuffer): Promise<string> {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function normalizeText(input: string): string {
  return input.replace(/\s+/g, ' ').trim().slice(0, TEXT_LIMIT)
}

function firstTextField(collection: CollectionRow): FieldDefinition | undefined {
  return collection.fields.find((field) =>
    ['text', 'textarea', 'richtext', 'markdown', 'string'].includes(field.type)
  )
}

function validateField(collection: CollectionRow, fieldPath: string | null): FieldDefinition | undefined {
  if (!fieldPath) return undefined
  return collection.fields.find((field) => field.name === fieldPath)
}

function makeSlug(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
  return slug || `ai-import-${Date.now()}`
}

function parseRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function commandHash(commands: CommandEnvelope[]): Promise<string> {
  return sha256(JSON.stringify(commands))
}

function suggestionValue(suggestion: AiSuggestion): unknown {
  return suggestion.editedValueJson ?? suggestion.suggestedValueJson
}

export function buildCommandPayloads(suggestions: AiSuggestion[]): CommandEnvelope[] {
  return suggestions
    .filter((suggestion) => suggestion.status === 'accepted')
    .flatMap((suggestion): CommandEnvelope[] => {
      if (suggestion.operation === 'create_entry' && suggestion.targetCollectionId) {
        const data = parseRecord(suggestionValue(suggestion))
        return [
          {
            type: 'createEntry',
            payload: {
              collectionId: suggestion.targetCollectionId,
              slug: makeSlug(String(data.title ?? data.name ?? suggestion.fieldPath ?? 'ai-import')),
              status: 'draft',
              data,
            },
            actor: { userId: 'system', source: 'ai' },
            dryRun: true,
            timestamp: nowIso(),
          },
        ]
      }

      if (
        suggestion.operation === 'update_entry' &&
        suggestion.targetEntryId &&
        suggestion.fieldPath
      ) {
        return [
          {
            type: 'updateEntry',
            payload: {
              entryId: suggestion.targetEntryId,
              data: { [suggestion.fieldPath]: suggestionValue(suggestion) },
            },
            actor: { userId: 'system', source: 'ai' },
            dryRun: true,
            timestamp: nowIso(),
          },
        ]
      }

      return []
    })
}

export const aiImportService = {
  async createBatch(
    db: Database,
    input: CreateImportBatchInput,
    userId: string,
    tenantId?: string
  ): Promise<AiImportBatch> {
    const intent = input.intent.trim()
    if (!intent) throw new Error('Intent is required')
    assertLocale(input.sourceLocale)
    for (const locale of input.targetLocales ?? []) assertLocale(locale)

    if (input.targetCollectionSlug) {
      const collection = await collectionsRepository.findBySlug(db, input.targetCollectionSlug, tenantId)
      if (!collection) throw new Error('Target collection was not found')
    }
    if (input.targetEntryId) {
      const entry = await entriesRepository.findById(db, input.targetEntryId, tenantId)
      if (!entry) throw new Error('Target entry was not found')
    }

    const timestamp = nowIso()
    return aiImportsRepository.createBatch(db, {
      id: crypto.randomUUID(),
      tenantId,
      createdByUserId: userId,
      status: 'draft',
      intent,
      targetCollectionSlug: input.targetCollectionSlug,
      targetEntryId: input.targetEntryId,
      sourceLocale: input.sourceLocale ?? 'en',
      targetLocalesJson: input.targetLocales ?? [],
      createdAt: timestamp,
      updatedAt: timestamp,
    })
  },

  async addSource(
    db: Database,
    env: Env,
    batchId: string,
    input: AddImportSourceInput,
    tenantId?: string
  ) {
    const batch = await aiImportsRepository.findBatch(db, batchId, tenantId)
    if (!batch) throw new Error('Import batch was not found')

    const timestamp = nowIso()
    if (input.kind === 'text') {
      const text = normalizeText(input.text)
      if (!text) throw new Error('Source text is required')
      if (input.text.length > TEXT_LIMIT) throw new Error('Source text is too large')
      return aiImportsRepository.createSource(db, {
        id: crypto.randomUUID(),
        batchId,
        tenantId,
        kind: 'text',
        contentType: 'text/plain',
        sizeBytes: new TextEncoder().encode(input.text).byteLength,
        extractionStatus: 'ready',
        extractedText: text,
        hash: await sha256(text),
        expiresAt: expiresAt(),
        createdAt: timestamp,
      })
    }

    if (input.kind === 'asset') {
      return aiImportsRepository.createSource(db, {
        id: crypto.randomUUID(),
        batchId,
        tenantId,
        kind: 'asset',
        existingAssetId: input.existingAssetId,
        extractionStatus: 'ready',
        mediaSummaryJson: { existingAssetId: input.existingAssetId },
        expiresAt: expiresAt(),
        createdAt: timestamp,
      })
    }

    const file = input.file
    if (file.size > FILE_LIMIT) throw new Error('File is too large')
    const contentType = file.type || 'application/octet-stream'
    if (!TEXT_CONTENT_TYPES.has(contentType) && !contentType.startsWith('image/')) {
      throw new Error('File type is not supported')
    }

    const bytes = await file.arrayBuffer()
    const sourceId = crypto.randomUUID()
    const r2ObjectKey = `${tenantScope(tenantId)}/ai-imports/${batchId}/${sourceId}/${file.name}`
    await env.MEDIA.put(r2ObjectKey, bytes, {
      httpMetadata: { contentType },
      customMetadata: { tenantId: tenantScope(tenantId), batchId },
    })

    const isText = TEXT_CONTENT_TYPES.has(contentType)
    const extractedText = isText ? normalizeText(new TextDecoder().decode(bytes)) : undefined
    return aiImportsRepository.createSource(db, {
      id: sourceId,
      batchId,
      tenantId,
      kind: 'file',
      filename: file.name,
      contentType,
      sizeBytes: file.size,
      r2ObjectKey,
      extractionStatus: isText ? 'ready' : 'unsupported',
      extractedText,
      mediaSummaryJson: isText ? undefined : { filename: file.name, contentType, sizeBytes: file.size },
      hash: await sha256(bytes),
      expiresAt: expiresAt(),
      createdAt: timestamp,
    })
  },

  async analyze(db: Database, batchId: string, tenantId?: string) {
    const batch = await aiImportsRepository.findBatch(db, batchId, tenantId)
    if (!batch) throw new Error('Import batch was not found')
    const sources = await aiImportsRepository.listSources(db, batchId, tenantId)
    const usableSources = sources.filter((source) => source.extractionStatus === 'ready')
    if (usableSources.length === 0) throw new Error('No extracted source is ready for analysis')

    const timestamp = nowIso()
    const suggestionSet = await aiImportsRepository.createSuggestionSet(db, {
      id: crypto.randomUUID(),
      batchId,
      tenantId,
      status: 'generating',
      model: 'deterministic-mvp',
      promptHash: await sha256(batch.intent),
      warningsJson: sources
        .filter((source) => source.extractionStatus !== 'ready')
        .map((source) => `${source.filename ?? source.id}: ${source.extractionStatus}`),
      createdAt: timestamp,
      updatedAt: timestamp,
    })

    const collection = batch.targetCollectionSlug
      ? await collectionsRepository.findBySlug(db, batch.targetCollectionSlug, tenantId)
      : undefined
    if (!collection) throw new Error('Target collection was not found')

    const text = normalizeText(
      usableSources
        .map((source) => source.extractedText ?? JSON.stringify(source.mediaSummaryJson ?? {}))
        .join('\n')
    )
    const citations: ContextCitation[] = [
      ...(await runContextTool(db, {
        tenantId: tenantScope(tenantId),
        batchId,
        suggestionSetId: suggestionSet.id,
        tool: 'cms.getCollectionSchema',
        input: { collectionSlug: collection.slug },
        limits: { maxResults: 1, timeoutMs: 500 },
      })),
      ...(await runContextTool(db, {
        tenantId: tenantScope(tenantId),
        batchId,
        suggestionSetId: suggestionSet.id,
        tool: 'cms.searchEntries',
        input: { query: batch.intent, collectionId: collection.id },
        limits: { maxResults: 5, timeoutMs: 500 },
      })),
      ...(await runContextTool(db, {
        tenantId: tenantScope(tenantId),
        batchId,
        suggestionSetId: suggestionSet.id,
        tool: 'cms.searchAssets',
        input: { query: batch.intent },
        limits: { maxResults: 5, timeoutMs: 500 },
      })),
    ]

    const field = firstTextField(collection)
    const suggestions =
      batch.targetEntryId && field
        ? [
            {
              id: crypto.randomUUID(),
              suggestionSetId: suggestionSet.id,
              tenantId,
              status: 'pending' as const,
              operation: 'update_entry' as const,
              targetCollectionId: collection.id,
              targetCollectionSlug: collection.slug,
              targetEntryId: batch.targetEntryId,
              fieldPath: field.name,
              locale: batch.sourceLocale ?? collection.defaultLocale,
              sourceLocale: batch.sourceLocale ?? collection.defaultLocale,
              suggestedValueJson: text,
              confidence: 70,
              citationsJson: citations,
              createdAt: timestamp,
              updatedAt: timestamp,
            },
          ]
        : [
            {
              id: crypto.randomUUID(),
              suggestionSetId: suggestionSet.id,
              tenantId,
              status: field ? ('pending' as const) : ('warning' as const),
              operation: field ? ('create_entry' as const) : ('manual' as const),
              targetCollectionId: collection.id,
              targetCollectionSlug: collection.slug,
              fieldPath: field?.name,
              locale: batch.sourceLocale ?? collection.defaultLocale,
              sourceLocale: batch.sourceLocale ?? collection.defaultLocale,
              suggestedValueJson: field ? { [field.name]: text } : text,
              confidence: field ? 65 : 0,
              citationsJson: citations,
              warning: field ? undefined : 'No compatible text field found for automatic command mapping',
              createdAt: timestamp,
              updatedAt: timestamp,
            },
          ]

    await aiImportsRepository.createSuggestions(db, suggestions)
    await aiImportsRepository.updateSuggestionSet(db, suggestionSet.id, tenantId, { status: 'ready' })
    await aiImportsRepository.updateBatch(db, batch.id, tenantId, { status: 'ready_for_review' })
    return { suggestionSetId: suggestionSet.id, status: 'ready_for_review' as const }
  },

  async getBatchDetail(
    db: Database,
    batchId: string,
    tenantId: string | undefined,
    input: { page?: number; perPage?: number; status?: string } = {}
  ): Promise<ImportBatchDetail> {
    const batch = await aiImportsRepository.findBatch(db, batchId, tenantId)
    if (!batch) throw new Error('Import batch was not found')
    const sources = await aiImportsRepository.listSources(db, batchId, tenantId)
    const suggestionSet = await aiImportsRepository.latestSuggestionSet(db, batchId, tenantId)
    const suggestions = suggestionSet
      ? await aiImportsRepository.listSuggestions(db, suggestionSet.id, tenantId, input)
      : { rows: [], total: 0 }
    return {
      batch,
      sources,
      suggestionSet,
      suggestions,
      localeMatrix: {
        sourceLocale: batch.sourceLocale ?? 'en',
        targetLocales: batch.targetLocalesJson ?? [],
      },
      warnings: suggestionSet?.warningsJson ?? [],
    }
  },

  async updateSuggestion(
    db: Database,
    suggestionId: string,
    tenantId: string | undefined,
    input: { status?: 'pending' | 'accepted' | 'rejected'; editedValue?: unknown }
  ) {
    const suggestion = await aiImportsRepository.findSuggestion(db, suggestionId, tenantId)
    if (!suggestion) throw new Error('Suggestion was not found')
    if (suggestion.status === 'warning') throw new Error('Warning suggestions cannot be accepted')
    if (input.editedValue !== undefined && suggestion.targetCollectionSlug) {
      const collection = await collectionsRepository.findBySlug(db, suggestion.targetCollectionSlug, tenantId)
      if (!collection) throw new Error('Target collection was not found')
      const field = validateField(collection, suggestion.fieldPath)
      if (suggestion.operation === 'update_entry' && !field) {
        throw new Error('Suggestion field path is not valid for target collection')
      }
    }
    return aiImportsRepository.updateSuggestion(db, suggestionId, tenantId, {
      status: input.status,
      editedValueJson: input.editedValue,
    })
  },

  async dryRunSuggestionSet(
    db: Database,
    kv: KVNamespace,
    suggestionSetId: string,
    userId: string,
    tenantId?: string,
    requestMeta?: CommandContext['requestMeta']
  ) {
    const suggestionSet = await aiImportsRepository.findSuggestionSet(db, suggestionSetId, tenantId)
    if (!suggestionSet) throw new Error('Suggestion set was not found')
    const { rows } = await aiImportsRepository.listSuggestions(db, suggestionSet.id, tenantId, {
      perPage: 100,
      status: 'accepted',
    })
    const commands = buildCommandPayloads(rows).map((command) => ({
      ...command,
      actor: { userId, source: 'ai' as const },
      dryRun: true,
    }))
    const context: CommandContext = {
      db,
      kv,
      actor: { userId, source: 'ai' },
      tenantScope: tenantId,
      requestMeta,
    }
    const results: CommandResult[] = []
    for (const command of commands) {
      results.push(await executeCommand(context, command))
    }
    const dryRunHash = await commandHash(commands)
    await aiImportsRepository.updateSuggestionSet(db, suggestionSet.id, tenantId, {
      status: 'dry_run_ready',
      dryRunHash,
      dryRunPayloadJson: commands,
      dryRunResultJson: results,
    })
    return { commands, commandResults: results, validationErrors: [], dryRunHash }
  },

  async applySuggestionSet(
    db: Database,
    kv: KVNamespace,
    suggestionSetId: string,
    dryRunHash: string,
    userId: string,
    tenantId?: string,
    requestMeta?: CommandContext['requestMeta']
  ) {
    const suggestionSet = await aiImportsRepository.findSuggestionSet(db, suggestionSetId, tenantId)
    if (!suggestionSet) throw new Error('Suggestion set was not found')
    if (!suggestionSet.dryRunHash || suggestionSet.dryRunHash !== dryRunHash) {
      throw new Error('Latest dry-run hash is required before apply')
    }
    const commands = ((suggestionSet.dryRunPayloadJson ?? []) as CommandEnvelope[]).map((command) => ({
      ...command,
      actor: { userId, source: 'ai' as const },
      dryRun: false,
    }))
    const currentHash = await commandHash(commands.map((command) => ({ ...command, dryRun: true })))
    if (currentHash !== dryRunHash) throw new Error('Dry-run payload is stale')

    const context: CommandContext = {
      db,
      kv,
      actor: { userId, source: 'ai' },
      tenantScope: tenantId,
      requestMeta,
    }
    const results: CommandResult[] = []
    for (const command of commands) {
      const result = await executeCommand(context, command)
      results.push(result)
      if (result.status === 'failed') break
    }
    const failed = results.some((result) => result.status === 'failed')
    await aiImportsRepository.updateSuggestionSet(db, suggestionSet.id, tenantId, {
      status: failed ? 'ready' : 'applied',
      commandResultJson: results,
    })
    if (!failed) {
      await aiImportsRepository.updateBatch(db, suggestionSet.batchId, tenantId, {
        status: 'applied',
        appliedCommandId: results[0]?.commandId,
      })
    }
    return { commands, commandResults: results, status: failed ? 'partial_failure' : 'applied' }
  },

  async stageWordPressImport(
    db: Database,
    collectionSlug: string,
    wxrXml: string,
    options?: {
      postType?: string
      defaultStatus?: 'draft' | 'published'
      userId?: string
      tenantId?: string
    }
  ): Promise<StageWordPressResult> {
    const collection = await collectionsRepository.findBySlug(db, collectionSlug, options?.tenantId)
    if (!collection) {
      throw new Error(`Target collection '${collectionSlug}' was not found`)
    }
    return stageWordPressImportCommands(wxrXml, collection.id, {
      postType: options?.postType,
      defaultStatus: options?.defaultStatus,
      actorUserId: options?.userId,
    })
  },
}
