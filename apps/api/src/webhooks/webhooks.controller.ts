import { env } from 'cloudflare:workers'
import { Elysia, t } from 'elysia'
import { betterAuthPlugin } from '@/auth/auth.middleware'
import type { Env } from '@/env'
import { hasTenantContext, resolveTenantBindings } from '@/tenants/tenant-context'
import { parseAllowedWebhookHosts } from './webhook-destination-policy'
import { webhooksService } from './webhooks.service'

const MAX_WEBHOOK_RETRIES = 5

type SecretBearingWebhook = {
  secret?: string
} & Record<string, unknown>

function redactWebhookSecret<T extends SecretBearingWebhook>(webhook: T): Omit<T, 'secret'> {
  const { secret: _secret, ...safe } = webhook
  return safe
}

function resolveWebhookDestinationPolicy(workerEnv: Partial<Env>) {
  return {
    allowedHosts: parseAllowedWebhookHosts(workerEnv.WEBHOOK_ALLOWED_HOSTS),
  }
}

/**
 * ElysiaJS controller for webhook CRUD endpoints.
 *
 * All routes are protected with `{ auth: true }` and return responses
 * in the standard API envelope format.
 *
 * Registered under `/api/admin/webhooks` in the main app.
 */
export const webhooksController = new Elysia({ prefix: '/api/admin/webhooks' })
  .use(betterAuthPlugin)

  /**
   * GET / — List all webhooks.
   */
  .get(
    '/',
    async (ctx) => {
      const workerEnv = env as unknown as Env
      const tenantCtx = hasTenantContext(ctx) ? ctx.tenant : undefined
      const { db } = resolveTenantBindings(tenantCtx, workerEnv)
      const result = await webhooksService.findAll(db, tenantCtx?.tenant.id)
      if (!result.success) {
        return { success: false as const, error: result.error }
      }
      return {
        success: true as const,
        data: result.data.map((webhook) => redactWebhookSecret(webhook)),
      }
    },
    { auth: true }
  )

  /**
   * POST / — Create a new webhook.
   */
  .post(
    '/',
    async (ctx) => {
      const workerEnv = env as unknown as Env
      const tenantCtx = hasTenantContext(ctx) ? ctx.tenant : undefined
      const { db } = resolveTenantBindings(tenantCtx, workerEnv)
      const result = await webhooksService.create(
        db,
        ctx.body,
        tenantCtx?.tenant.id,
        resolveWebhookDestinationPolicy(workerEnv)
      )
      if (!result.success) {
        ctx.set.status = 400
        return { success: false as const, error: result.error }
      }
      ctx.set.status = 201
      return { success: true as const, data: result.data }
    },
    {
      auth: true,
      body: t.Object({
        url: t.String({ minLength: 1 }),
        events: t.Array(t.String()),
        headers: t.Optional(t.Record(t.String(), t.String())),
        enabled: t.Optional(t.Boolean()),
        retryMaxRetries: t.Optional(t.Integer({ minimum: 1, maximum: MAX_WEBHOOK_RETRIES })),
        retryBackoff: t.Optional(t.Union([t.Literal('exponential'), t.Literal('linear')])),
        retryTimeout: t.Optional(t.Integer({ minimum: 5, maximum: 120 })),
      }),
    }
  )

  /**
   * GET /signing — Return webhook signature header documentation.
   */
  .get(
    '/signing',
    async () => {
      return {
        success: true as const,
        data: {
          algorithm: 'HMAC-SHA256',
          headers: ['x-edgecms-signature', 'x-webhook-signature'],
          format: 'sha256=<hex digest>',
          bodyEncoding: 'application/json',
        },
      }
    },
    { auth: true }
  )

  /**
   * GET /:webhookId — Get a webhook by ID.
   */
  .get(
    '/:webhookId',
    async (ctx) => {
      const workerEnv = env as unknown as Env
      const tenantCtx = hasTenantContext(ctx) ? ctx.tenant : undefined
      const { db } = resolveTenantBindings(tenantCtx, workerEnv)
      const result = await webhooksService.findById(db, ctx.params.webhookId, tenantCtx?.tenant.id)
      if (!result.success) {
        return { success: false as const, error: result.error }
      }
      return { success: true as const, data: redactWebhookSecret(result.data) }
    },
    { auth: true }
  )

  /**
   * PUT /:webhookId — Update a webhook by ID.
   */
  .put(
    '/:webhookId',
    async (ctx) => {
      const workerEnv = env as unknown as Env
      const tenantCtx = hasTenantContext(ctx) ? ctx.tenant : undefined
      const { db } = resolveTenantBindings(tenantCtx, workerEnv)
      const result = await webhooksService.update(
        db,
        ctx.params.webhookId,
        ctx.body,
        tenantCtx?.tenant.id,
        resolveWebhookDestinationPolicy(workerEnv)
      )
      if (!result.success) {
        ctx.set.status = result.error.code === 'NOT_FOUND' ? 404 : 400
        return { success: false as const, error: result.error }
      }
      return { success: true as const, data: redactWebhookSecret(result.data) }
    },
    {
      auth: true,
      body: t.Object({
        url: t.Optional(t.String({ minLength: 1 })),
        events: t.Optional(t.Array(t.String())),
        headers: t.Optional(t.Record(t.String(), t.String())),
        enabled: t.Optional(t.Boolean()),
        retryMaxRetries: t.Optional(t.Integer({ minimum: 1, maximum: MAX_WEBHOOK_RETRIES })),
        retryBackoff: t.Optional(t.Union([t.Literal('exponential'), t.Literal('linear')])),
        retryTimeout: t.Optional(t.Integer({ minimum: 5, maximum: 120 })),
      }),
    }
  )

  /**
   * DELETE /:webhookId — Delete a webhook by ID.
   */
  .delete(
    '/:webhookId',
    async (ctx) => {
      const workerEnv = env as unknown as Env
      const tenantCtx = hasTenantContext(ctx) ? ctx.tenant : undefined
      const { db } = resolveTenantBindings(tenantCtx, workerEnv)
      const result = await webhooksService.deleteById(
        db,
        ctx.params.webhookId,
        tenantCtx?.tenant.id
      )
      if (!result.success) {
        ctx.set.status = 404
        return { success: false as const, error: result.error }
      }
      return { success: true as const, data: result.data }
    },
    { auth: true }
  )

  /**
   * POST /:webhookId/test — Send a test delivery to the webhook.
   */
  .post(
    '/:webhookId/test',
    async (ctx) => {
      const workerEnv = env as unknown as Env
      const tenantCtx = hasTenantContext(ctx) ? ctx.tenant : undefined
      const { db } = resolveTenantBindings(tenantCtx, workerEnv)
      const result = await webhooksService.testDelivery(
        db,
        ctx.params.webhookId,
        tenantCtx?.tenant.id
      )
      if (!result.success) {
        ctx.set.status = result.error.code === 'NOT_FOUND' ? 404 : 500
        return { success: false as const, error: result.error }
      }
      return { success: true as const, data: result.data }
    },
    { auth: true }
  )

  /**
   * GET /:webhookId/deliveries — List delivery logs for a webhook (paginated).
   */
  .get(
    '/:webhookId/deliveries',
    async (ctx) => {
      const workerEnv = env as unknown as Env
      const tenantCtx = hasTenantContext(ctx) ? ctx.tenant : undefined
      const { db } = resolveTenantBindings(tenantCtx, workerEnv)
      const { params, query } = ctx

      const result = await webhooksService.getDeliveries(db, params.webhookId, tenantCtx?.tenant.id, {
        limit: query.limit,
        offset: query.offset,
      })
      if (!result.success) {
        return { success: false as const, error: result.error }
      }
      return { success: true as const, data: result.data }
    },
    {
      auth: true,
      query: t.Object({
        limit: t.Optional(t.Number({ minimum: 1, maximum: 200, default: 50 })),
        offset: t.Optional(t.Number({ minimum: 0, default: 0 })),
      }),
    }
  )
