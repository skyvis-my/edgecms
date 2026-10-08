import { beforeEach, describe, expect, it, vi } from 'bun:test'
import type { Database } from '@/database/db'
import type { CommandContext } from '@/commands/engine'
import { processMcpMessage, MCP_TOOLS } from '@/mcp/mcp-server'
import { collectionsRepository } from '@/collections/collections.repository'
import { entriesRepository } from '@/entries/entries.repository'
import { __resetPreviewReceiptStoreForTests } from '@/ai/preview-receipt.service'

const mockExecuteCommand = vi.fn()
vi.mock('@/commands/engine', () => ({
  executeCommand: mockExecuteCommand,
}))

vi.mock('@/collections/collections.repository', () => ({
  collectionsRepository: {
    findAll: vi.fn(),
    findBySlug: vi.fn(),
    findById: vi.fn(),
  },
}))

vi.mock('@/entries/entries.repository', () => ({
  entriesRepository: {
    findAll: vi.fn(),
    findById: vi.fn(),
  },
}))

describe('Native MCP Server Adapter Gated by Command Engine (C-01)', () => {
  const mockDb = {} as Database
  const mockKv = {} as KVNamespace

  const ctx: CommandContext = {
    db: mockDb,
    kv: mockKv,
    actor: {
      userId: 'agent-claude',
      source: 'ai',
    },
    tenantScope: 'tenant-smoke',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    __resetPreviewReceiptStoreForTests()
  })

  it('handles initialize handshake with MCP protocol specification', async () => {
    const response = await processMcpMessage(ctx, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
    })

    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: {
          name: 'edgecms-mcp-server',
          version: '1.0.0',
        },
      },
    })
  })

  it('lists all registered MCP tools with schema and descriptions', async () => {
    const response = await processMcpMessage(ctx, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    })

    const tools = (response.result as { tools: typeof MCP_TOOLS }).tools
    expect(tools).toHaveLength(7)

    const toolNames = tools.map((t) => t.name)
    expect(toolNames).toContain('edgecms_list_collections')
    expect(toolNames).toContain('edgecms_get_schema')
    expect(toolNames).toContain('edgecms_list_entries')
    expect(toolNames).toContain('edgecms_get_entry')
    expect(toolNames).toContain('edgecms_preview_command')
    expect(toolNames).toContain('edgecms_execute_command')
    expect(toolNames).toContain('edgecms_search_rag')
  })

  it('executes edgecms_list_collections and sanitizes schema fields', async () => {
    const mockCollections = [
      {
        id: 'col-1',
        name: 'Posts',
        slug: 'posts',
        singleton: false,
        defaultLocale: 'en',
        supportedLocales: ['en'],
        fields: [
          { name: 'title', type: 'text', required: true },
          { name: 'content', type: 'richtext', required: false },
        ],
      },
    ]

    ;(collectionsRepository.findAll as any).mockResolvedValue(mockCollections)

    const response = await processMcpMessage(ctx, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'edgecms_list_collections',
        arguments: {},
      },
    })

    expect(response.error).toBeUndefined()
    const content = (response.result as { content: Array<{ text: string }> }).content
    const firstItem = content[0]
    expect(firstItem).toBeDefined()
    if (!firstItem) throw new Error('Expected firstItem')
    const parsed = JSON.parse(firstItem.text)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].slug).toBe('posts')
    expect(parsed[0].fieldCount).toBe(2)
  })

  it('executes edgecms_preview_command dry-run and returns SHA-256 preview receipt', async () => {
    mockExecuteCommand.mockResolvedValueOnce({
      commandId: 'cmd-dry-1',
      type: 'updateEntry',
      status: 'dry_run',
      diff: [{ path: 'title', before: 'Old', after: 'New' }],
      executedAt: new Date().toISOString(),
    })

    const response = await processMcpMessage(ctx, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'edgecms_preview_command',
        arguments: {
          type: 'updateEntry',
          payload: {
            entryId: 'entry-1',
            data: { title: 'New' },
          },
          optimisticVersion: 1,
        },
      },
    })

    expect(response.error).toBeUndefined()
    const content = (response.result as { content: Array<{ text: string }> }).content
    const firstItem = content[0]
    expect(firstItem).toBeDefined()
    if (!firstItem) throw new Error('Expected firstItem')
    const result = JSON.parse(firstItem.text)

    expect(result.status).toBe('dry_run')
    expect(result.previewReceipt).toStartWith('rcpt_')
    expect(result.sha256Hash).toHaveLength(64)
    expect(result.diff).toEqual([{ path: 'title', before: 'Old', after: 'New' }])

    expect(mockExecuteCommand).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        type: 'updateEntry',
        dryRun: true,
      })
    )
  })

  it('rejects edgecms_execute_command without a valid preview receipt', async () => {
    const response = await processMcpMessage(ctx, {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'edgecms_execute_command',
        arguments: {
          previewReceipt: 'rcpt_invalid_or_fake',
        },
      },
    })

    const result = response.result as { isError?: boolean; content: Array<{ text: string }> }
    expect(result.isError).toBe(true)
    const firstItem = result.content[0]
    expect(firstItem).toBeDefined()
    if (!firstItem) throw new Error('Expected firstItem')
    expect(firstItem.text).toContain('Preview receipt verification failed')
    expect(mockExecuteCommand).not.toHaveBeenCalled()
  })

  it('successfully executes staged mutation when preview receipt is verified', async () => {
    // 1. Stage a command with preview
    mockExecuteCommand.mockResolvedValueOnce({
      commandId: 'cmd-dry-1',
      type: 'createEntry',
      status: 'dry_run',
      diff: [],
      executedAt: new Date().toISOString(),
    })

    const previewRes = await processMcpMessage(ctx, {
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        name: 'edgecms_preview_command',
        arguments: {
          type: 'createEntry',
          payload: { collectionId: 'posts', data: { title: 'MCP Created' } },
        },
      },
    })

    const content = (previewRes.result as { content: Array<{ text: string }> }).content
    const previewFirstItem = content[0]
    expect(previewFirstItem).toBeDefined()
    if (!previewFirstItem) throw new Error('Expected previewFirstItem')
    const previewData = JSON.parse(previewFirstItem.text)
    const receiptId = previewData.previewReceipt

    // 2. Execute with previewReceipt
    mockExecuteCommand.mockResolvedValueOnce({
      commandId: 'cmd-exec-1',
      type: 'createEntry',
      status: 'success',
      data: { id: 'entry-new', title: 'MCP Created' },
      executedAt: new Date().toISOString(),
    })

    const execRes = await processMcpMessage(ctx, {
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: {
        name: 'edgecms_execute_command',
        arguments: {
          previewReceipt: receiptId,
        },
      },
    })

    const execResult = execRes.result as { isError?: boolean; content: Array<{ text: string }> }
    expect(execResult.isError).toBeFalsy()
    const execFirstItem = execResult.content[0]
    expect(execFirstItem).toBeDefined()
    if (!execFirstItem) throw new Error('Expected execFirstItem')
    const execData = JSON.parse(execFirstItem.text)
    expect(execData.status).toBe('success')
    expect(execData.commandId).toBe('cmd-exec-1')

    // 3. Replay attempt should be rejected
    const replayRes = await processMcpMessage(ctx, {
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: {
        name: 'edgecms_execute_command',
        arguments: {
          previewReceipt: receiptId,
        },
      },
    })
    const replayResult = replayRes.result as { isError?: boolean; content: Array<{ text: string }> }
    expect(replayResult.isError).toBe(true)
    expect(replayResult.content[0]?.text).toContain('already been executed')
  })

  it('executes edgecms_search_rag for semantic content retrieval', async () => {
    ;(entriesRepository.findAll as any).mockResolvedValueOnce({
      rows: [
        {
          id: 'entry-blog-1',
          collectionId: 'blog',
          tenantId: 'tenant-smoke',
          status: 'published',
          slug: 'edge-computing-guide',
          data: {
            title: 'Edge Computing Guide',
            body: 'Cloudflare Workers and EdgeCMS provide ultra-low latency compute.',
          },
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          version: 1,
        },
      ],
      total: 1,
      page: 1,
      perPage: 10,
    } as any)

    const response = await processMcpMessage(ctx, {
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: {
        name: 'edgecms_search_rag',
        arguments: {
          query: 'edge computing latency',
          limit: 3,
        },
      },
    })

    const result = response.result as { isError?: boolean; content: Array<{ text: string }> }
    expect(result.isError).toBeFalsy()
    expect(result.content[0]?.text).toBeDefined()
    const parsed = JSON.parse(result.content[0]!.text)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed.length).toBeGreaterThan(0)
    expect(parsed[0].entryId).toBe('entry-blog-1')
    expect(parsed[0].title).toBe('Edge Computing Guide')
    expect(parsed[0].score).toBeGreaterThan(0)
  })

  it('executes multi-command preview receipt as a transaction in edgecms_execute_command', async () => {
    const { createPreviewReceipt } = await import('@/ai/preview-receipt.service')
    const receipt = await createPreviewReceipt({
      commands: [
        {
          type: 'createEntry',
          payload: { title: 'First Post' },
          actor: { userId: 'agent-claude', source: 'ai' },
          timestamp: new Date().toISOString(),
        },
        {
          type: 'createEntry',
          payload: { title: 'Second Post' },
          actor: { userId: 'agent-claude', source: 'ai' },
          timestamp: new Date().toISOString(),
        },
      ],
      userId: 'agent-claude',
      tenantId: 'tenant-smoke',
      kv: ctx.kv,
    })

    mockExecuteCommand.mockResolvedValueOnce({
      commandId: 'tx-mcp-1',
      type: 'transaction',
      status: 'success',
      data: {
        subResults: [
          { commandId: 'c1', status: 'success' },
          { commandId: 'c2', status: 'success' },
        ],
      },
      executedAt: new Date().toISOString(),
    })

    const response = await processMcpMessage(ctx, {
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: {
        name: 'edgecms_execute_command',
        arguments: {
          previewReceipt: receipt.receiptId,
        },
      },
    })

    const result = response.result as { isError?: boolean; content: Array<{ text: string }> }
    expect(result.isError).toBeFalsy()
    expect(mockExecuteCommand).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        type: 'transaction',
        previewReceipt: receipt.receiptId,
      })
    )
    const parsed = JSON.parse(result.content[0]!.text)
    expect(parsed.status).toBe('success')
    expect(parsed.results).toHaveLength(2)
  })

  it('returns JSON-RPC error -32601 for unknown methods', async () => {
    const response = await processMcpMessage(ctx, {
      jsonrpc: '2.0',
      id: 8,
      method: 'unknown/method',
    })

    expect(response.error).toEqual({
      code: -32601,
      message: 'Method not found: unknown/method',
    })
  })
})
