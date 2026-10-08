import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { Elysia } from 'elysia'

type AiCommandResponseBody = {
  success: boolean
  data?: { commands: Array<{ actor: { userId: string } }> }
  error?: { code: string }
  err?: { code: string }
}

const mockDb = {} as D1Database
const mockKv = {} as KVNamespace
const mockExecuteGeneratedCommands = vi.fn()
const mockRunAiWorkflow = vi.fn()

vi.mock('cloudflare:workers', () => ({
  env: { DB: mockDb, CACHE: mockKv, MEDIA: {} as R2Bucket },
}))

vi.mock('@/auth/auth.middleware', () => ({
  betterAuthPlugin: new Elysia().macro({
    auth: {
      resolve() {
        return { user: { id: 'u1' } }
      },
    },
  }),
}))

vi.mock('../../ai/ai.service', () => ({
  executeGeneratedCommands: mockExecuteGeneratedCommands,
  runAiWorkflow: mockRunAiWorkflow,
}))

const { aiController } = await import(`../../ai/ai.controller?bypass=${Date.now()}`)

describe('aiController', () => {
  const app = new Elysia().use(aiController)

  beforeEach(() => {
    vi.clearAllMocks()
    mockExecuteGeneratedCommands.mockReset()
    mockRunAiWorkflow.mockReset()
  })

  it('returns generated commands in dryRun mode', async () => {
    mockExecuteGeneratedCommands.mockResolvedValue({
      commands: [
        {
          type: 'createEntry',
          payload: {},
          actor: { userId: 'ignored', source: 'ai' },
          timestamp: new Date().toISOString(),
        },
      ],
      explanation: 'Will create',
      status: 'dry_run',
    })

    const response = await app.handle(
      new Request('http://localhost/api/admin/ai/command', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'create post', dryRun: true }),
      })
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as AiCommandResponseBody
    expect(body.success).toBe(true)
    expect(body.data?.commands[0]?.actor.userId).toBe('ignored')
    expect(mockExecuteGeneratedCommands).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
      })
    )
  })

  it('executes commands and stops on first failed result', async () => {
    mockExecuteGeneratedCommands.mockResolvedValue({
      commands: [
        {
          type: 'createEntry',
          payload: {},
          actor: { userId: 'x', source: 'ai' },
          timestamp: new Date().toISOString(),
        },
      ],
      explanation: 'Run two',
      status: 'failed',
      results: [
        {
          commandId: 'cmd-1',
          type: 'createEntry',
          status: 'failed',
          executedAt: new Date().toISOString(),
          error: { code: 'INTERNAL_ERROR', message: 'nope' },
        },
      ],
    })

    const response = await app.handle(
      new Request('http://localhost/api/admin/ai/command', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'do work' }),
      })
    )

    expect(response.status).toBe(500)
    const body = (await response.json()) as AiCommandResponseBody
    expect(body.success).toBe(false)
    expect(body.error?.code).toBe('EXECUTION_FAILED')
  })

  it('maps generation exceptions to AI_GENERATION_FAILED (400)', async () => {
    mockExecuteGeneratedCommands.mockRejectedValueOnce(new Error('provider unavailable'))

    const response = await app.handle(
      new Request('http://localhost/api/admin/ai/command', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'fail' }),
      })
    )

    expect(response.status).toBe(400)
    const body = (await response.json()) as AiCommandResponseBody
    expect(body.error?.code).toBe('AI_GENERATION_FAILED')
  })

  it('runs named workflow and returns steps', async () => {
    mockRunAiWorkflow.mockResolvedValue({
      workflow: 'bulk_update',
      explanation: 'Prepared workflow.',
      commands: [],
      steps: [{ id: 's1', status: 'completed' }],
    })

    const response = await app.handle(
      new Request('http://localhost/api/admin/ai/workflow', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workflow: 'bulk_update', prompt: 'publish all drafts' }),
      })
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      success: boolean
      data?: { steps: Array<{ status: string }> }
    }
    expect(body.success).toBe(true)
    expect(body.data?.steps[0]?.status).toBe('completed')
  })

  it('keeps AI import review disabled by default for the launch release', async () => {
    const response = await app.handle(
      new Request('http://localhost/api/admin/ai/import-batches', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ intent: 'turn brochure into content' }),
      })
    )

    expect(response.status).toBe(404)
    const body = (await response.json()) as AiCommandResponseBody
    expect(body.success).toBe(false)
    expect(body.err?.code).toBe('AI_IMPORT_REVIEW_DISABLED')
  })
})
