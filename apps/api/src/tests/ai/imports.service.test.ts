import { describe, expect, it } from 'bun:test'
import type { AiSuggestion } from '../../ai/imports.repository'
import { buildCommandPayloads } from '../../ai/imports.service'

const baseSuggestion: AiSuggestion = {
  id: 'suggestion-1',
  suggestionSetId: 'set-1',
  tenantId: 'tenant-a',
  status: 'accepted',
  operation: 'update_entry',
  targetCollectionId: 'collection-1',
  targetCollectionSlug: 'products',
  targetEntryId: 'entry-1',
  fieldPath: 'title',
  locale: 'en',
  sourceLocale: 'en',
  suggestedValueJson: 'Imported title',
  editedValueJson: null,
  confidence: 70,
  citationsJson: [],
  warning: null,
  createdAt: '2026-06-03T00:00:00.000Z',
  updatedAt: '2026-06-03T00:00:00.000Z',
}

describe('ai import command mapping', () => {
  it('maps accepted update suggestions to dry-run updateEntry commands only', () => {
    const commands = buildCommandPayloads([
      baseSuggestion,
      { ...baseSuggestion, id: 'manual-1', operation: 'manual' },
      { ...baseSuggestion, id: 'rejected-1', status: 'rejected' },
    ])

    expect(commands).toHaveLength(1)
    expect(commands[0]?.type).toBe('updateEntry')
    expect(commands[0]?.dryRun).toBe(true)
    expect(commands[0]?.payload).toEqual({
      entryId: 'entry-1',
      data: { title: 'Imported title' },
    })
  })

  it('maps accepted create suggestions to draft createEntry commands', () => {
    const commands = buildCommandPayloads([
      {
        ...baseSuggestion,
        operation: 'create_entry',
        targetEntryId: null,
        fieldPath: null,
        suggestedValueJson: { title: 'New imported product' },
      },
    ])

    expect(commands).toHaveLength(1)
    expect(commands[0]?.type).toBe('createEntry')
    expect(commands[0]?.payload).toEqual({
      collectionId: 'collection-1',
      slug: 'new-imported-product',
      status: 'draft',
      data: { title: 'New imported product' },
    })
  })
})
