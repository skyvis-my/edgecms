import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { Elysia } from 'elysia'

type AiCommandResponseBody = {
  success: boolean
  data?: {
    commands?: Array<{ actor: { userId: string } }>
    steps?: Array<{ status: string }>
    batch?: unknown
    source?: unknown
    suggestion?: unknown
  }
  error?: { code: string; message?: string }
  err?: { code: string; msg?: string }
}

const mockDb = {} as D1Database
const mockKv = {} as KVNamespace
const mockExecuteGeneratedCommands = vi.fn()
const mockRunAiWorkflow = vi.fn()
const mockAiImportService = {
  createBatch: vi.fn(),
  addSource: vi.fn(),
  analyze: vi.fn(),
  getBatchDetail: vi.fn(),
  updateSuggestion: vi.fn(),
  dryRunSuggestionSet: vi.fn(),
  applySuggestionSet: vi.fn(),
}

const mockWorkerEnv = {
  DB: mockDb,
  CACHE: mockKv,
  MEDIA: {} as R2Bucket,
  ENABLE_AI_IMPORT_REVIEW: 'false',
}

vi.mock('cloudflare:workers', () => ({
  env: mockWorkerEnv,
}))

vi.mock('@/auth/auth.middleware', () => ({
  betterAuthPlugin: new Elysia().macro({
    auth: {
      derive() {
        return { user: { id: 'u1' } }
      },
    },
  }),
}))

vi.mock('../../ai/ai.service', () => ({
  executeGeneratedCommands: mockExecuteGeneratedCommands,
  runAiWorkflow: mockRunAiWorkflow,
}))

vi.mock('../../ai/imports.service', () => ({
  aiImportService: mockAiImportService,
}))

const { aiController } = await import(`../../ai/ai.controller?bypass=${Date.now()}`)

describe('aiController', () => {
  const app = new Elysia().use(aiController)

  beforeEach(() => {
    vi.clearAllMocks()
    mockExecuteGeneratedCommands.mockReset()
    mockRunAiWorkflow.mockReset()
    mockWorkerEnv.ENABLE_AI_IMPORT_REVIEW = 'false'
    Object.values(mockAiImportService).forEach((fn) => fn.mockReset())
  })

  describe('POST /command', () => {
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
      expect(body.data?.commands?.[0]?.actor.userId).toBe('ignored')
      expect(mockExecuteGeneratedCommands).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
        })
      )
    })

    it('rejects request when neither prompt nor previewReceipt is provided', async () => {
      const response = await app.handle(
        new Request('http://localhost/api/admin/ai/command', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ dryRun: true }),
        })
      )

      expect(response.status).toBe(400)
      const body = (await response.json()) as AiCommandResponseBody
      expect(body.success).toBe(false)
      expect(body.error?.code).toBe('INVALID_INPUT')
    })

    it('executes previewReceipt successfully', async () => {
      mockExecuteGeneratedCommands.mockResolvedValue({
        commands: [],
        explanation: 'Executed preview',
        status: 'executed',
        results: [
          {
            commandId: 'c1',
            type: 'createEntry',
            status: 'success',
            executedAt: new Date().toISOString(),
          },
        ],
      })

      const response = await app.handle(
        new Request('http://localhost/api/admin/ai/command', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ previewReceipt: 'receipt-123' }),
        })
      )

      expect(response.status).toBe(200)
      const body = (await response.json()) as AiCommandResponseBody
      expect(body.success).toBe(true)
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
  })

  describe('POST /workflow', () => {
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
      const body = (await response.json()) as AiCommandResponseBody
      expect(body.success).toBe(true)
      expect(body.data?.steps?.[0]?.status).toBe('completed')
    })

    it('handles workflow error and returns 400 AI_WORKFLOW_FAILED', async () => {
      mockRunAiWorkflow.mockRejectedValueOnce(new Error('Workflow execution error'))

      const response = await app.handle(
        new Request('http://localhost/api/admin/ai/workflow', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ workflow: 'bulk_update', prompt: 'publish drafts' }),
        })
      )

      expect(response.status).toBe(400)
      const body = (await response.json()) as AiCommandResponseBody
      expect(body.success).toBe(false)
      expect(body.error?.code).toBe('AI_WORKFLOW_FAILED')
    })
  })

  describe('AI import review routes', () => {
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

    describe('when ENABLE_AI_IMPORT_REVIEW is true', () => {
      beforeEach(() => {
        mockWorkerEnv.ENABLE_AI_IMPORT_REVIEW = 'true'
      })

      it('creates an import batch (201)', async () => {
        mockAiImportService.createBatch.mockResolvedValue({ id: 'b1', intent: 'import brochure' })

        const response = await app.handle(
          new Request('http://localhost/api/admin/ai/import-batches', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ intent: 'import brochure' }),
          })
        )

        expect(response.status).toBe(201)
        const body = (await response.json()) as AiCommandResponseBody
        expect(body.success).toBe(true)
        expect(mockAiImportService.createBatch).toHaveBeenCalled()
      })

      it('returns 400 when createBatch throws', async () => {
        mockAiImportService.createBatch.mockRejectedValue(new Error('invalid batch'))

        const response = await app.handle(
          new Request('http://localhost/api/admin/ai/import-batches', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ intent: 'bad batch' }),
          })
        )

        expect(response.status).toBe(400)
        const body = (await response.json()) as AiCommandResponseBody
        expect(body.err?.code).toBe('AI_IMPORT_BATCH_FAILED')
      })

      it('adds text and asset sources to an import batch', async () => {
        mockAiImportService.addSource.mockResolvedValue({ id: 'src-1' })

        // Text source
        const resText = await app.handle(
          new Request('http://localhost/api/admin/ai/import-batches/b1/sources', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ kind: 'text', text: 'some content' }),
          })
        )
        expect(resText.status).toBe(201)

        // Asset source
        const resAsset = await app.handle(
          new Request('http://localhost/api/admin/ai/import-batches/b1/sources', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ kind: 'asset', existingAssetId: 'a1' }),
          })
        )
        expect(resAsset.status).toBe(201)
      })

      it('adds file multipart source to an import batch', async () => {
        mockAiImportService.addSource.mockResolvedValue({ id: 'src-file' })

        const formData = new FormData()
        formData.append('file', new File(['hello'], 'test.txt', { type: 'text/plain' }))

        const response = await app.handle(
          new Request('http://localhost/api/admin/ai/import-batches/b1/sources', {
            method: 'POST',
            body: formData,
          })
        )

        expect(response.status).toBe(201)
      })

      it('handles multipart error when file is missing', async () => {
        const formData = new FormData()

        const response = await app.handle(
          new Request('http://localhost/api/admin/ai/import-batches/b1/sources', {
            method: 'POST',
            body: formData,
          })
        )

        expect(response.status).toBe(400)
        const body = (await response.json()) as AiCommandResponseBody
        expect(body.err?.code).toBe('AI_IMPORT_SOURCE_FAILED')
      })

      it('analyzes an import batch', async () => {
        mockAiImportService.analyze.mockResolvedValue({ status: 'analyzed' })

        const response = await app.handle(
          new Request('http://localhost/api/admin/ai/import-batches/b1/analyze', {
            method: 'POST',
          })
        )

        expect(response.status).toBe(200)
      })

      it('fetches batch detail and handles not found error', async () => {
        mockAiImportService.getBatchDetail.mockResolvedValueOnce({ id: 'b1' })

        const resFound = await app.handle(
          new Request('http://localhost/api/admin/ai/import-batches/b1?page=1&perPage=10')
        )
        expect(resFound.status).toBe(200)

        mockAiImportService.getBatchDetail.mockRejectedValueOnce(new Error('Batch missing'))
        const resNotFound = await app.handle(
          new Request('http://localhost/api/admin/ai/import-batches/b-missing')
        )
        expect(resNotFound.status).toBe(404)
      })

      it('updates a suggestion', async () => {
        mockAiImportService.updateSuggestion.mockResolvedValueOnce({ id: 's1', status: 'accepted' })

        const response = await app.handle(
          new Request('http://localhost/api/admin/ai/suggestions/s1', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ status: 'accepted' }),
          })
        )

        expect(response.status).toBe(200)

        mockAiImportService.updateSuggestion.mockRejectedValueOnce(new Error('Update failed'))
        const resFail = await app.handle(
          new Request('http://localhost/api/admin/ai/suggestions/s1', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ status: 'rejected' }),
          })
        )
        expect(resFail.status).toBe(400)
      })

      it('handles analyze error gracefully', async () => {
        mockAiImportService.analyze.mockRejectedValueOnce(new Error('Analyze failed'))
        const response = await app.handle(
          new Request('http://localhost/api/admin/ai/import-batches/b1/analyze', {
            method: 'POST',
          })
        )
        expect(response.status).toBe(400)
        const body = (await response.json()) as AiCommandResponseBody
        expect(body.success).toBe(false)
        expect(body.err?.code).toBe('AI_IMPORT_ANALYZE_FAILED')
      })

      it('handles getBatchDetail error when batch is not found', async () => {
        mockAiImportService.getBatchDetail.mockRejectedValueOnce(new Error('Not found'))
        const response = await app.handle(
          new Request('http://localhost/api/admin/ai/import-batches/b1', {
            method: 'GET',
          })
        )
        expect(response.status).toBe(404)
        const body = (await response.json()) as AiCommandResponseBody
        expect(body.success).toBe(false)
        expect(body.err?.code).toBe('AI_IMPORT_BATCH_NOT_FOUND')
      })

      it('performs dry-run and apply on suggestion sets', async () => {
        mockAiImportService.dryRunSuggestionSet.mockResolvedValueOnce({ dryRunHash: 'hash123' })
        const resDryRun = await app.handle(
          new Request('http://localhost/api/admin/ai/suggestion-sets/set1/dry-run', {
            method: 'POST',
          })
        )
        expect(resDryRun.status).toBe(200)

        mockAiImportService.dryRunSuggestionSet.mockRejectedValueOnce(new Error('Dry run failed'))
        const resDryRunFail = await app.handle(
          new Request('http://localhost/api/admin/ai/suggestion-sets/set1/dry-run', {
            method: 'POST',
          })
        )
        expect(resDryRunFail.status).toBe(400)
        const dryRunFailBody = (await resDryRunFail.json()) as AiCommandResponseBody
        expect(dryRunFailBody.err?.code).toBe('AI_IMPORT_DRY_RUN_FAILED')

        mockAiImportService.applySuggestionSet.mockResolvedValueOnce({ applied: true })
        const resApply = await app.handle(
          new Request('http://localhost/api/admin/ai/suggestion-sets/set1/apply', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ dryRunHash: 'hash123' }),
          })
        )
        expect(resApply.status).toBe(200)

        mockAiImportService.applySuggestionSet.mockRejectedValueOnce(new Error('Apply error'))
        const resApplyFail = await app.handle(
          new Request('http://localhost/api/admin/ai/suggestion-sets/set1/apply', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ dryRunHash: 'hash123' }),
          })
        )
        expect(resApplyFail.status).toBe(400)
      })
    })
  })
})
