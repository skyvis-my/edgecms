import { beforeEach, describe, expect, it, vi } from 'bun:test'
import type { Database } from '@/database/db'
import type { Env } from '@/env'
import type { CommandEnvelope } from '@edgecms/schemas/commands'
import { previewReceiptRecord } from '@edgecms/schemas/commands'
import {
  __resetPreviewReceiptStoreForTests,
  computeCommandsHash,
  createPreviewReceipt,
  markPreviewReceiptConsumed,
  verifyPreviewReceipt,
} from '@/ai/preview-receipt.service'

const mockExecuteCommand = vi.fn()
vi.mock('@/commands/engine', () => ({
  executeCommand: mockExecuteCommand,
}))

const mockGenerateText = vi.fn()
vi.mock('ai', () => ({
  generateText: mockGenerateText,
  tool: vi.fn((opts) => opts),
}))

vi.mock('../../ai/adapters/arktype-to-zod', () => ({
  arktypeToZod: vi.fn(() => ({})),
}))

vi.mock('../../ai/providers/registry', () => ({
  getModel: vi.fn(() => ({
    doGenerate: vi.fn(),
    specificationVersion: 'v1' as const,
    provider: 'test-provider',
    modelId: 'test-model',
  })),
}))

vi.mock('../../ai/context/context-builder', () => ({
  buildContextPackFromDb: vi.fn(() => ({
    collections: [],
    locale: 'en',
  })),
}))

const { executeGeneratedCommands } = await import(`../../ai/ai.service?bypass=${Date.now()}`)

const mockDb = {} as Database
const mockEnv = {
  AI_MODEL_MID: 'test-model',
} as unknown as Env
const mockKv = {} as KVNamespace

describe('Immutable Preview Receipt Verification (T05a / G10)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetPreviewReceiptStoreForTests()
  })

  it('computes deterministic SHA-256 hash regardless of object key order', async () => {
    const cmd1: CommandEnvelope = {
      type: 'createEntry',
      payload: { b: 2, a: 1, nested: { y: 20, x: 10 } },
      actor: { userId: 'u1', source: 'ai' },
      timestamp: '2026-01-01T00:00:00.000Z',
    }

    const cmd2: CommandEnvelope = {
      type: 'createEntry',
      payload: { a: 1, b: 2, nested: { x: 10, y: 20 } },
      actor: { source: 'ai', userId: 'u1' },
      timestamp: '2026-10-10T00:00:00.000Z', // Top-level ephemeral timestamp is ignored
    }

    const hash1 = await computeCommandsHash([cmd1])
    const hash2 = await computeCommandsHash([cmd2])

    expect(hash1).toHaveLength(64) // SHA-256 hex length
    expect(hash1).toBe(hash2)
  })

  it('creates and verifies a valid preview receipt', async () => {
    const commands: CommandEnvelope[] = [
      {
        type: 'updateEntry',
        payload: { entryId: 'e-1', data: { title: 'Updated' } },
        actor: { userId: 'user-1', source: 'ai' },
        timestamp: new Date().toISOString(),
      },
    ]

    const receipt = await createPreviewReceipt({
      commands,
      userId: 'user-1',
      tenantId: 'tenant-smoke',
    })

    expect(receipt.receiptId).toStartWith('rcpt_')
    expect(receipt.hash).toHaveLength(64)

    const verification = await verifyPreviewReceipt({
      receiptId: receipt.receiptId,
      userId: 'user-1',
      tenantId: 'tenant-smoke',
    })

    expect(verification.valid).toBe(true)
    expect(verification.receipt?.receiptId).toBe(receipt.receiptId)

    // Verify ArkType schema parses receipt without errors
    const parsed = previewReceiptRecord(receipt)
    expect(parsed).not.toHaveProperty('issues')
    expect(parsed).toMatchObject({ receiptId: receipt.receiptId, tenantId: 'tenant-smoke' })

    // Also verify schema parses receipt when optional tenantId and explanation are omitted
    const minimalReceipt = await createPreviewReceipt({
      commands,
      userId: 'user-minimal',
    })
    const parsedMinimal = previewReceiptRecord(minimalReceipt)
    expect(parsedMinimal).not.toHaveProperty('issues')
    expect(parsedMinimal).toMatchObject({ receiptId: minimalReceipt.receiptId, userId: 'user-minimal' })
  })

  it('rejects verification if receipt is missing or expired', async () => {
    const missing = await verifyPreviewReceipt({
      receiptId: 'rcpt_non_existent',
      userId: 'user-1',
    })
    expect(missing.valid).toBe(false)
    expect(missing.error).toBe('RECEIPT_NOT_FOUND')

    const expiredReceipt = await createPreviewReceipt({
      commands: [],
      userId: 'user-1',
      ttlSeconds: -1, // Expired immediately
    })

    const expired = await verifyPreviewReceipt({
      receiptId: expiredReceipt.receiptId,
      userId: 'user-1',
    })
    expect(expired.valid).toBe(false)
    expect(expired.error).toBe('RECEIPT_EXPIRED')
  })

  it('rejects verification if actor or tenant does not match', async () => {
    const receipt = await createPreviewReceipt({
      commands: [],
      userId: 'user-1',
      tenantId: 'tenant-a',
    })

    const actorMismatch = await verifyPreviewReceipt({
      receiptId: receipt.receiptId,
      userId: 'user-2', // Different actor
      tenantId: 'tenant-a',
    })
    expect(actorMismatch.valid).toBe(false)
    expect(actorMismatch.error).toBe('ACTOR_MISMATCH')

    const tenantMismatch = await verifyPreviewReceipt({
      receiptId: receipt.receiptId,
      userId: 'user-1',
      tenantId: 'tenant-b', // Different tenant
    })
    expect(tenantMismatch.valid).toBe(false)
    expect(tenantMismatch.error).toBe('TENANT_MISMATCH')
  })

  it('detects tampering when caller passes modified commands', async () => {
    const originalCommands: CommandEnvelope[] = [
      {
        type: 'updateEntry',
        payload: { entryId: 'e-1', data: { title: 'Legitimate Title' } },
        actor: { userId: 'user-1', source: 'ai' },
        timestamp: new Date().toISOString(),
      },
    ]

    const receipt = await createPreviewReceipt({
      commands: originalCommands,
      userId: 'user-1',
    })

    const tamperedCommands: CommandEnvelope[] = [
      {
        type: 'updateEntry',
        payload: { entryId: 'e-1', data: { title: 'Hacked Title' } },
        actor: { userId: 'user-1', source: 'ai' },
        timestamp: new Date().toISOString(),
      },
    ]

    const result = await verifyPreviewReceipt({
      receiptId: receipt.receiptId,
      userId: 'user-1',
      commandsToVerify: tamperedCommands,
    })

    expect(result.valid).toBe(false)
    expect(result.error).toBe('HASH_MISMATCH')
  })

  it('Ticket T05a: eliminates LLM re-generation drift by executing exact reviewed preview receipt commands', async () => {
    // 1. First invocation: Preview generation (dryRun: true)
    // Model generates: Create Post A
    mockGenerateText.mockResolvedValueOnce({
      text: 'Preview: Creating Post A',
      steps: [
        {
          stepType: 'initial',
          text: '',
          toolCalls: [
            {
              toolCallId: 'call-1',
              toolName: 'createEntry',
              args: { collectionId: 'posts', data: { title: 'Post A' } },
            },
          ],
          toolResults: [],
          finishReason: 'tool-calls',
          usage: { promptTokens: 10, completionTokens: 10 },
          warnings: [],
        },
      ],
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 10 },
      warnings: [],
    })

    const previewResult = await executeGeneratedCommands({
      prompt: 'Create a post about Edge CMS',
      dryRun: true,
      userId: 'author-1',
      env: mockEnv,
      db: mockDb,
      kv: mockKv,
      metadata: { tenantId: 'tenant-1' },
    })

    expect(previewResult.status).toBe('dry_run')
    expect(previewResult.previewReceipt).toBeDefined()
    expect(previewResult.commands[0]?.payload.data).toEqual({ title: 'Post A' })

    const receiptId = previewResult.previewReceipt!

    // 2. Simulate model drift: If the model were called again, it would output Post B (divergence!)
    mockGenerateText.mockResolvedValueOnce({
      text: 'Drifted Output: Creating Post B',
      steps: [
        {
          stepType: 'initial',
          text: '',
          toolCalls: [
            {
              toolCallId: 'call-2',
              toolName: 'createEntry',
              args: { collectionId: 'posts', data: { title: 'Post B (DRIFT)' } },
            },
          ],
          toolResults: [],
          finishReason: 'tool-calls',
          usage: { promptTokens: 10, completionTokens: 10 },
          warnings: [],
        },
      ],
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 10 },
      warnings: [],
    })

    mockExecuteCommand.mockResolvedValue({
      commandId: 'cmd-executed-1',
      type: 'createEntry',
      status: 'success',
      executedAt: new Date().toISOString(),
    })

    // 3. Execution phase: Pass the verified preview receipt
    const executionResult = await executeGeneratedCommands({
      previewReceipt: receiptId,
      userId: 'author-1',
      env: mockEnv,
      db: mockDb,
      kv: mockKv,
      metadata: { tenantId: 'tenant-1' },
    })

    expect(executionResult.status).toBe('success')
    // Crucial assertion: generateText was NOT called during execution phase!
    expect(mockGenerateText).toHaveBeenCalledTimes(1) // Only called during preview!

    // Crucial assertion: executed command matches Post A, NOT drifted Post B!
    expect(executionResult.commands[0]?.payload.data).toEqual({ title: 'Post A' })
    expect(mockExecuteCommand).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        payload: expect.objectContaining({
          data: { title: 'Post A' },
        }),
      })
    )
  })

  it('omits undefined properties consistently during canonical hashing', async () => {
    const cmdWithoutProp: CommandEnvelope = {
      type: 'createEntry',
      actor: { userId: 'u1', source: 'ai' },
      payload: { collectionSlug: 'articles', data: { title: 'Test' } },
      timestamp: '2026-01-01T00:00:00.000Z',
    }
    const cmdWithUndefinedProp: CommandEnvelope = {
      type: 'createEntry',
      actor: { userId: 'u1', source: 'ai' },
      payload: { collectionSlug: 'articles', data: { title: 'Test', extra: undefined } },
      timestamp: '2026-01-01T00:00:00.000Z',
    }

    const hash1 = await computeCommandsHash([cmdWithoutProp])
    const hash2 = await computeCommandsHash([cmdWithUndefinedProp])
    expect(hash1).toBe(hash2)
  })

  it('prunes expired entries and caps in-memory store at 500 receipts', async () => {
    // Insert 500 receipts with 1-second TTL
    for (let i = 0; i < 500; i++) {
      await createPreviewReceipt({
        commands: [
          {
            type: 'createEntry',
            actor: { userId: 'u1', source: 'ai' },
            payload: { collectionSlug: 'test', data: { i } },
            timestamp: '2026-01-01T00:00:00.000Z',
          },
        ],
        userId: 'u1',
        ttlSeconds: -10, // already expired
      })
    }

    // Creating receipt 501 should trigger pruning of expired entries
    const freshReceipt = await createPreviewReceipt({
      commands: [
        {
          type: 'createEntry',
          actor: { userId: 'u1', source: 'ai' },
          payload: { collectionSlug: 'test', data: { final: true } },
          timestamp: '2026-01-01T00:00:00.000Z',
        },
      ],
      userId: 'u1',
      ttlSeconds: 60,
    })

    const verification = await verifyPreviewReceipt({
      receiptId: freshReceipt.receiptId,
      userId: 'u1',
    })
    expect(verification.valid).toBe(true)
  })

  it('prevents replay attacks after receipt is marked consumed', async () => {
    const receipt = await createPreviewReceipt({
      commands: [
        {
          type: 'createEntry',
          actor: { userId: 'u1', source: 'ai' },
          payload: { collectionSlug: 'test', data: { title: 'Once' } },
          timestamp: '2026-01-01T00:00:00.000Z',
        },
      ],
      userId: 'u1',
    })

    const initialVerify = await verifyPreviewReceipt({
      receiptId: receipt.receiptId,
      userId: 'u1',
    })
    expect(initialVerify.valid).toBe(true)

    // Mark consumed
    await markPreviewReceiptConsumed(receipt.receiptId)

    const replayVerify = await verifyPreviewReceipt({
      receiptId: receipt.receiptId,
      userId: 'u1',
    })
    expect(replayVerify.valid).toBe(false)
    expect(replayVerify.error).toBe('RECEIPT_ALREADY_USED')
    expect(replayVerify.message).toContain('already been executed')
  })

  it('supports verifying individual command envelopes from a multi-command receipt without divergence', async () => {
    const cmd1: CommandEnvelope = {
      type: 'createEntry',
      actor: { userId: 'u1', source: 'ai' },
      payload: { collectionSlug: 'categories', data: { name: 'Tech' } },
      timestamp: '2026-01-01T00:00:00.000Z',
    }
    const cmd2: CommandEnvelope = {
      type: 'createEntry',
      actor: { userId: 'u1', source: 'ai' },
      payload: { collectionSlug: 'articles', data: { title: 'AI News' } },
      timestamp: '2026-01-01T00:00:00.000Z',
    }

    const receipt = await createPreviewReceipt({
      commands: [cmd1, cmd2],
      userId: 'u1',
    })

    // Verification of individual commands from the receipt succeeds
    const verifyCmd1 = await verifyPreviewReceipt({
      receiptId: receipt.receiptId,
      userId: 'u1',
      commandsToVerify: [cmd1],
    })
    expect(verifyCmd1.valid).toBe(true)

    const verifyCmd2 = await verifyPreviewReceipt({
      receiptId: receipt.receiptId,
      userId: 'u1',
      commandsToVerify: [cmd2],
    })
    expect(verifyCmd2.valid).toBe(true)

    // Verification of a tampered command fails with HASH_MISMATCH
    const tamperedCmd: CommandEnvelope = {
      ...cmd1,
      payload: { collectionSlug: 'categories', data: { name: 'TAMPERED' } },
    }
    const verifyTampered = await verifyPreviewReceipt({
      receiptId: receipt.receiptId,
      userId: 'u1',
      commandsToVerify: [tamperedCmd],
    })
    expect(verifyTampered.valid).toBe(false)
    expect(verifyTampered.error).toBe('HASH_MISMATCH')
  })

  it('marks receipt consumed during executeGeneratedCommands preventing replay', async () => {
    const receipt = await createPreviewReceipt({
      commands: [
        {
          type: 'createEntry',
          actor: { userId: 'u-exec', source: 'ai' },
          payload: { collectionSlug: 'posts', data: { title: 'First Run' } },
          timestamp: '2026-01-01T00:00:00.000Z',
        },
      ],
      userId: 'u-exec',
    })

    mockExecuteCommand.mockResolvedValueOnce({
      commandId: 'cmd-1',
      type: 'createEntry',
      status: 'success',
      executedAt: new Date().toISOString(),
    })

    const run1 = await executeGeneratedCommands({
      previewReceipt: receipt.receiptId,
      userId: 'u-exec',
      env: mockEnv,
      db: mockDb,
      kv: mockKv,
    })
    expect(run1.status).toBe('success')

    // Second execution should fail because receipt was consumed
    expect(
      executeGeneratedCommands({
        previewReceipt: receipt.receiptId,
        userId: 'u-exec',
        env: mockEnv,
        db: mockDb,
        kv: mockKv,
      })
    ).rejects.toThrow('already been executed')
  })

  it('executes all commands in a multi-command receipt without premature consumption', async () => {
    const receipt = await createPreviewReceipt({
      commands: [
        {
          type: 'createEntry',
          actor: { userId: 'u-multi', source: 'ai' },
          payload: { collectionSlug: 'posts', data: { title: 'First' } },
          timestamp: '2026-01-01T00:00:00.000Z',
        },
        {
          type: 'createEntry',
          actor: { userId: 'u-multi', source: 'ai' },
          payload: { collectionSlug: 'posts', data: { title: 'Second' } },
          timestamp: '2026-01-01T00:00:00.000Z',
        },
      ],
      userId: 'u-multi',
    })

    mockExecuteCommand.mockResolvedValue({
      commandId: 'cmd-multi',
      type: 'createEntry',
      status: 'success',
      executedAt: new Date().toISOString(),
    })

    const run = await executeGeneratedCommands({
      previewReceipt: receipt.receiptId,
      userId: 'u-multi',
      env: mockEnv,
      db: mockDb,
      kv: mockKv,
    })

    expect(run.status).toBe('success')
    expect(mockExecuteCommand).toHaveBeenCalledTimes(2)
  })
})
