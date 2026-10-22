import { Elysia } from 'elysia'
import { betterAuthPlugin } from '@/auth/auth.middleware'
import { createAuthForEnv } from '@/auth/auth'
import { isMfaVerifiedSession, isSuperAdminMissingMfa, MFA_REQUIRED_MESSAGE } from '@/auth/mfa'
import { getSessionForRequest } from '@/auth/session-cache'
import type { CommandContext } from '@/commands/engine'
import type { Database } from '@/database/db'
import type { Env } from '@/env'
import { withTenantBindings } from '@/tenants/with-tenant-bindings'
import type { TenantContext } from '@/tenants/tenant-context'
import { createCommandHostHooks } from '@/host/command-hooks'
import { getHostRuntime } from '@/host/host-context'
import { getRequestPathname, getRequestUrl } from '@/shared/utils/request-url'
import { processMcpMessage, type McpJsonRpcResponse } from './mcp-server'
import { looksLikeJwt, matchesMcpApiKey, readApiKeyHeader, readBearerToken } from './mcp-auth'
import { parseAccessClaims, validateRequestJwt } from '@/auth/jwt'
import { AI_DISABLED_CODE, AI_DISABLED_MESSAGE, isTenantAiEnabled } from '@/ai/ai-access'

async function resolveMcpAuth(
  request: Request,
  workerEnv: Env,
  user?: { id: string }
): Promise<{ authenticated: boolean; actorId?: string; mfaRequired?: boolean }> {
  // 1. Session auth from betterAuthPlugin
  if (user?.id) {
    return { authenticated: true, actorId: user.id }
  }

  // 2. X-EdgeCMS-API-Key header: must match a deployment key.
  const headerKey = readApiKeyHeader(request)
  if (headerKey) {
    return matchesMcpApiKey(headerKey, workerEnv)
      ? { authenticated: true, actorId: `mcp-key-${headerKey.slice(0, 8)}` }
      : { authenticated: false }
  }

  // 3. Authorization: Bearer — a deployment key or an EdgeCMS access token
  //    (JWT from GET /api/auth/access-token).
  const bearer = readBearerToken(request)
  if (bearer) {
    if (matchesMcpApiKey(bearer, workerEnv)) {
      return { authenticated: true, actorId: `mcp-key-${bearer.slice(0, 8)}` }
    }
    if (!looksLikeJwt(bearer)) return { authenticated: false }
    const validation = await validateRequestJwt(request, {
      secret: workerEnv.JWT_HS256_SECRET,
      issuer: workerEnv.JWT_ISSUER,
      audience: workerEnv.JWT_AUDIENCE,
      required: true,
    })
    const claims = validation.valid ? parseAccessClaims(validation.payload) : undefined
    if (!claims) return { authenticated: false }
    const missingMfa = isSuperAdminMissingMfa(
      {
        email: claims.email,
        emailVerified: claims.ev === 1,
        userRole: claims.sa === 1 ? 'superadmin' : claims.role,
        mfaVerified: claims.mfa === 1,
      },
      workerEnv
    )
    if (missingMfa) return { authenticated: false, mfaRequired: true }
    return { authenticated: true, actorId: claims.sub }
  }

  // 4. Fallback check for session cookie if not pre-populated
  try {
    const baseURL = getRequestUrl(request).origin
    const auth = createAuthForEnv(workerEnv, baseURL)
    const session = await getSessionForRequest(auth, request)
    if (session?.user?.id) {
      // HS-11: /api/mcp is not behind the admin guard, so apply the
      // super-admin MFA requirement here (tenant MFA runs in the tenant middleware).
      const missingMfa = isSuperAdminMissingMfa(
        {
          email: session.user.email,
          emailVerified: session.user.emailVerified === true,
          userRole: (session.user as { role?: unknown }).role,
          sessionRole: (session.session as { role?: unknown } | undefined)?.role,
          mfaVerified: isMfaVerifiedSession(session),
        },
        workerEnv
      )
      if (missingMfa) return { authenticated: false, mfaRequired: true }
      return { authenticated: true, actorId: session.user.id }
    }
  } catch {
    // Session resolution failed
  }

  return { authenticated: false }
}

function firstMessageId(body: unknown): string | number | null {
  const first = Array.isArray(body) ? body[0] : body
  if (first && typeof first === 'object' && 'id' in first) {
    const id = (first as { id?: unknown }).id
    if (typeof id === 'string' || typeof id === 'number') return id
  }
  return null
}

interface McpRequestContext {
  body: unknown
  request: Request
  headers: Record<string, string | undefined>
  set: { status?: unknown; headers: Record<string, string> }
  user?: { id: string }
  db: Database
  kv: KVNamespace
  workerEnv: Env
  tenantCtx?: TenantContext
  requestId?: string
}

async function handleMcpRequest(ctx: McpRequestContext) {
  const { body, set, user, workerEnv, db, kv, tenantCtx, request } = ctx
  const requestPathname = getRequestPathname(request)

  const auth = await resolveMcpAuth(request, workerEnv, user)

  if (auth.mfaRequired) {
    set.status = 403
    set.headers['content-type'] = 'application/json'
    return {
      jsonrpc: '2.0',
      id: firstMessageId(body),
      error: { code: -32001, message: MFA_REQUIRED_MESSAGE },
    }
  }

  if (!auth.authenticated || !auth.actorId) {
    set.status = 401
    set.headers['content-type'] = 'application/json'
    return {
      jsonrpc: '2.0',
      id: firstMessageId(body),
      error: {
        code: -32001,
        message: 'Unauthorized: MCP endpoint requires an active session or a valid X-EdgeCMS-API-Key header',
      },
    }
  }

  // HS-14: MCP clients are AI agents; a tenant with AI turned off is not served.
  if (!(await isTenantAiEnabled({ db, workerEnv, tenantId: tenantCtx?.tenant.id }))) {
    set.status = 403
    set.headers['content-type'] = 'application/json'
    return {
      jsonrpc: '2.0',
      id: firstMessageId(body),
      error: { code: -32003, message: AI_DISABLED_MESSAGE, data: { code: AI_DISABLED_CODE } },
    }
  }

  const commandContext: CommandContext = {
    db,
    kv,
    env: workerEnv,
    actor: {
      userId: auth.actorId,
      source: 'ai',
    },
    tenantScope: tenantCtx?.tenant.id,
    hostHooks: createCommandHostHooks(getHostRuntime(request), {
      source: ctx,
      tenant: tenantCtx?.tenant,
      actorId: auth.actorId,
    }),
    requestMeta: {
      requestId: ctx.requestId ?? crypto.randomUUID(),
      pathname: requestPathname,
      method: request.method,
    },
  }

  set.headers['content-type'] = 'application/json'

  if (Array.isArray(body)) {
    if (body.length === 0) {
      set.status = 400
      return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Empty batch' } }
    }
    if (body.length > 25) {
      set.status = 400
      return {
        jsonrpc: '2.0',
        id: firstMessageId(body),
        error: {
          code: -32600,
          message: 'Batch request exceeds maximum of 25 messages',
        },
      }
    }
    const results: McpJsonRpcResponse[] = []
    for (let i = 0; i < body.length; i += 5) {
      const chunk = body.slice(i, i + 5)
      const settled = await Promise.all(chunk.map((msg) => processMcpMessage(commandContext, msg)))
      for (const response of settled) if (response) results.push(response)
    }
    // Streamable HTTP: a body of only notifications/responses gets 202 with no body.
    if (results.length === 0) return accepted(set)
    return results
  }

  const response = await processMcpMessage(commandContext, body)
  if (!response) return accepted(set)
  return response
}

function accepted(set: McpRequestContext['set']) {
  set.status = 202
  delete set.headers['content-type']
  return new Response(null, { status: 202 })
}

/**
 * Streamable HTTP: this server does not offer a server-to-client SSE stream or
 * sessions, so GET and DELETE answer 405 (clients then stay on POST).
 */
function methodNotAllowed(set: McpRequestContext['set']) {
  set.status = 405
  set.headers['allow'] = 'POST'
  set.headers['content-type'] = 'application/json'
  return {
    jsonrpc: '2.0',
    id: null,
    error: { code: -32000, message: 'Method not allowed: use POST for MCP JSON-RPC messages' },
  }
}

export const mcpController = new Elysia()
  .use(betterAuthPlugin)
  .use(withTenantBindings)
  .post('/api/mcp', (ctx) => handleMcpRequest(ctx as unknown as McpRequestContext))
  .post('/api/admin/mcp', (ctx) => handleMcpRequest(ctx as unknown as McpRequestContext))
  .get('/api/mcp', ({ set }) => methodNotAllowed(set as McpRequestContext['set']))
  .delete('/api/mcp', ({ set }) => methodNotAllowed(set as McpRequestContext['set']))
  .get('/api/admin/mcp', ({ set }) => methodNotAllowed(set as McpRequestContext['set']))
  .delete('/api/admin/mcp', ({ set }) => methodNotAllowed(set as McpRequestContext['set']))
