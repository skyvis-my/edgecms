import { env } from 'cloudflare:workers'
import { Elysia } from 'elysia'
import { betterAuthPlugin } from '@/auth/auth.middleware'
import { createAuth } from '@/auth/auth'
import { getSessionForRequest } from '@/auth/session-cache'
import type { CommandContext } from '@/commands/engine'
import type { Env } from '@/env'
import { hasTenantContext, resolveTenantBindings } from '@/tenants/tenant-context'
import { getRequestPathname, getRequestUrl } from '@/shared/utils/request-url'
import { processMcpMessage, type McpJsonRpcRequest } from './mcp-server'

async function resolveMcpAuth(
  request: Request,
  headers: Record<string, string | undefined>,
  workerEnv: Env,
  user?: { id: string }
): Promise<{ authenticated: boolean; actorId?: string }> {
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
    const auth = createAuth(workerEnv.DB, {
      secret: workerEnv.BETTER_AUTH_SECRET,
      baseURL,
      entra: {
        clientId: workerEnv.ENTRA_CLIENT_ID,
        clientSecret: workerEnv.ENTRA_CLIENT_SECRET,
        tenantId: workerEnv.ENTRA_TENANT_ID,
      },
      google: {
        clientId: workerEnv.GOOGLE_CLIENT_ID,
        clientSecret: workerEnv.GOOGLE_CLIENT_SECRET,
      },
    })
    const session = await getSessionForRequest(auth, request)
    if (session?.user?.id) {
      return { authenticated: true, actorId: session.user.id }
    }
  } catch {
    // Session resolution failed
  }

  return { authenticated: false }
}

export const mcpController = new Elysia()
  .use(betterAuthPlugin)
  .post('/api/mcp', async (elysiaCtx) => {
    const { body, set } = elysiaCtx
    const user = (elysiaCtx as { user?: { id: string } }).user
    const workerEnv = env as unknown as Env
    const requestPathname = getRequestPathname(elysiaCtx.request)

    const auth = await resolveMcpAuth(
      elysiaCtx.request,
      elysiaCtx.headers as Record<string, string | undefined>,
      workerEnv,
      user
    )

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

    const tenantCtx = hasTenantContext(elysiaCtx) ? elysiaCtx.tenant : undefined
    const { db, kv } = resolveTenantBindings(tenantCtx, workerEnv)

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
        requestId: (elysiaCtx as unknown as { requestId?: string }).requestId ?? crypto.randomUUID(),
        pathname: requestPathname,
        method: elysiaCtx.request.method,
      },
    }

    set.headers['content-type'] = 'application/json'

    if (Array.isArray(body)) {
      const results = await Promise.all(
        body.map((req) => processMcpMessage(commandContext, req as McpJsonRpcRequest))
      )
      return results
    }

    return await processMcpMessage(commandContext, body as McpJsonRpcRequest)
  })
  .post('/api/admin/mcp', async (elysiaCtx) => {
    const { body, set } = elysiaCtx
    const user = (elysiaCtx as { user?: { id: string } }).user
    const workerEnv = env as unknown as Env
    const requestPathname = getRequestPathname(elysiaCtx.request)

    const auth = await resolveMcpAuth(
      elysiaCtx.request,
      elysiaCtx.headers as Record<string, string | undefined>,
      workerEnv,
      user
    )

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

    const tenantCtx = hasTenantContext(elysiaCtx) ? elysiaCtx.tenant : undefined
    const { db, kv } = resolveTenantBindings(tenantCtx, workerEnv)

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
        requestId: (elysiaCtx as unknown as { requestId?: string }).requestId ?? crypto.randomUUID(),
        pathname: requestPathname,
        method: elysiaCtx.request.method,
      },
    }

    set.headers['content-type'] = 'application/json'

    if (Array.isArray(body)) {
      const results = await Promise.all(
        body.map((req) => processMcpMessage(commandContext, req as McpJsonRpcRequest))
      )
      return results
    }

    return await processMcpMessage(commandContext, body as McpJsonRpcRequest)
  })
