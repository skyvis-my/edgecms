import { generateText, tool } from 'ai'
import { type CommandContext, executeCommand } from '@/commands/engine'
import type { Database } from '@/database/db'
import type { Env } from '@/env'
import { logger } from '@/observability/logger'
import { incrementMetric } from '@/observability/metrics'
import type { PluginHookContext } from '@/plugins/plugin-hooks'
import { getLoadedPluginAiTools } from '@/plugins/plugin-loader'
import { pluginRegistry } from '@/plugins/plugin-registry'
import type { CommandEnvelope, CommandResult } from '@edgecms/schemas/commands'
import { arktypeToZod } from './adapters/arktype-to-zod'
import { aiRepository } from './ai.repository'
import { buildSystemPrompt } from './prompts/system'
import { AI_TOOLS } from './prompts/tools'
import { hashPrompt, logAIRequest } from './gateway/ai-gateway.service'
import { getModel } from './providers/registry'
import { inferTierForPrompt } from './router/model-router'
import {
  runWorkflow,
  type WorkflowResult,
  type WorkflowStep,
} from './workflows/workflow-engine'
import type { WorkflowId } from './workflows/workflow-registry'
import {
  createPreviewReceipt,
  markPreviewReceiptConsumed,
  verifyPreviewReceipt,
} from './preview-receipt.service'

/**
 * AI Service for Command Generation
 *
 * Orchestrates the AI workflow to convert natural language into structured commands:
 * 1. Build context pack from collection schemas and optional entry data
 * 2. Generate system prompt with context
 * 3. Convert ArkType tool schemas to Zod for AI SDK
 * 4. Select appropriate model (uses 'mid' tier for command generation)
 * 5. Call Vercel AI SDK generateText() with tools
 * 6. Parse AI tool calls into validated command envelopes
 * 7. Return commands with natural language explanation
 */

export interface GenerateCommandsOptions {
  prompt: string
  context?: {
    collectionSlug?: string
    entryId?: string
  }
  metadata?: {
    tenantId?: string
    tenantSlug?: string
    requestIntent?: string
    routeClass?: string
  }
  hookContext?: {
    requestId?: string
    pathname?: string
    method?: string
    dryRun?: boolean
  }
  env: Env
  db: Database
}

export interface GenerateCommandsResult {
  commands: CommandEnvelope[]
  explanation: string
}

export interface ExecuteGeneratedCommandsResult {
  commands: CommandEnvelope[]
  explanation: string
  results?: CommandResult[]
  status: 'dry_run' | 'success' | 'failed'
  previewReceipt?: string
}

export interface RunWorkflowOptions {
  workflow: WorkflowId
  prompt: string
  context?: {
    collectionSlug?: string
    entryId?: string
  }
  metadata?: {
    tenantId?: string
    tenantSlug?: string
    requestIntent?: string
    routeClass?: string
  }
  hookContext?: {
    requestId?: string
    pathname?: string
    method?: string
    dryRun?: boolean
  }
  env: Env
  db: Database
}

export interface RunWorkflowResult {
  workflow: WorkflowId
  explanation: string
  commands: CommandEnvelope[]
  steps: WorkflowStep[]
}

function resolveAiPluginContext(options: {
  prompt: string
  metadata?: GenerateCommandsOptions['metadata']
  hookContext?: GenerateCommandsOptions['hookContext']
  commandCount?: number
}): PluginHookContext {
  return {
    requestId: options.hookContext?.requestId ?? crypto.randomUUID(),
    pathname: options.hookContext?.pathname ?? '/api/admin/ai/command',
    method: options.hookContext?.method ?? 'POST',
    tenantScope: options.metadata?.tenantId,
    prompt: options.prompt,
    dryRun: options.hookContext?.dryRun ?? false,
    commandCount: options.commandCount,
  }
}

async function runBeforeAiHookSafely(context: PluginHookContext): Promise<void> {
  try {
    await pluginRegistry.execute('beforeAiCommand', context)
  } catch (err) {
    logger.error('plugin_hook_failed', { hook: 'beforeAiCommand', error: err instanceof Error ? err.message : String(err) })
  }
}

type RuntimeAiToolDefinition = {
  name: string
  description: string
  parameters: Parameters<typeof arktypeToZod>[0]
  toCommands: (args: Record<string, unknown>) => Array<{
    type: CommandEnvelope['type']
    payload: Record<string, unknown>
  }>
}

function buildRuntimeAiTools(): RuntimeAiToolDefinition[] {
  const coreTools: RuntimeAiToolDefinition[] = Object.entries(AI_TOOLS).map(([commandType, toolDef]) => ({
    name: commandType,
    description: toolDef.description,
    parameters: toolDef.parameters,
    toCommands: (args) => [
      {
        type: commandType as CommandEnvelope['type'],
        payload: args,
      },
    ],
  }))

  const pluginTools: RuntimeAiToolDefinition[] = getLoadedPluginAiTools().map((toolDef) => ({
    name: toolDef.name,
    description: toolDef.description,
    parameters: toolDef.parameters,
    toCommands: toolDef.toCommands,
  }))

  const toolsByName = new Map<string, RuntimeAiToolDefinition>()
  for (const toolDef of [...coreTools, ...pluginTools]) {
    if (toolsByName.has(toolDef.name)) continue
    toolsByName.set(toolDef.name, toolDef)
  }
  return [...toolsByName.values()]
}

/**
 * Generate structured commands from natural language input.
 *
 * Uses AI to interpret user intent and produce validated command envelopes
 * that can be executed through the command engine.
 *
 * @param options - Configuration including prompt, optional context, and environment
 * @returns Commands array and explanation of what the AI will do
 * @throws Error if AI provider is not configured or generation fails
 */
export async function generateCommands(
  options: GenerateCommandsOptions
): Promise<GenerateCommandsResult> {
  const { prompt, context, metadata, hookContext, env, db } = options
  await runBeforeAiHookSafely(resolveAiPluginContext({ prompt, metadata, hookContext }))

  // Step 1: Build context pack
  const contextPack = await aiRepository.buildContextPack(db, {
    collectionSlug: context?.collectionSlug,
    entryId: context?.entryId,
    tenantId: metadata?.tenantId,
    locale: 'en',
  })

  // Step 2: Build system prompt with context
  const systemPrompt = buildSystemPrompt({
    collections: contextPack.collections,
    currentLocale: contextPack.locale,
    tenantContext: contextPack.tenant,
  })

  // Step 3: Convert ArkType tool schemas to Zod
  const runtimeToolDefinitions = buildRuntimeAiTools()
  const runtimeToolDefinitionByName = new Map(
    runtimeToolDefinitions.map((toolDef) => [toolDef.name, toolDef] as const)
  )
  const tools: Record<string, ReturnType<typeof tool<unknown, never>>> = {}
  for (const toolDef of runtimeToolDefinitions) {
    const zodSchema = arktypeToZod(toolDef.parameters)
    tools[toolDef.name] = tool({
      description: toolDef.description,
      inputSchema: zodSchema,
    })
  }

  // Step 4: Select model tier based on inferred request complexity.
  const tier = inferTierForPrompt(prompt)
  const model = getModel(tier, env, metadata)

  // Step 5: Call Vercel AI SDK generateText() with tools
  const result = await generateText({
    model,
    system: systemPrompt,
    prompt,
    tools,
  })

  logAIRequest({
    promptHash: hashPrompt(prompt),
    modelName: 'tier-selected',
    tenantId: metadata?.tenantId,
    tenantSlug: metadata?.tenantSlug,
    requestIntent: metadata?.requestIntent,
    commandTier: tier,
    routeClass: metadata?.routeClass,
    routeId: env.AI_GATEWAY_ROUTE_ID,
    guardrailsProfileId: env.AI_GATEWAY_GUARDRAILS_PROFILE_ID,
    timestamp: new Date().toISOString(),
  })

  // Step 6: Parse AI tool calls into command envelopes
  const commands: CommandEnvelope[] = []
  const now = new Date().toISOString()

  // Extract tool calls from all steps (if present)
  if (result.steps) {
    for (const step of result.steps) {
      if (step.toolCalls) {
        for (const toolCall of step.toolCalls) {
          // Validate that the tool call corresponds to a known command type
          const toolDefinition = runtimeToolDefinitionByName.get(toolCall.toolName)
          if (!toolDefinition) {
            throw new Error(`Unknown tool call: ${toolCall.toolName}`)
          }

          // Validate the tool arguments against the ArkType schema
          // oxlint-disable-next-line lint/suspicious/noExplicitAny: Tool call args are dynamic
          const validationResult = toolDefinition.parameters((toolCall as any).args)

          // oxlint-disable-next-line lint/suspicious/noExplicitAny: ArkType validation result is dynamic
          if (validationResult instanceof Error || (validationResult as any).problems) {
            throw new Error(
              `Invalid tool arguments for ${toolCall.toolName}: ${
                validationResult instanceof Error
                  ? validationResult.message
                  : // oxlint-disable-next-line lint/suspicious/noExplicitAny: ArkType validation result is dynamic
                    JSON.stringify((validationResult as any).problems)
              }`
            )
          }

          // oxlint-disable-next-line lint/suspicious/noExplicitAny: Tool call args are dynamic
          const mappedCommands = toolDefinition.toCommands((toolCall as any).args as Record<string, unknown>)
          for (const mappedCommand of mappedCommands) {
            const envelope: CommandEnvelope = {
              type: mappedCommand.type,
              payload: mappedCommand.payload,
              actor: {
                userId: '', // Will be set by the controller from authenticated user
                source: 'ai',
              },
              timestamp: now,
            }

            commands.push(envelope)
          }
        }
      }
    }
  }

  // Step 7: Extract explanation from AI response text
  const explanation = result.text || 'Commands generated successfully.'

  return {
    commands,
    explanation,
  }
}

export async function executeGeneratedCommands(options: {
  prompt?: string
  previewReceipt?: string
  context?: {
    collectionSlug?: string
    entryId?: string
  }
  dryRun?: boolean
  userId: string
  env: Env
  db: Database
  kv: KVNamespace
  metadata?: GenerateCommandsOptions['metadata']
  hookContext?: GenerateCommandsOptions['hookContext']
}): Promise<ExecuteGeneratedCommandsResult> {
  const { prompt, previewReceipt, context, dryRun, userId, env, db, kv, metadata, hookContext } = options

  // When previewReceipt is provided for execution, verify the immutable receipt
  // and execute the exact reviewed commands without re-prompting the LLM.
  if (previewReceipt) {
    const verification = await verifyPreviewReceipt({
      receiptId: previewReceipt,
      userId,
      tenantId: metadata?.tenantId,
      kv,
    })

    if (!verification.valid || !verification.receipt) {
      throw new Error(
        `Preview receipt verification failed: ${verification.message ?? 'Invalid receipt'}`
      )
    }

    const receiptCommands = verification.receipt.commands
    const explanation =
      verification.receipt.explanation ?? 'Executed reviewed preview receipt.'

    if (dryRun) {
      incrementMetric('ai_command_runs_total', { status: 'dry_run' })
      return { commands: receiptCommands, explanation, status: 'dry_run', previewReceipt }
    }

    const executionContext: CommandContext = {
      db,
      actor: { userId, source: 'ai' },
      kv,
      tenantScope: metadata?.tenantId,
      requestMeta: {
        requestId: hookContext?.requestId,
        pathname: hookContext?.pathname,
        method: hookContext?.method,
      },
    }

    const results: CommandResult[] = []
    for (const envelope of receiptCommands) {
      // In multi-command execution, strip previewReceipt on individual commands
      // so executeCommand does not consume the batch receipt prematurely on command 1.
      const envelopeToRun =
        receiptCommands.length > 1
          ? { ...envelope, previewReceipt: undefined }
          : envelope
      const result = await executeCommand(executionContext, envelopeToRun)
      results.push(result)
      if (result.status === 'failed') {
        incrementMetric('ai_command_runs_total', { status: 'failed' })
        return {
          commands: receiptCommands,
          explanation,
          results,
          status: 'failed',
          previewReceipt,
        }
      }
    }

    await markPreviewReceiptConsumed(previewReceipt, kv, metadata?.tenantId)

    incrementMetric('ai_command_runs_total', { status: 'success' })
    return {
      commands: receiptCommands,
      explanation,
      results,
      status: 'success',
      previewReceipt,
    }
  }

  if (!prompt) {
    throw new Error('Either prompt or previewReceipt must be provided')
  }

  const { commands, explanation } = await generateCommands({
    prompt,
    context,
    metadata,
    hookContext: {
      ...hookContext,
      dryRun,
    },
    env,
    db,
  })

  const enrichedCommands: CommandEnvelope[] = commands.map((cmd) => ({
    ...cmd,
    actor: {
      ...cmd.actor,
      userId,
    },
  }))

  const receipt = await createPreviewReceipt({
    commands: enrichedCommands,
    userId,
    tenantId: metadata?.tenantId,
    explanation,
    kv,
  })

  const stagedCommands = receipt.commands

  if (dryRun) {
    incrementMetric('ai_command_runs_total', { status: 'dry_run' })
    return {
      commands: stagedCommands,
      explanation,
      status: 'dry_run',
      previewReceipt: receipt.receiptId,
    }
  }

  const executionContext: CommandContext = {
    db,
    actor: { userId, source: 'ai' },
    kv,
    tenantScope: metadata?.tenantId,
    requestMeta: {
      requestId: hookContext?.requestId,
      pathname: hookContext?.pathname,
      method: hookContext?.method,
    },
  }

  const results: CommandResult[] = []
  for (const envelope of stagedCommands) {
    const result = await executeCommand(executionContext, envelope)
    results.push(result)
    if (result.status === 'failed') {
      incrementMetric('ai_command_runs_total', { status: 'failed' })
      return {
        commands: stagedCommands,
        explanation,
        results,
        status: 'failed',
        previewReceipt: receipt.receiptId,
      }
    }
  }

  incrementMetric('ai_command_runs_total', { status: 'success' })
  return {
    commands: stagedCommands,
    explanation,
    results,
    status: 'success',
    previewReceipt: receipt.receiptId,
  }
}

export async function runAiWorkflow(options: RunWorkflowOptions): Promise<RunWorkflowResult> {
  const workflowResult: WorkflowResult = await runWorkflow(
    options.workflow,
    {
      prompt: options.prompt,
      context: options.context,
    },
    {
      env: options.env,
      db: options.db,
      metadata: options.metadata,
    },
    {
      generateCommands: (generateOptions) =>
        generateCommands({
          ...generateOptions,
          hookContext: options.hookContext,
        }),
    }
  )

  return workflowResult
}
