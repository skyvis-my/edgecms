import type { Database } from '@/database/db'
import type { Env } from '@/env'
import type { CommandEnvelope } from '@edgecms/schemas/commands'
import {
  type WorkflowId,
  type WorkflowInput,
  getWorkflowDefinition,
} from './workflow-registry'

type WorkflowStepStatus = 'pending' | 'running' | 'completed' | 'failed'

export interface WorkflowStep {
  id: string
  label: string
  status: WorkflowStepStatus
  startedAt?: string
  completedAt?: string
}

export interface WorkflowExecutionContext {
  env: Env
  db: Database
  metadata?: {
    tenantId?: string
    tenantSlug?: string
    requestIntent?: string
    routeClass?: string
  }
}

export interface WorkflowDependencies {
  generateCommands: (options: {
    prompt: string
    context?: {
      collectionSlug?: string
      entryId?: string
    }
    metadata?: WorkflowExecutionContext['metadata']
    env: Env
    db: Database
  }) => Promise<{
    commands: CommandEnvelope[]
    explanation: string
  }>
}

export interface WorkflowResult {
  workflow: WorkflowId
  explanation: string
  commands: CommandEnvelope[]
  steps: WorkflowStep[]
}

function nowIso(): string {
  return new Date().toISOString()
}

function startStep(step: WorkflowStep): WorkflowStep {
  return { ...step, status: 'running', startedAt: nowIso() }
}

function completeStep(step: WorkflowStep): WorkflowStep {
  return { ...step, status: 'completed', completedAt: nowIso() }
}

function failStep(step: WorkflowStep): WorkflowStep {
  return { ...step, status: 'failed', completedAt: nowIso() }
}

export async function runWorkflow(
  workflowId: WorkflowId,
  input: WorkflowInput,
  executionContext: WorkflowExecutionContext,
  deps: WorkflowDependencies
): Promise<WorkflowResult> {
  const steps: WorkflowStep[] = [
    { id: 'resolve-workflow', label: 'Resolve workflow', status: 'pending' },
    { id: 'generate-commands', label: 'Generate command set', status: 'pending' },
    { id: 'finalize-workflow', label: 'Finalize workflow output', status: 'pending' },
  ]

  steps[0] = completeStep(startStep(steps[0]!))
  const workflow = getWorkflowDefinition(workflowId)

  steps[1] = startStep(steps[1]!)
  let generatedCommands: CommandEnvelope[] = []
  let explanation = ''
  try {
    const generated = await deps.generateCommands({
      prompt: workflow.buildPrompt(input),
      context: input.context,
      metadata: executionContext.metadata,
      env: executionContext.env,
      db: executionContext.db,
    })
    generatedCommands = generated.commands
    explanation = generated.explanation
    steps[1] = completeStep(steps[1]!)
  } catch {
    steps[1] = failStep(steps[1]!)
  }

  steps[2] = startStep(steps[2]!)
  const fallbackCommands = workflow.fallbackCommands(input)
  const commands = generatedCommands.length > 0 ? generatedCommands : fallbackCommands
  const resolvedExplanation =
    explanation.trim().length > 0
      ? explanation
      : `Workflow "${workflow.label}" prepared ${commands.length} command(s).`
  steps[2] = completeStep(steps[2]!)

  return {
    workflow: workflowId,
    commands,
    explanation: resolvedExplanation,
    steps,
  }
}
