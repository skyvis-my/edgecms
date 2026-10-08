import { beforeEach, describe, expect, it, mock, vi } from 'bun:test'
import type { Env } from '@/env'

import { Elysia } from 'elysia'

const mockProcessMcpMessage = vi.fn()
mock.module('@/mcp/mcp-server', () => ({
  processMcpMessage: mockProcessMcpMessage,
  MCP_TOOLS: [],
}))

mock.module('@/auth/auth.middleware', () => ({
  betterAuthPlugin: new Elysia({ name: 'better-auth', aot: false })
    .derive(() => ({ user: undefined }))
    .macro({
      auth: {
        resolve() {
          return { user: undefined }
        },
      },
    }),
}))

mock.module('@/auth/session-cache', () => ({
  getSessionForRequest: vi.fn(async () => null),
}))

const mockWorkerEnv: Partial<Env> = {
  DB: {} as D1Database,
  CACHE: {} as KVNamespace,
  EDGECMS_API_KEY: 'test-mcp-key-secret',
  BETTER_AUTH_SECRET: 'test-better-auth-secret-32-chars-long',
}

mock.module('cloudflare:workers', () => ({
  env: mockWorkerEnv,
}))

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
