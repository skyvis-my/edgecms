import { beforeEach, describe, expect, it, vi } from 'bun:test'
import type { Database } from '@/database/db'
import type { Env } from '@/env'
import type { TrustedPluginAiTool } from '@/plugins/trusted-plugin-catalog'

// Mock the problematic version schema before imports
vi.mock('@/shared/schemas/version', () => ({
  entryVersion: {
    // oxlint-disable-next-line lint/suspicious/noExplicitAny: Mock type
    infer: {} as any,
    array: () => ({ infer: [] as unknown[] }),
  },
  diffAction: {
    // oxlint-disable-next-line lint/suspicious/noExplicitAny: Mock type
    infer: '' as any,
  },
  versionDiffEntry: {
    // oxlint-disable-next-line lint/suspicious/noExplicitAny: Mock type
    infer: {} as any,
  },
  versionListResponse: {
    // oxlint-disable-next-line lint/suspicious/noExplicitAny: Mock type
    infer: {} as any,
  },
  rollbackResponse: {
    // oxlint-disable-next-line lint/suspicious/noExplicitAny: Mock type
    infer: {} as any,
  },
}))

// Mock the AI SDK generateText function
vi.mock('ai', () => ({
  generateText: vi.fn(),
  tool: vi.fn((opts) => opts),
}))
vi.mock('../../ai/adapters/arktype-to-zod', () => ({
  arktypeToZod: vi.fn(() => ({})),
}))
vi.mock('@/commands/engine', () => ({
  executeCommand: vi.fn(),
}))
vi.mock('@/plugins/plugin-registry', () => ({
  pluginRegistry: {
    execute: vi.fn(),
    register: vi.fn(),
    clear: vi.fn(),
    setHookTimeoutMs: vi.fn(),
    getHookTimeoutMs: vi.fn().mockReturnValue(250),
  },
}))
const mockGetLoadedPluginAiTools = vi.fn((): TrustedPluginAiTool[] => [])
vi.mock('@/plugins/plugin-loader', () => ({
  getLoadedPluginAiTools: mockGetLoadedPluginAiTools,
  loadPlugins: vi.fn(),
  getLoadedPlugins: vi.fn().mockReturnValue([]),
  parsePluginConfig: vi.fn().mockReturnValue([]),
  createLoadedPluginRoutesController: vi.fn(),
}))

// Mock the model registry
vi.mock('../../ai/providers/registry', () => ({
  getModel: vi.fn(() => ({
    doGenerate: vi.fn(),
    specificationVersion: 'v1' as const,
    provider: 'test-provider',
    modelId: 'test-model',
  })),
}))

// Mock the context builder
vi.mock('../../ai/context/context-builder', () => ({
  buildContextPackFromDb: vi.fn(() => ({
    collections: [
      {
        id: 'coll-1',
        name: 'Blog Posts',
        slug: 'blog-posts',
        singleton: false,
        fields: [
          {
            name: 'title',
            type: 'text',
            required: true,
            localizable: true,
          },
          {
            name: 'content',
            type: 'richtext',
            required: true,
            localizable: true,
          },
        ],
        defaultLocale: 'en',
        supportedLocales: ['en', 'fr'],
      },
    ],
    locale: 'en',
  })),
}))

const { executeGeneratedCommands, generateCommands } = await import(
  `../../ai/ai.service?bypass=${Date.now()}`
)
const { executeCommand } = await import('@/commands/engine')
const { pluginRegistry } = await import('@/plugins/plugin-registry')

describe('AI Service', () => {
  let mockEnv: Env
  let mockDb: Database
  const mockExecuteCommand = executeCommand as unknown as ReturnType<typeof vi.fn>
  const mockPluginExecute = pluginRegistry.execute as unknown as ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockEnv = {
      QWEN_API_KEY: 'test-api-key',
    } as Env

    mockDb = {} as Database

    vi.restoreAllMocks()
    vi.clearAllMocks()
    mockGetLoadedPluginAiTools.mockReturnValue([])
  })

  describe('generateCommands', () => {
    it('generates valid command envelopes from AI tool calls', async () => {
      // Mock AI SDK response with a single createEntry tool call
      const { generateText } = await import('ai')
      const mockGenerateText = generateText as unknown as ReturnType<typeof vi.fn>
      mockGenerateText.mockResolvedValue({
        text: 'I will create a new blog post about AI.',
        steps: [
          {
            stepType: 'initial',
            text: 'I will create a new blog post about AI.',
            toolCalls: [
              {
                toolCallId: 'call-1',
                toolName: 'createEntry',
                args: {
                  collectionId: 'coll-1',
                  slug: 'ai-blog-post',
                  status: 'draft',
                  data: {
                    title: { en: 'AI Blog Post' },
                    content: { en: 'Content about AI' },
                  },
                },
              },
            ],
            toolResults: [],
            finishReason: 'tool-calls',
            usage: { promptTokens: 10, completionTokens: 20 },
            warnings: [],
          },
        ],
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 20 },
        warnings: [],
      })

      const result = await generateCommands({
        prompt: 'create a blog post about AI',
        env: mockEnv,
        db: mockDb,
      })

      expect(result.commands).toHaveLength(1)
      expect(result.commands[0].type).toBe('createEntry')
      expect(result.commands[0].payload.collectionId).toBe('coll-1')
      expect(result.commands[0].actor.source).toBe('ai')
      expect(result.explanation).toBe('I will create a new blog post about AI.')
    })

    it('handles multiple tool calls across steps', async () => {
      const { generateText } = await import('ai')
      const mockGenerateText = generateText as unknown as ReturnType<typeof vi.fn>
      mockGenerateText.mockResolvedValue({
        text: 'I will create two blog posts.',
        steps: [
          {
            stepType: 'initial',
            text: '',
            toolCalls: [
              {
                toolCallId: 'call-1',
                toolName: 'createEntry',
                args: {
                  collectionId: 'coll-1',
                  slug: 'post-1',
                  data: { title: { en: 'Post 1' } },
                },
              },
            ],
            toolResults: [],
            finishReason: 'tool-calls',
            usage: { promptTokens: 10, completionTokens: 20 },
            warnings: [],
          },
          {
            stepType: 'continue',
            text: '',
            toolCalls: [
              {
                toolCallId: 'call-2',
                toolName: 'createEntry',
                args: {
                  collectionId: 'coll-1',
                  slug: 'post-2',
                  data: { title: { en: 'Post 2' } },
                },
              },
            ],
            toolResults: [],
            finishReason: 'stop',
            usage: { promptTokens: 5, completionTokens: 10 },
            warnings: [],
          },
        ],
        finishReason: 'stop',
        usage: { promptTokens: 15, completionTokens: 30 },
        warnings: [],
      })

      const result = await generateCommands({
        prompt: 'create two blog posts',
        env: mockEnv,
        db: mockDb,
      })

      expect(result.commands).toHaveLength(2)
      expect(result.commands[0].type).toBe('createEntry')
      expect(result.commands[1].type).toBe('createEntry')
    })

    it('validates tool arguments against ArkType schema', async () => {
      const { generateText } = await import('ai')
      const { AI_TOOLS } = await import('../../ai/prompts/tools')

      // Mock the validation to return an error with problems
      const originalCreateEntryTool = AI_TOOLS.createEntry
      // oxlint-disable-next-line lint/suspicious/noExplicitAny: Testing mock
      vi.spyOn(AI_TOOLS.createEntry, 'parameters' as any).mockReturnValue({
        problems: [
          {
            path: ['collectionId'],
            message: 'collectionId is required',
          },
        ],
      })

      const mockGenerateText = generateText as unknown as ReturnType<typeof vi.fn>
      mockGenerateText.mockResolvedValue({
        text: '',
        steps: [
          {
            stepType: 'initial',
            text: '',
            toolCalls: [
              {
                toolCallId: 'call-1',
                toolName: 'createEntry',
                args: {
                  // Missing required field: collectionId
                  slug: 'test',
                  data: {},
                },
              },
            ],
            toolResults: [],
            finishReason: 'tool-calls',
            usage: { promptTokens: 10, completionTokens: 20 },
            warnings: [],
          },
        ],
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 20 },
        warnings: [],
      })

      await expect(
        generateCommands({
          prompt: 'test',
          env: mockEnv,
          db: mockDb,
        })
      ).rejects.toThrow(/Invalid tool arguments/)

      // Restore original
      // @ts-expect-error - Restoring readonly property
      AI_TOOLS.createEntry = originalCreateEntryTool
    })

    it('rejects unknown tool calls', async () => {
      const { generateText } = await import('ai')
      const mockGenerateText = generateText as unknown as ReturnType<typeof vi.fn>
      mockGenerateText.mockResolvedValue({
        text: '',
        steps: [
          {
            stepType: 'initial',
            text: '',
            toolCalls: [
              {
                toolCallId: 'call-1',
                toolName: 'unknownTool',
                args: {},
              },
            ],
            toolResults: [],
            finishReason: 'tool-calls',
            usage: { promptTokens: 10, completionTokens: 20 },
            warnings: [],
          },
        ],
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 20 },
        warnings: [],
      })

      await expect(
        generateCommands({
          prompt: 'test',
          env: mockEnv,
          db: mockDb,
        })
      ).rejects.toThrow(/Unknown tool call: unknownTool/)
    })

    it('builds context pack with collection and entry context', async () => {
      const { generateText } = await import('ai')
      const { buildContextPackFromDb } = await import('../../ai/context/context-builder')

      const mockGenerateText = generateText as unknown as ReturnType<typeof vi.fn>
      mockGenerateText.mockResolvedValue({
        text: 'Updated.',
        steps: [
          {
            stepType: 'initial',
            text: 'Updated.',
            toolCalls: [
              {
                toolCallId: 'call-1',
                toolName: 'updateEntry',
                args: {
                  id: 'entry-1',
                  data: { title: { en: 'Updated Title' } },
                },
              },
            ],
            toolResults: [],
            finishReason: 'tool-calls',
            usage: { promptTokens: 10, completionTokens: 20 },
            warnings: [],
          },
        ],
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 20 },
        warnings: [],
      })

      await generateCommands({
        prompt: 'update the title',
        context: {
          collectionSlug: 'blog-posts',
          entryId: 'entry-1',
        },
        env: mockEnv,
        db: mockDb,
      })

      expect(buildContextPackFromDb).toHaveBeenCalledWith({
        db: mockDb,
        collectionSlug: 'blog-posts',
        entryId: 'entry-1',
        locale: 'en',
      })
    })

    it('uses inferred model tier for command generation', async () => {
      const { generateText } = await import('ai')
      const { getModel } = await import('../../ai/providers/registry')

      const mockGenerateText = generateText as unknown as ReturnType<typeof vi.fn>
      mockGenerateText.mockResolvedValue({
        text: 'Done.',
        steps: [],
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 20 },
        warnings: [],
      })

      await generateCommands({
        prompt: 'bulk update relations',
        env: mockEnv,
        db: mockDb,
      })

      expect(getModel).toHaveBeenCalledWith('mid', mockEnv, undefined)
    })

    it('passes tenant and route metadata to model registry', async () => {
      const { generateText } = await import('ai')
      const { getModel } = await import('../../ai/providers/registry')

      const mockGenerateText = generateText as unknown as ReturnType<typeof vi.fn>
      mockGenerateText.mockResolvedValue({
        text: 'Done.',
        steps: [],
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 20 },
        warnings: [],
      })

      await generateCommands({
        prompt: 'bulk update relations',
        metadata: {
          tenantId: 'tenant-1',
          tenantSlug: 'acme',
          requestIntent: 'command_generation',
          routeClass: 'admin_ai',
        },
        env: mockEnv,
        db: mockDb,
      })

      expect(getModel).toHaveBeenCalledWith('mid', mockEnv, {
        tenantId: 'tenant-1',
        tenantSlug: 'acme',
        requestIntent: 'command_generation',
        routeClass: 'admin_ai',
      })
    })

    it('converts ArkType schemas to Zod for AI SDK', async () => {
      const { generateText } = await import('ai')

      const mockGenerateText = generateText as unknown as ReturnType<typeof vi.fn>
      mockGenerateText.mockResolvedValue({
        text: 'Done.',
        steps: [],
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 20 },
        warnings: [],
      })

      await generateCommands({
        prompt: 'test',
        env: mockEnv,
        db: mockDb,
      })

      // Verify generateText was called with converted tools
      expect(generateText).toHaveBeenCalled()
      const call = mockGenerateText.mock.calls[0]?.[0]
      expect(call?.tools).toBeDefined()
      expect(call?.tools?.createEntry).toBeDefined()
      expect(call?.tools?.createEntry?.description).toContain('Create a new entry')
      expect(call?.tools?.createEntry?.inputSchema).toBeDefined()
    })

    it('supports plugin-provided AI tools mapped to command envelopes', async () => {
      const { generateText } = await import('ai')
      const { AI_TOOLS } = await import('../../ai/prompts/tools')
      const mockGenerateText = generateText as unknown as ReturnType<typeof vi.fn>

      mockGetLoadedPluginAiTools.mockReturnValue([
        {
          name: 'pluginUpdateEntry',
          description: 'Plugin tool wrapper around updateEntry',
          parameters: AI_TOOLS.updateEntry.parameters,
          toCommands: (args: Record<string, unknown>) => [
            {
              type: 'updateEntry',
              payload: args,
            },
          ],
        },
      ])
      mockGenerateText.mockResolvedValue({
        text: 'Updated via plugin tool.',
        steps: [
          {
            stepType: 'initial',
            text: '',
            toolCalls: [
              {
                toolCallId: 'call-1',
                toolName: 'pluginUpdateEntry',
                args: {
                  id: 'entry-1',
                  data: { title: { en: 'Updated' } },
                },
              },
            ],
            toolResults: [],
            finishReason: 'tool-calls',
            usage: { promptTokens: 10, completionTokens: 20 },
            warnings: [],
          },
        ],
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 20 },
        warnings: [],
      })

      const result = await generateCommands({
        prompt: 'update the title',
        env: mockEnv,
        db: mockDb,
      })

      expect(result.commands).toHaveLength(1)
      expect(result.commands[0]).toEqual(
        expect.objectContaining({
          type: 'updateEntry',
          payload: {
            id: 'entry-1',
            data: { title: { en: 'Updated' } },
          },
        })
      )

      const firstCall = mockGenerateText.mock.calls[0]?.[0]
      expect(firstCall?.tools?.pluginUpdateEntry).toBeDefined()
    })

    it('returns empty commands array when AI returns no tool calls', async () => {
      const { generateText } = await import('ai')

      const mockGenerateText = generateText as unknown as ReturnType<typeof vi.fn>
      mockGenerateText.mockResolvedValue({
        text: 'I need more information to proceed.',
        steps: [
          {
            stepType: 'initial',
            text: 'I need more information to proceed.',
            toolCalls: [],
            toolResults: [],
            finishReason: 'stop',
            usage: { promptTokens: 10, completionTokens: 20 },
            warnings: [],
          },
        ],
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 20 },
        warnings: [],
      })

      const result = await generateCommands({
        prompt: 'unclear request',
        env: mockEnv,
        db: mockDb,
      })

      expect(result.commands).toHaveLength(0)
      expect(result.explanation).toBe('I need more information to proceed.')
    })

    it('runs beforeAiCommand plugin hook with request context metadata', async () => {
      const { generateText } = await import('ai')
      const mockGenerateText = generateText as unknown as ReturnType<typeof vi.fn>
      mockGenerateText.mockResolvedValue({
        text: 'Done.',
        steps: [],
        finishReason: 'stop',
        usage: { promptTokens: 5, completionTokens: 5 },
        warnings: [],
      })

      await generateCommands({
        prompt: 'summarize this',
        metadata: { tenantId: 'tenant-1' },
        hookContext: {
          requestId: 'req-1',
          pathname: '/api/admin/ai/command',
          method: 'POST',
          dryRun: true,
        },
        env: mockEnv,
        db: mockDb,
      })

      expect(mockPluginExecute).toHaveBeenCalledWith(
        'beforeAiCommand',
        expect.objectContaining({
          requestId: 'req-1',
          pathname: '/api/admin/ai/command',
          method: 'POST',
          tenantScope: 'tenant-1',
          prompt: 'summarize this',
          dryRun: true,
        })
      )
    })
  })

  describe('executeGeneratedCommands', () => {
    it('executes generated commands and forwards request metadata to command engine', async () => {
      const { generateText } = await import('ai')
      const mockGenerateText = generateText as unknown as ReturnType<typeof vi.fn>
      mockGenerateText.mockResolvedValue({
        text: 'Done.',
        steps: [
          {
            stepType: 'initial',
            text: '',
            toolCalls: [
              {
                toolCallId: 'call-1',
                toolName: 'createEntry',
                args: { collectionId: 'coll-1', data: {} },
              },
            ],
            toolResults: [],
            finishReason: 'tool-calls',
            usage: { promptTokens: 5, completionTokens: 5 },
            warnings: [],
          },
        ],
        finishReason: 'stop',
        usage: { promptTokens: 5, completionTokens: 5 },
        warnings: [],
      })
      mockExecuteCommand.mockResolvedValue({
        commandId: 'cmd-1',
        type: 'createEntry',
        status: 'success',
        data: { id: 'e1' },
        executedAt: new Date().toISOString(),
      })

      const result = await executeGeneratedCommands({
        prompt: 'create post',
        userId: 'u1',
        env: mockEnv,
        db: mockDb,
        kv: {} as KVNamespace,
        metadata: { tenantId: 'tenant-1' },
        hookContext: {
          requestId: 'req-1',
          pathname: '/api/admin/ai/command',
          method: 'POST',
        },
      })

      expect(result.status).toBe('success')
      expect(mockExecuteCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          requestMeta: {
            requestId: 'req-1',
            pathname: '/api/admin/ai/command',
            method: 'POST',
          },
          tenantScope: 'tenant-1',
        }),
        expect.objectContaining({
          actor: expect.objectContaining({
            userId: 'u1',
          }),
        })
      )
    })
  })
})
