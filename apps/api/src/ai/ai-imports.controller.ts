import { Elysia, t } from 'elysia'
import { betterAuthPlugin } from '@/auth/auth.middleware'
import type { Env } from '@/env'
import { withTenantBindings } from '@/tenants/with-tenant-bindings'
import { aiImportService } from './imports.service'
import { getRequestPathname } from '@/shared/utils/request-url'

export function isAiImportReviewEnabled(workerEnv: Env) {
  return workerEnv.ENABLE_AI_IMPORT_REVIEW === 'true'
}

export function aiImportReviewDisabled(set: { status?: unknown }) {
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
 * Controller for AI-assisted content import reviews, suggestion sets, and approval flows.
 */
export const aiImportsController = new Elysia()
  .use(betterAuthPlugin)
  .use(withTenantBindings)

  .post('/import-batches', {
    auth: true,
    body: t.Object({
      intent: t.String({ minLength: 1 }),
      targetCollectionSlug: t.Optional(t.String()),
      targetEntryId: t.Optional(t.String()),
      sourceLocale: t.Optional(t.String()),
      targetLocales: t.Optional(t.Array(t.String())),
    }),
  }, async ({ body, user, set, workerEnv, tenantCtx, db }) => {
    if (!isAiImportReviewEnabled(workerEnv)) return aiImportReviewDisabled(set)

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
  })

  .post('/import-batches/:batchId/sources', {
    auth: true,
    params: t.Object({ batchId: t.String({ minLength: 1 }) }),
  }, async (elysiaCtx) => {
    const { params, request, set, workerEnv, tenantCtx, db } = elysiaCtx
    if (!isAiImportReviewEnabled(workerEnv)) return aiImportReviewDisabled(set)

    try {
      const contentType = request.headers.get('content-type') ?? ''
      if (contentType.includes('multipart/form-data')) {
        let file: unknown = (elysiaCtx.body as { file?: unknown } | undefined)?.file
        if (!(file instanceof File)) {
          try {
            const form = await request.formData()
            file = form.get('file')
          } catch {
            // Body may already be parsed
          }
        }
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

      let payload = elysiaCtx.body as
        | { kind?: 'text'; text?: string }
        | { kind?: 'asset'; existingAssetId?: string }
        | undefined
      if (!payload || typeof payload !== 'object') {
        try {
          payload = (await request.json()) as typeof payload
        } catch {
          // Body may already be parsed
        }
      }

      const safePayload = payload ?? {}
      const source =
        safePayload.kind === 'asset'
          ? await aiImportService.addSource(
              db,
              workerEnv,
              params.batchId,
              { kind: 'asset', existingAssetId: safePayload.existingAssetId ?? '' },
              tenantCtx?.tenant.id
            )
          : await aiImportService.addSource(
              db,
              workerEnv,
              params.batchId,
              {
                kind: 'text',
                text: 'text' in safePayload && typeof safePayload.text === 'string' ? safePayload.text : '',
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
  })

  .post('/import-batches/:batchId/analyze', {
    auth: true,
    params: t.Object({ batchId: t.String({ minLength: 1 }) }),
  }, async ({ params, set, workerEnv, tenantCtx, db }) => {
    if (!isAiImportReviewEnabled(workerEnv)) return aiImportReviewDisabled(set)
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
  })

  .get('/import-batches/:batchId', {
    auth: true,
    params: t.Object({ batchId: t.String({ minLength: 1 }) }),
    query: t.Object({
      page: t.Optional(t.String()),
      perPage: t.Optional(t.String()),
      status: t.Optional(t.String()),
    }),
  }, async ({ params, query, set, workerEnv, tenantCtx, db }) => {
    if (!isAiImportReviewEnabled(workerEnv)) return aiImportReviewDisabled(set)
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
  })

  .patch('/suggestions/:suggestionId', {
    auth: true,
    params: t.Object({ suggestionId: t.String({ minLength: 1 }) }),
    body: t.Object({
      status: t.Optional(t.Union([t.Literal('pending'), t.Literal('accepted'), t.Literal('rejected')])),
      editedValue: t.Optional(t.Unknown()),
    }),
  }, async ({ params, body, set, workerEnv, tenantCtx, db }) => {
    if (!isAiImportReviewEnabled(workerEnv)) return aiImportReviewDisabled(set)
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
  })

  .post('/suggestion-sets/:suggestionSetId/dry-run', {
    auth: true,
    params: t.Object({ suggestionSetId: t.String({ minLength: 1 }) }),
  }, async (elysiaCtx) => {
    const { params, user, set, request, workerEnv, tenantCtx, db, kv } = elysiaCtx
    const requestPathname = getRequestPathname(request)
    if (!isAiImportReviewEnabled(workerEnv)) return aiImportReviewDisabled(set)
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
          method: request.method,
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
  })

  .post('/suggestion-sets/:suggestionSetId/apply', {
    auth: true,
    params: t.Object({ suggestionSetId: t.String({ minLength: 1 }) }),
    body: t.Object({ dryRunHash: t.String({ minLength: 1 }) }),
  }, async (elysiaCtx) => {
    const { params, body, user, set, request, workerEnv, tenantCtx, db, kv } = elysiaCtx
    const requestPathname = getRequestPathname(request)
    if (!isAiImportReviewEnabled(workerEnv)) return aiImportReviewDisabled(set)
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
          method: request.method,
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
  })
