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
import { getRequestPathname, getRequestUrl } from '@/shared/utils/request-url'
import { processMcpMessage, type McpJsonRpcRequest } from './mcp-server'
import { AI_DISABLED_CODE, AI_DISABLED_MESSAGE, isTenantAiEnabled } from '@/ai/ai-access'

async function resolveMcpAuth(
  request: Request,
  headers: Record<string, string | undefined>,
  workerEnv: Env,
  user?: { id: string }
): Promise<{ authenticated: boolean; actorId?: string; mfaRequired?: boolean }> {
  // 1. Session auth from betterAuthPlugin
  if (user?.id) {
    return { authenticated: true, actorId: user.id }
  }

  // 2. Check X-EdgeCMS-API-Key or Bearer token header
  const apiKey =
    request.headers.get('x-edgecms-api-key') ||
    headers['x-edgecms-api-key'] ||
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')

  if (apiKey && typeof apiKey === 'string' && apiKey.trim().length > 0) {
    const cleanKey = apiKey.trim()
    const valid =
      (workerEnv.EDGECMS_API_KEY && cleanKey === workerEnv.EDGECMS_API_KEY) ||
      (workerEnv.MCP_API_KEY && cleanKey === workerEnv.MCP_API_KEY)

    if (valid) {
      return { authenticated: true, actorId: `mcp-key-${cleanKey.slice(0, 8)}` }
    }
    return { authenticated: false }
  }

  // 3. Fallback check for session cookie if not pre-populated
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

  const auth = await resolveMcpAuth(
    request,
    ctx.headers,
    workerEnv,
    user
  )

  if (auth.mfaRequired) {
    set.status = 403
    set.headers['content-type'] = 'application/json'
    return {
      jsonrpc: '2.0',
      id: Array.isArray(body) ? (body[0]?.id ?? null) : ((body as McpJsonRpcRequest)?.id ?? null),
      error: { code: -32001, message: MFA_REQUIRED_MESSAGE },
    }
  }

  if (!auth.authenticated || !auth.actorId) {
    set.status = 401
    set.headers['content-type'] = 'application/json'
    return {
      jsonrpc: '2.0',
      id: Array.isArray(body) ? (body[0]?.id ?? null) : ((body as McpJsonRpcRequest)?.id ?? null),
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
      id: Array.isArray(body) ? (body[0]?.id ?? null) : ((body as McpJsonRpcRequest)?.id ?? null),
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
    requestMeta: {
      requestId: ctx.requestId ?? crypto.randomUUID(),
      pathname: requestPathname,
      method: request.method,
    },
  }

  set.headers['content-type'] = 'application/json'

  if (Array.isArray(body)) {
    if (body.length > 25) {
      set.status = 400
      return {
        jsonrpc: '2.0',
        id: (body[0] as McpJsonRpcRequest)?.id ?? null,
        error: {
          code: -32600,
          message: 'Batch request exceeds maximum of 25 messages',
        },
      }
    }
    const results: unknown[] = []
    for (let i = 0; i < body.length; i += 5) {
      const chunk = body.slice(i, i + 5)
      const settled = await Promise.all(
        chunk.map((req) => processMcpMessage(commandContext, req as McpJsonRpcRequest))
      )
      results.push(...settled)
    }
    return results
  }

  return processMcpMessage(commandContext, body as McpJsonRpcRequest)
}

export const mcpController = new Elysia()
  .use(betterAuthPlugin)
  .use(withTenantBindings)
  .post('/api/mcp', (ctx) => handleMcpRequest(ctx as unknown as McpRequestContext))
  .post('/api/admin/mcp', (ctx) => handleMcpRequest(ctx as unknown as McpRequestContext))
