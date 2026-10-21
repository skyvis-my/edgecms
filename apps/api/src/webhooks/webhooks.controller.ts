import { Elysia, t } from 'elysia'
import { isSuperAdminUser } from '@/auth/super-admin'
import { betterAuthPlugin } from '@/auth/auth.middleware'
import { withTenantBindings } from '@/tenants/with-tenant-bindings'
import { parseAllowedWebhookHosts } from './webhook-destination-policy'
import { webhooksService } from './webhooks.service'
import { toServiceResponse } from '@/shared/utils/service-response'

const MAX_WEBHOOK_RETRIES = 5

type SecretBearingWebhook = {
  secret?: string
} & Record<string, unknown>

function redactWebhookSecret<T extends SecretBearingWebhook>(webhook: T): Omit<T, 'secret'> {
  const { secret: _secret, ...safe } = webhook
  return safe
}

function resolveWebhookDestinationPolicy(workerEnv: { WEBHOOK_ALLOWED_HOSTS?: string }) {
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
  .use(withTenantBindings)

  /**
   * GET / — List all webhooks.
   */
  .get('/', { auth: true }, async ({ db, tenantCtx }) => {
    const result = await webhooksService.findAll(db, tenantCtx?.tenant.id)
    if (!result.success) {
      return { success: false as const, error: result.error }
    }
    return {
      success: true as const,
      data: result.data.map((webhook) => redactWebhookSecret(webhook)),
    }
  })

  /**
   * POST / — Create a new webhook.
   */
  .post('/', {
    auth: true,
    body: t.Object({
      url: t.String({ minLength: 1 }),
      events: t.Array(t.String()),
      headers: t.Optional(t.Record(t.String(), t.String(), { properties: {} })),
      enabled: t.Optional(t.Boolean()),
      retryMaxRetries: t.Optional(t.Integer({ minimum: 1, maximum: MAX_WEBHOOK_RETRIES })),
      retryBackoff: t.Optional(t.Union([t.Literal('exponential'), t.Literal('linear')])),
      retryTimeout: t.Optional(t.Integer({ minimum: 5, maximum: 120 })),
    }),
  }, async ({ db, body, set, workerEnv, tenantCtx, user }) => {
    const result = await webhooksService.create(
      db,
      body,
      tenantCtx?.tenant.id,
      resolveWebhookDestinationPolicy(workerEnv),
      { allowTenantLifecycleEvents: isSuperAdminUser(user, workerEnv) }
    )
    return toServiceResponse(set, result, { successStatus: 201, defaultErrorStatus: 400 })
  })

  /**
   * GET /signing — Return webhook signature header documentation.
   */
  .get('/signing', { auth: true }, async () => {
    return {
      success: true as const,
      data: {
        algorithm: 'HMAC-SHA256',
        headers: ['x-edgecms-signature', 'x-webhook-signature'],
        format: 'sha256=<hex digest>',
        bodyEncoding: 'application/json',
      },
    }
  })

  /**
   * GET /:webhookId — Get a webhook by ID.
   */
  .get('/:webhookId', { auth: true }, async ({ db, params, tenantCtx }) => {
    const result = await webhooksService.findById(db, params.webhookId, tenantCtx?.tenant.id)
    if (!result.success) {
      return { success: false as const, error: result.error }
    }
    return { success: true as const, data: redactWebhookSecret(result.data) }
  })

  /**
   * PUT /:webhookId — Update a webhook by ID.
   */
  .put('/:webhookId', {
    auth: true,
    body: t.Object({
      url: t.Optional(t.String({ minLength: 1 })),
      events: t.Optional(t.Array(t.String())),
      headers: t.Optional(t.Record(t.String(), t.String(), { properties: {} })),
      enabled: t.Optional(t.Boolean()),
      retryMaxRetries: t.Optional(t.Integer({ minimum: 1, maximum: MAX_WEBHOOK_RETRIES })),
      retryBackoff: t.Optional(t.Union([t.Literal('exponential'), t.Literal('linear')])),
      retryTimeout: t.Optional(t.Integer({ minimum: 5, maximum: 120 })),
    }),
  }, async ({ db, params, body, set, workerEnv, tenantCtx, user }) => {
    const result = await webhooksService.update(
      db,
      params.webhookId,
      body,
      tenantCtx?.tenant.id,
      resolveWebhookDestinationPolicy(workerEnv),
      { allowTenantLifecycleEvents: isSuperAdminUser(user, workerEnv) }
    )
    if (!result.success) {
      return toServiceResponse(set, result)
    }
    return { success: true as const, data: redactWebhookSecret(result.data) }
  })

  /**
   * DELETE /:webhookId — Delete a webhook by ID.
   */
  .delete('/:webhookId', { auth: true }, async ({ db, params, set, tenantCtx }) => {
    const result = await webhooksService.deleteById(
      db,
      params.webhookId,
      tenantCtx?.tenant.id
    )
    return toServiceResponse(set, result, { defaultErrorStatus: 404 })
  })

  /**
   * POST /:webhookId/test — Send a test delivery to the webhook.
   */
  .post('/:webhookId/test', { auth: true }, async ({ db, params, set, tenantCtx }) => {
    const result = await webhooksService.testDelivery(
      db,
      params.webhookId,
      tenantCtx?.tenant.id
    )
    return toServiceResponse(set, result, { defaultErrorStatus: 500 })
  })

  /**
   * GET /:webhookId/deliveries — List delivery logs for a webhook (paginated).
   */
  .get('/:webhookId/deliveries', {
    auth: true,
    query: t.Object({
      limit: t.Optional(t.Number({ minimum: 1, maximum: 200, default: 50 })),
      offset: t.Optional(t.Number({ minimum: 0, default: 0 })),
    }),
  }, async ({ db, params, query, tenantCtx }) => {
    const result = await webhooksService.getDeliveries(db, params.webhookId, tenantCtx?.tenant.id, {
      limit: query.limit !== undefined ? Number(query.limit) : undefined,
      offset: query.offset !== undefined ? Number(query.offset) : undefined,
    })
    if (!result.success) {
      return { success: false as const, error: result.error }
    }
    return { success: true as const, data: result.data }
  })
