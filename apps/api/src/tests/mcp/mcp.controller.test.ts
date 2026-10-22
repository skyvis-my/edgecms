import { beforeEach, describe, expect, it, mock, vi } from 'bun:test'
import type { Env } from '@/env'

import { Elysia } from 'elysia'

const mockProcessMcpMessage = vi.fn()
mock.module('@/mcp/mcp-server', () => ({
  processMcpMessage: mockProcessMcpMessage,
  MCP_TOOLS: [],
}))

mock.module('@/auth/auth.middleware', () => ({
  betterAuthPlugin: new Elysia({ name: 'better-auth' })
    .derive(() => ({ user: undefined }))
    .macro({
      auth: {
        derive() {
          return { user: undefined }
        },
      },
    }),
}))

const mockGetSessionForRequest = vi.fn(async (): Promise<unknown> => null)
mock.module('@/auth/session-cache', () => ({
  getSessionForRequest: mockGetSessionForRequest,
}))

const mockWorkerEnv: Partial<Env> = {
  DB: {} as D1Database,
  CACHE: {} as KVNamespace,
  EDGECMS_API_KEY: 'test-mcp-key-secret',
  BETTER_AUTH_SECRET: 'test-better-auth-secret-32-chars-long',
  JWT_HS256_SECRET: 'test-jwt-secret-for-mcp-controller-tests',
}

mock.module('cloudflare:workers', () => ({
  env: mockWorkerEnv,
}))

import { createAccessToken } from '@/auth/jwt'

const { mcpController } = await import(`@/mcp/mcp.controller?bypass=${Date.now()}`)

describe('MCP Controller Authentication & API Key Enforcement (C-21)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProcessMcpMessage.mockResolvedValue({
      jsonrpc: '2.0',
      id: 1,
      result: { tools: [] },
    })
  })

  it('rejects unauthenticated requests without session or API key with HTTP 401', async () => {
    const request = new Request('http://localhost/api/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
      }),
    })

    const response = await mcpController.handle(request)
    expect(response.status).toBe(401)
    const body = await response.json()
    expect(body).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      error: {
        code: -32001,
        message: expect.stringContaining('Unauthorized'),
      },
    })
    expect(mockProcessMcpMessage).not.toHaveBeenCalled()
  })

  it('rejects requests with invalid X-EdgeCMS-API-Key header with HTTP 401', async () => {
    const request = new Request('http://localhost/api/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-edgecms-api-key': 'wrong-key',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
      }),
    })

    const response = await mcpController.handle(request)
    expect(response.status).toBe(401)
    expect(mockProcessMcpMessage).not.toHaveBeenCalled()
  })

  it('authenticates requests with valid X-EdgeCMS-API-Key header and processes tools', async () => {
    const request = new Request('http://localhost/api/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-edgecms-api-key': 'test-mcp-key-secret',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/list',
      }),
    })

    const response = await mcpController.handle(request)
    expect(response.status).toBe(200)
    expect(mockProcessMcpMessage).toHaveBeenCalledTimes(1)
    const calledContext = mockProcessMcpMessage.mock.calls[0]?.[0]
    expect(calledContext.actor.userId).toContain('mcp-key-test-mcp')
    expect(calledContext.actor.source).toBe('ai')
  })

  it('authenticates requests with Bearer token matching API key', async () => {
    const request = new Request('http://localhost/api/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-mcp-key-secret',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/list',
      }),
    })

    const response = await mcpController.handle(request)
    expect(response.status).toBe(200)
    expect(mockProcessMcpMessage).toHaveBeenCalledTimes(1)
  })

  it('enforces authentication on /api/admin/mcp endpoint identically', async () => {
    const unauthReq = new Request('http://localhost/api/admin/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'tools/list' }),
    })
    const unauthRes = await mcpController.handle(unauthReq)
    expect(unauthRes.status).toBe(401)

    const authReq = new Request('http://localhost/api/admin/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-edgecms-api-key': 'test-mcp-key-secret',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 6, method: 'tools/list' }),
    })
    const authRes = await mcpController.handle(authReq)
    expect(authRes.status).toBe(200)
  })
})

describe('MCP super-admin MFA requirement (HS-11)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProcessMcpMessage.mockResolvedValue({ jsonrpc: '2.0', id: 1, result: { tools: [] } })
    mockWorkerEnv.SUPER_ADMIN_EMAILS = 'root@example.com'
    mockWorkerEnv.SUPER_ADMIN_REQUIRE_MFA = 'true'
  })

  function listTools() {
    return mcpController.handle(
      new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      })
    )
  }

  function rootSession(mfaVerified: boolean) {
    return {
      user: { id: 'u-root', email: 'root@example.com', emailVerified: true, role: 'viewer' },
      session: { id: 's-root', mfaVerified },
    }
  }

  it('rejects a super-admin session without MFA', async () => {
    mockGetSessionForRequest.mockResolvedValue(rootSession(false))
    const response = await listTools()
    expect(response.status).toBe(403)
    expect(mockProcessMcpMessage).not.toHaveBeenCalled()
  })

  it('accepts a super-admin session that completed MFA', async () => {
    mockGetSessionForRequest.mockResolvedValue(rootSession(true))
    const response = await listTools()
    expect(response.status).toBe(200)
    expect(mockProcessMcpMessage).toHaveBeenCalled()
  })
})


describe('MCP Streamable HTTP transport (AI-06)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkerEnv.SUPER_ADMIN_EMAILS = undefined
    mockWorkerEnv.SUPER_ADMIN_REQUIRE_MFA = undefined
    mockProcessMcpMessage.mockResolvedValue({ jsonrpc: '2.0', id: 1, result: {} })
  })

  function post(body: unknown, headers: Record<string, string> = {}) {
    return mcpController.handle(
      new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'x-edgecms-api-key': 'test-mcp-key-secret',
          ...headers,
        },
        body: JSON.stringify(body),
      })
    )
  }

  it('answers a notification with 202 and no body', async () => {
    mockProcessMcpMessage.mockResolvedValue(null)
    const response = await post({ jsonrpc: '2.0', method: 'notifications/initialized' })
    expect(response.status).toBe(202)
    expect(await response.text()).toBe('')
  })

  it('answers a batch of only notifications with 202', async () => {
    mockProcessMcpMessage.mockResolvedValue(null)
    const response = await post([
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } },
    ])
    expect(response.status).toBe(202)
  })

  it('drops notification slots from a mixed batch reply', async () => {
    mockProcessMcpMessage
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ jsonrpc: '2.0', id: 2, result: {} })
    const response = await post([
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'ping' },
    ])
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([{ jsonrpc: '2.0', id: 2, result: {} }])
  })

  it('rejects an empty batch with -32600', async () => {
    const response = await post([])
    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe(-32600)
  })

  it.each(['GET', 'DELETE'])('answers %s with 405 and Allow: POST', async (method) => {
    for (const path of ['/api/mcp', '/api/admin/mcp']) {
      const response = await mcpController.handle(
        new Request(`http://localhost${path}`, {
          method,
          headers: { accept: 'text/event-stream' },
        })
      )
      expect(response.status).toBe(405)
      expect(response.headers.get('allow')).toBe('POST')
    }
  })
})

describe('MCP access-token bearer auth (AI-06)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkerEnv.SUPER_ADMIN_EMAILS = undefined
    mockWorkerEnv.SUPER_ADMIN_REQUIRE_MFA = undefined
    mockProcessMcpMessage.mockResolvedValue({ jsonrpc: '2.0', id: 1, result: { tools: [] } })
  })

  function listToolsWithBearer(token: string) {
    return mcpController.handle(
      new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      })
    )
  }

  it('accepts an EdgeCMS access token and acts as its subject', async () => {
    const token = await createAccessToken({ sub: 'user-42' }, mockWorkerEnv.JWT_HS256_SECRET!)
    const response = await listToolsWithBearer(token)
    expect(response.status).toBe(200)
    expect(mockProcessMcpMessage.mock.calls[0]?.[0].actor).toEqual({
      userId: 'user-42',
      source: 'ai',
    })
  })

  it('rejects an access token signed with another secret', async () => {
    const token = await createAccessToken({ sub: 'user-42' }, 'some-other-secret-value-xyz')
    const response = await listToolsWithBearer(token)
    expect(response.status).toBe(401)
    expect(mockProcessMcpMessage).not.toHaveBeenCalled()
  })

  it('rejects an expired access token', async () => {
    const token = await createAccessToken({ sub: 'user-42' }, mockWorkerEnv.JWT_HS256_SECRET!, {
      ttlSeconds: 60,
      issuedAtSeconds: Math.floor(Date.now() / 1000) - 3600,
    })
    const response = await listToolsWithBearer(token)
    expect(response.status).toBe(401)
  })

  it('applies the super-admin MFA requirement to access tokens', async () => {
    mockWorkerEnv.SUPER_ADMIN_REQUIRE_MFA = 'true'
    const token = await createAccessToken(
      { sub: 'u-root', sa: true, mfa: false },
      mockWorkerEnv.JWT_HS256_SECRET!
    )
    const response = await listToolsWithBearer(token)
    expect(response.status).toBe(403)
    expect(mockProcessMcpMessage).not.toHaveBeenCalled()
  })

  it('does not fall through to the session when a non-key, non-JWT bearer is sent', async () => {
    mockGetSessionForRequest.mockResolvedValue({ user: { id: 'u-1' }, session: {} })
    const response = await listToolsWithBearer('not-a-key')
    expect(response.status).toBe(401)
  })
})
