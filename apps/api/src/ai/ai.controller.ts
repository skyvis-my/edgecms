import { Elysia, t } from 'elysia'
import { betterAuthPlugin } from '@/auth/auth.middleware'
import { withTenantBindings } from '@/tenants/with-tenant-bindings'
import { executeGeneratedCommands, runAiWorkflow } from './ai.service'
import { aiImportsController, isAiImportReviewEnabled, aiImportReviewDisabled } from './ai-imports.controller'
import { getRequestPathname } from '@/shared/utils/request-url'
import { createErrorEnvelope } from '@/shared/utils/service-response'

export { isAiImportReviewEnabled, aiImportReviewDisabled }

/**
 * AI Controller
 *
 * Provides API endpoints for AI-powered command generation and multi-step workflows.
 * Mounts AI content import review routes from aiImportsController.
 *
 * Routes:
 *   POST /api/admin/ai/command — Generate and optionally execute commands from natural language
 *   POST /api/admin/ai/workflow — Execute multi-step AI workflows (bulk update, translation, transaction)
 *   POST /api/admin/ai/import-batches — Create and manage AI import review batches
 *   ... (see aiImportsController)
 *
 * Security: All routes are auth-protected. The authenticated user's ID is used
 * for the actor.userId in generated commands.
 */
export const aiController = new Elysia({ prefix: '/api/admin/ai' })
  .use(betterAuthPlugin)
  .use(withTenantBindings)
  .use(aiImportsController)

  /**
   * POST /command — Generate commands from natural language.
   *
   * Accepts a natural language prompt and optional context (collection/entry),
   * uses AI to generate structured commands, and either returns them for preview
   * (dryRun: true) or executes them immediately (dryRun: false).
   */
  .post('/command', {
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
  }, async (elysiaCtx) => {
    const { body, user, set, workerEnv, tenantCtx, db, kv } = elysiaCtx
    const requestPathname = getRequestPathname(elysiaCtx.request)

    const prompt = body.prompt?.trim()
    const previewReceipt = body.previewReceipt?.trim()
    if (!prompt && !previewReceipt) {
      set.status = 400
      return createErrorEnvelope('INVALID_INPUT', 'Either prompt or previewReceipt is required')
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
      return createErrorEnvelope('AI_GENERATION_FAILED', message)
    }
  })

  /**
   * POST /workflow — Execute multi-step AI workflows.
   */
  .post('/workflow', {
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
  }, async (elysiaCtx) => {
    const { body, set, workerEnv, tenantCtx, db } = elysiaCtx
    const requestPathname = getRequestPathname(elysiaCtx.request)

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
      return createErrorEnvelope('AI_WORKFLOW_FAILED', message)
    }
  })
