import { env } from 'cloudflare:workers'
import { Elysia, t } from 'elysia'
import { betterAuthPlugin } from '@/auth/auth.middleware'
import type { Env } from '@/env'
import { hasTenantContext, resolveTenantBindings } from '@/tenants/tenant-context'
import { executeGeneratedCommands, runAiWorkflow } from './ai.service'
import { aiImportService } from './imports.service'
import { getRequestPathname } from '@/shared/utils/request-url'

function isAiImportReviewEnabled(workerEnv: Env) {
  return workerEnv.ENABLE_AI_IMPORT_REVIEW === 'true'
}

function aiImportReviewDisabled(set: { status?: unknown }) {
  set.status = 404
  return {
    success: false as const,
    err: {
      code: 'AI_IMPORT_REVIEW_DISABLED',
      msg: 'AI import review is post-launch and disabled in this environment.',
    },
  }
}

/**
 * AI Controller
 *
 * Provides API endpoints for AI-powered command generation.
 * Converts natural language input into structured commands that can be
 * previewed (dry-run) or executed immediately.
 *
 * Routes:
 *   POST /api/admin/ai/command — Generate and optionally execute commands from natural language
 *
 * Security: All routes are auth-protected. The authenticated user's ID is used
 * for the actor.userId in generated commands.
 */
export const aiController = new Elysia({ prefix: '/api/admin/ai' })
  .use(betterAuthPlugin)

  /**
   * POST /command — Generate commands from natural language.
   *
   * Accepts a natural language prompt and optional context (collection/entry),
   * uses AI to generate structured commands, and either returns them for preview
   * (dryRun: true) or executes them immediately (dryRun: false).
   *
   * Request body:
   *   - prompt: Natural language input (e.g., "create a blog post about AI")
   *   - context: Optional collection slug or entry ID for context
   *   - dryRun: If true, return commands without executing (default: false)
   *
   * Response:
   *   - commands: Array of generated command envelopes
   *   - explanation: Natural language explanation of what the AI will do
   *   - results: Array of execution results (only if dryRun is false)
   *
   * Error handling:
   *   - 400 Bad Request: Invalid input or AI generation failure
   *   - 500 Internal Server Error: Command execution failure
   */
  .post(
    '/command',
    async (elysiaCtx) => {
      const { body, user, set } = elysiaCtx
      const requestPathname = getRequestPathname(elysiaCtx.request)
      const workerEnv = env as unknown as Env
      const tenantCtx = hasTenantContext(elysiaCtx) ? elysiaCtx.tenant : undefined
      const { db, kv } = resolveTenantBindings(tenantCtx, workerEnv)

      if (!body.prompt && !body.previewReceipt) {
        set.status = 400
        return {
          success: false as const,
          error: {
            code: 'INVALID_INPUT',
            message: 'Either prompt or previewReceipt is required',
          },
        }
      }

      try {
        const result = await executeGeneratedCommands({
          prompt: body.prompt,
          previewReceipt: body.previewReceipt,
          dryRun: body.dryRun,
          userId: user.id,
          db,
          kv,
          env: workerEnv,
          context: body.context,
          metadata: {
            tenantId: tenantCtx?.tenant.id,
            tenantSlug: tenantCtx?.tenant.slug,
            requestIntent: 'command_generation',
            routeClass: 'admin_ai',
          },
          hookContext: {
            requestId:
              (elysiaCtx as unknown as { requestId?: string }).requestId ?? crypto.randomUUID(),
            pathname: requestPathname,
            method: elysiaCtx.request.method,
          },
        })

        if (result.status === 'dry_run') {
          return {
            success: true as const,
            data: {
              commands: result.commands,
              explanation: result.explanation,
              previewReceipt: result.previewReceipt,
            },
          }
        }

        if (result.status === 'failed') {
          set.status = 500
          return {
            success: false as const,
            error: {
              code: 'EXECUTION_FAILED',
              message: 'One or more commands failed during execution',
            },
            data: {
              commands: result.commands,
              explanation: result.explanation,
              results: result.results ?? [],
              previewReceipt: result.previewReceipt,
            },
          }
        }

        return {
          success: true as const,
          data: {
            commands: result.commands,
            explanation: result.explanation,
            results: result.results ?? [],
            previewReceipt: result.previewReceipt,
          },
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'

        set.status = 400
        return {
          success: false as const,
          error: {
            code: 'AI_GENERATION_FAILED',
            message,
          },
        }
      }
    },
    {
      auth: true,
      body: t.Object({
        prompt: t.Optional(t.String({ minLength: 1 })),
        previewReceipt: t.Optional(t.String()),
        context: t.Optional(
          t.Object({
            collectionSlug: t.Optional(t.String()),
            entryId: t.Optional(t.String()),
          })
        ),
        dryRun: t.Optional(t.Boolean()),
      }),
    }
  )
  .post(
    '/import-batches',
    async (elysiaCtx) => {
      const { body, user, set } = elysiaCtx
      const workerEnv = env as unknown as Env
      if (!isAiImportReviewEnabled(workerEnv)) return aiImportReviewDisabled(set)
      const tenantCtx = hasTenantContext(elysiaCtx) ? elysiaCtx.tenant : undefined
      const { db } = resolveTenantBindings(tenantCtx, workerEnv)

      try {
        const batch = await aiImportService.createBatch(
          db,
          {
            intent: body.intent,
            targetCollectionSlug: body.targetCollectionSlug,
            targetEntryId: body.targetEntryId,
            sourceLocale: body.sourceLocale,
            targetLocales: body.targetLocales,
          },
          user.id,
          tenantCtx?.tenant.id
        )
        set.status = 201
        return { success: true as const, data: { batch } }
      } catch (err) {
        set.status = 400
        return {
          success: false as const,
          err: {
            code: 'AI_IMPORT_BATCH_FAILED',
            msg: err instanceof Error ? err.message : 'Import batch creation failed',
          },
        }
      }
    },
    {
      auth: true,
      body: t.Object({
        intent: t.String({ minLength: 1 }),
        targetCollectionSlug: t.Optional(t.String()),
        targetEntryId: t.Optional(t.String()),
        sourceLocale: t.Optional(t.String()),
        targetLocales: t.Optional(t.Array(t.String())),
      }),
    }
  )
  .post(
    '/import-batches/:batchId/sources',
    async (elysiaCtx) => {
      const { params, request, set } = elysiaCtx
      const workerEnv = env as unknown as Env
      if (!isAiImportReviewEnabled(workerEnv)) return aiImportReviewDisabled(set)
      const tenantCtx = hasTenantContext(elysiaCtx) ? elysiaCtx.tenant : undefined
      const { db } = resolveTenantBindings(tenantCtx, workerEnv)

      try {
        const contentType = request.headers.get('content-type') ?? ''
        if (contentType.includes('multipart/form-data')) {
          const form = await request.formData()
          const file = form.get('file')
          if (!(file instanceof File)) throw new Error('File is required')
          const source = await aiImportService.addSource(
            db,
            workerEnv,
            params.batchId,
            { kind: 'file', file },
            tenantCtx?.tenant.id
          )
          set.status = 201
          return { success: true as const, data: { source } }
        }

        const payload = (await request.json()) as
          | { kind?: 'text'; text?: string }
          | { kind?: 'asset'; existingAssetId?: string }
        const source =
          payload.kind === 'asset'
            ? await aiImportService.addSource(
                db,
                workerEnv,
                params.batchId,
                { kind: 'asset', existingAssetId: payload.existingAssetId ?? '' },
                tenantCtx?.tenant.id
              )
            : await aiImportService.addSource(
                db,
                workerEnv,
                params.batchId,
                {
                  kind: 'text',
                  text: 'text' in payload && typeof payload.text === 'string' ? payload.text : '',
                },
                tenantCtx?.tenant.id
              )
        set.status = 201
        return { success: true as const, data: { source } }
      } catch (err) {
        set.status = 400
        return {
          success: false as const,
          err: {
            code: 'AI_IMPORT_SOURCE_FAILED',
            msg: err instanceof Error ? err.message : 'Import source upload failed',
          },
        }
      }
    },
    { auth: true, params: t.Object({ batchId: t.String({ minLength: 1 }) }) }
  )
  .post(
    '/import-batches/:batchId/analyze',
    async (elysiaCtx) => {
      const { params, set } = elysiaCtx
      const workerEnv = env as unknown as Env
      if (!isAiImportReviewEnabled(workerEnv)) return aiImportReviewDisabled(set)
      const tenantCtx = hasTenantContext(elysiaCtx) ? elysiaCtx.tenant : undefined
      const { db } = resolveTenantBindings(tenantCtx, workerEnv)
      try {
        const result = await aiImportService.analyze(db, params.batchId, tenantCtx?.tenant.id)
        return { success: true as const, data: result }
      } catch (err) {
        set.status = 400
        return {
          success: false as const,
          err: {
            code: 'AI_IMPORT_ANALYZE_FAILED',
            msg: err instanceof Error ? err.message : 'Import analysis failed',
          },
        }
      }
    },
    { auth: true, params: t.Object({ batchId: t.String({ minLength: 1 }) }) }
  )
  .get(
    '/import-batches/:batchId',
    async (elysiaCtx) => {
      const { params, query, set } = elysiaCtx
      const workerEnv = env as unknown as Env
      if (!isAiImportReviewEnabled(workerEnv)) return aiImportReviewDisabled(set)
      const tenantCtx = hasTenantContext(elysiaCtx) ? elysiaCtx.tenant : undefined
      const { db } = resolveTenantBindings(tenantCtx, workerEnv)
      try {
        const detail = await aiImportService.getBatchDetail(db, params.batchId, tenantCtx?.tenant.id, {
          page: query.page ? Number(query.page) : undefined,
          perPage: query.perPage ? Number(query.perPage) : undefined,
          status: query.status,
        })
        return { success: true as const, data: detail }
      } catch (err) {
        set.status = 404
        return {
          success: false as const,
          err: {
            code: 'AI_IMPORT_BATCH_NOT_FOUND',
            msg: err instanceof Error ? err.message : 'Import batch was not found',
          },
        }
      }
    },
    {
      auth: true,
      params: t.Object({ batchId: t.String({ minLength: 1 }) }),
      query: t.Object({
        page: t.Optional(t.String()),
        perPage: t.Optional(t.String()),
        status: t.Optional(t.String()),
      }),
    }
  )
  .patch(
    '/suggestions/:suggestionId',
    async (elysiaCtx) => {
      const { params, body, set } = elysiaCtx
      const workerEnv = env as unknown as Env
      if (!isAiImportReviewEnabled(workerEnv)) return aiImportReviewDisabled(set)
      const tenantCtx = hasTenantContext(elysiaCtx) ? elysiaCtx.tenant : undefined
      const { db } = resolveTenantBindings(tenantCtx, workerEnv)
      try {
        const suggestion = await aiImportService.updateSuggestion(
          db,
          params.suggestionId,
          tenantCtx?.tenant.id,
          {
            status: body.status,
            editedValue: body.editedValue,
          }
        )
        return { success: true as const, data: { suggestion } }
      } catch (err) {
        set.status = 400
        return {
          success: false as const,
          err: {
            code: 'AI_IMPORT_SUGGESTION_FAILED',
            msg: err instanceof Error ? err.message : 'Suggestion update failed',
          },
        }
      }
    },
    {
      auth: true,
      params: t.Object({ suggestionId: t.String({ minLength: 1 }) }),
      body: t.Object({
        status: t.Optional(t.Union([t.Literal('pending'), t.Literal('accepted'), t.Literal('rejected')])),
        editedValue: t.Optional(t.Unknown()),
      }),
    }
  )
  .post(
    '/suggestion-sets/:suggestionSetId/dry-run',
    async (elysiaCtx) => {
      const { params, user, set } = elysiaCtx
      const requestPathname = getRequestPathname(elysiaCtx.request)
      const workerEnv = env as unknown as Env
      if (!isAiImportReviewEnabled(workerEnv)) return aiImportReviewDisabled(set)
      const tenantCtx = hasTenantContext(elysiaCtx) ? elysiaCtx.tenant : undefined
      const { db, kv } = resolveTenantBindings(tenantCtx, workerEnv)
      try {
        const result = await aiImportService.dryRunSuggestionSet(
          db,
          kv,
          params.suggestionSetId,
          user.id,
          tenantCtx?.tenant.id,
          {
            requestId: (elysiaCtx as unknown as { requestId?: string }).requestId ?? crypto.randomUUID(),
            pathname: requestPathname,
            method: elysiaCtx.request.method,
          }
        )
        return { success: true as const, data: result }
      } catch (err) {
        set.status = 400
        return {
          success: false as const,
          err: {
            code: 'AI_IMPORT_DRY_RUN_FAILED',
            msg: err instanceof Error ? err.message : 'Suggestion dry-run failed',
          },
        }
      }
    },
    { auth: true, params: t.Object({ suggestionSetId: t.String({ minLength: 1 }) }) }
  )
  .post(
    '/suggestion-sets/:suggestionSetId/apply',
    async (elysiaCtx) => {
      const { params, body, user, set } = elysiaCtx
      const requestPathname = getRequestPathname(elysiaCtx.request)
      const workerEnv = env as unknown as Env
      if (!isAiImportReviewEnabled(workerEnv)) return aiImportReviewDisabled(set)
      const tenantCtx = hasTenantContext(elysiaCtx) ? elysiaCtx.tenant : undefined
      const { db, kv } = resolveTenantBindings(tenantCtx, workerEnv)
      try {
        const result = await aiImportService.applySuggestionSet(
          db,
          kv,
          params.suggestionSetId,
          body.dryRunHash,
          user.id,
          tenantCtx?.tenant.id,
          {
            requestId: (elysiaCtx as unknown as { requestId?: string }).requestId ?? crypto.randomUUID(),
            pathname: requestPathname,
            method: elysiaCtx.request.method,
          }
        )
        return { success: true as const, data: result }
      } catch (err) {
        set.status = 400
        return {
          success: false as const,
          err: {
            code: 'AI_IMPORT_APPLY_FAILED',
            msg: err instanceof Error ? err.message : 'Suggestion apply failed',
          },
        }
      }
    },
    {
      auth: true,
      params: t.Object({ suggestionSetId: t.String({ minLength: 1 }) }),
      body: t.Object({ dryRunHash: t.String({ minLength: 1 }) }),
    }
  )
  .post(
    '/workflow',
    async (elysiaCtx) => {
      const { body, set } = elysiaCtx
      const requestPathname = getRequestPathname(elysiaCtx.request)
      const workerEnv = env as unknown as Env
      const tenantCtx = hasTenantContext(elysiaCtx) ? elysiaCtx.tenant : undefined
      const { db } = resolveTenantBindings(tenantCtx, workerEnv)

      try {
        const result = await runAiWorkflow({
          workflow: body.workflow,
          prompt: body.prompt,
          context: body.context,
          db,
          env: workerEnv,
          metadata: {
            tenantId: tenantCtx?.tenant.id,
            tenantSlug: tenantCtx?.tenant.slug,
            requestIntent: `workflow:${body.workflow}`,
            routeClass: 'admin_ai_workflow',
          },
          hookContext: {
            requestId:
              (elysiaCtx as unknown as { requestId?: string }).requestId ?? crypto.randomUUID(),
            pathname: requestPathname,
            method: elysiaCtx.request.method,
          },
        })

        return {
          success: true as const,
          data: result,
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        set.status = 400
        return {
          success: false as const,
          error: {
            code: 'AI_WORKFLOW_FAILED',
            message,
          },
        }
      }
    },
    {
      auth: true,
      body: t.Object({
        workflow: t.Union([
          t.Literal('bulk_update'),
          t.Literal('bulk_localization'),
          t.Literal('transaction_builder'),
        ]),
        prompt: t.String({ minLength: 1 }),
        context: t.Optional(
          t.Object({
            collectionSlug: t.Optional(t.String()),
            entryId: t.Optional(t.String()),
          })
        ),
      }),
    }
  )
