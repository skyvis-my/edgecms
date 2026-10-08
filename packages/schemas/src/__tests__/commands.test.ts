import { describe, expect, it } from 'bun:test'
import {
  commandEnvelopeSchema,
  commandResultSchema,
  previewReceiptRecord,
  updateEntryPayload,
} from '../commands'

describe('@edgecms/schemas commands', () => {
  it('exports ArkType command schemas', () => {
    expect(commandEnvelopeSchema).toBeDefined()
    expect(commandResultSchema).toBeDefined()
  })

  it('validates AI command envelopes for plugin-generated updates', () => {
    const envelope = commandEnvelopeSchema({
      type: 'updateEntry',
      payload: { entryId: 'entry-1', data: { seoTitle: 'Launch' } },
      actor: { userId: 'ai-agent', source: 'ai' },
      dryRun: true,
      timestamp: '2026-06-08T00:00:00.000Z',
    })

    expect(envelope).toMatchObject({
      type: 'updateEntry',
      actor: { source: 'ai' },
      dryRun: true,
    })
  })

  it('rejects invalid command types', () => {
    expect(
      commandEnvelopeSchema({
        type: 'rewriteEverything',
        payload: {},
        actor: { userId: 'ai-agent', source: 'ai' },
        timestamp: '2026-06-08T00:00:00.000Z',
      })
    ).toHaveProperty('issues')
  })

  it('rejects update entry payloads without an entry id', () => {
    expect(updateEntryPayload({ data: { title: 'Missing id' } })).toHaveProperty('issues')
  })

  it('keeps dry-run command results auditable with reviewer-visible diff', () => {
    const result = commandResultSchema({
      commandId: 'cmd-1',
      type: 'updateEntry',
      status: 'dry_run',
      diff: [{ path: 'data.seoTitle', before: 'Draft', after: 'Launch' }],
      executedAt: '2026-06-08T00:00:00.000Z',
    })

    expect(result).toMatchObject({
      commandId: 'cmd-1',
      status: 'dry_run',
      diff: [{ path: 'data.seoTitle' }],
    })
  })

  it('validates preview receipts with and without optional tenantId/explanation', () => {
    const fullReceipt = previewReceiptRecord({
      receiptId: 'rcpt_1',
      hash: 'sha256hash',
      commands: [
        {
          type: 'updateEntry',
          payload: { entryId: 'e-1', data: { title: 'Test' } },
          actor: { userId: 'u-1', source: 'ai' },
          timestamp: '2026-06-08T00:00:00.000Z',
        },
      ],
      userId: 'u-1',
      tenantId: 't-1',
      explanation: 'AI preview update',
      createdAt: '2026-06-08T00:00:00.000Z',
      expiresAt: '2026-06-08T00:15:00.000Z',
    })
    expect(fullReceipt).not.toHaveProperty('issues')
    expect(fullReceipt).toMatchObject({ receiptId: 'rcpt_1', tenantId: 't-1' })

    const minimalReceipt = previewReceiptRecord({
      receiptId: 'rcpt_2',
      hash: 'sha256hash',
      commands: [],
      userId: 'u-1',
      createdAt: '2026-06-08T00:00:00.000Z',
      expiresAt: '2026-06-08T00:15:00.000Z',
    })
    expect(minimalReceipt).not.toHaveProperty('issues')
    expect(minimalReceipt).toMatchObject({ receiptId: 'rcpt_2' })

    const consumedReceipt = previewReceiptRecord({
      receiptId: 'rcpt_3',
      hash: 'sha256hash',
      commands: [],
      userId: 'u-1',
      consumedAt: '2026-06-08T00:05:00.000Z',
      createdAt: '2026-06-08T00:00:00.000Z',
      expiresAt: '2026-06-08T00:15:00.000Z',
    })
    expect(consumedReceipt).not.toHaveProperty('issues')
    expect(consumedReceipt).toMatchObject({ receiptId: 'rcpt_3', consumedAt: '2026-06-08T00:05:00.000Z' })
  })

  it('validates command envelopes with idempotencyKey', () => {
    const envelope = commandEnvelopeSchema({
      type: 'createEntry',
      payload: { collectionId: 'articles', data: { title: 'Idempotent' } },
      actor: { userId: 'user-1', source: 'admin' },
      idempotencyKey: 'idem-key-12345',
      timestamp: '2026-06-08T00:00:00.000Z',
    })
    expect(envelope).not.toHaveProperty('issues')
    expect(envelope).toMatchObject({
      idempotencyKey: 'idem-key-12345',
    })
  })
})
