import { env } from 'cloudflare:workers'
import { Elysia, t } from 'elysia'
import { resolveAuthPolicies } from '@/auth/auth-policies'
import { betterAuthPlugin } from '@/auth/auth.middleware'
import { superAdminRoute } from '@/tenants/tenants.controller'
import type { Env } from '@/env'
import { logger } from '@/observability/logger'
import { getRequestUrl } from '@/shared/utils/request-url'
import { toServiceResponse } from '@/shared/utils/service-response'
import { withTenantBindings } from '@/tenants/with-tenant-bindings'
import { MAX_INVITE_TTL_HOURS, invitesService } from './invites.service'

/**
 * Super-admin endpoints for single-use sign-up invites (PRD HS-01).
 * Registered under `/api/admin/invites`. Invites only matter when
 * `SIGNUP_POLICY=invite-only`.
 */
export const invitesController = new Elysia({ prefix: '/api/admin/invites' })
  .use(betterAuthPlugin)
  .use(withTenantBindings)

  /** GET / — List the most recent invites (token hashes are never returned). */
  .get('/', superAdminRoute, async ({ db, set }) => {
    return toServiceResponse(set, await invitesService.list(db))
  })

  /**
   * POST / — Create an invite. The token is returned once; when an email
   * sender is configured the invite link is also emailed.
   */
  .post(
    '/',
    {
      ...superAdminRoute,
      body: t.Object({
        email: t.String({ format: 'email', maxLength: 320 }),
        tenantSlug: t.Optional(t.String({ minLength: 1 })),
        tenantRole: t.Optional(
          t.Union([t.Literal('owner'), t.Literal('admin'), t.Literal('member')])
        ),
        expiresInHours: t.Optional(t.Number({ minimum: 1, maximum: MAX_INVITE_TTL_HOURS })),
      }),
    },
    async ({ db, body, set, user, request }) => {
      const result = await invitesService.create(db, { ...body, createdBy: user.id })
      if (!result.success) return toServiceResponse(set, result)

      const signUpPath = `/sign-up?invite=${encodeURIComponent(result.data.token)}`
      const sender = resolveAuthPolicies(env as unknown as Env).emailSender
      let emailed = false
      if (sender) {
        const url = `${getRequestUrl(request).origin}${signUpPath}`
        try {
          await sender.send({
            to: result.data.invite.email,
            subject: 'You have been invited to EdgeCMS',
            text: `You have been invited to create an EdgeCMS account.\n\nOpen this link to sign up:\n\n${url}\n\nThe invite works once and expires at ${result.data.invite.expiresAt}.`,
          })
          emailed = true
        } catch (err) {
          logger.warn('invite_email_failed', {
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }

      set.status = 201
      return {
        success: true as const,
        data: { ...result.data, signUpPath, emailed },
      }
    }
  )

  /** DELETE /:inviteId — Revoke an unused invite. */
  .delete(
    '/:inviteId',
    {
      ...superAdminRoute,
      params: t.Object({ inviteId: t.String({ minLength: 1 }) }),
    },
    async ({ db, params, set }) => {
      return toServiceResponse(set, await invitesService.revoke(db, params.inviteId))
    }
  )
