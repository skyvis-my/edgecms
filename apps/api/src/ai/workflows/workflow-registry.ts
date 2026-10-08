import type { CommandEnvelope } from '@edgecms/schemas/commands'
import { bulkUpdateWorkflow } from './bulk-update'
import { localizeFieldsWorkflow } from './localize-fields'
import { transactionBuilderWorkflow } from './transaction-builder'

export type WorkflowId = 'bulk_update' | 'bulk_localization' | 'transaction_builder'

export interface WorkflowInput {
  prompt: string
  context?: {
    collectionSlug?: string
    entryId?: string
  }
}

export interface WorkflowDefinition {
  id: WorkflowId
  label: string
  buildPrompt: (input: WorkflowInput) => string
  fallbackCommands: (input: WorkflowInput) => CommandEnvelope[]
}

export const WORKFLOW_REGISTRY: Record<WorkflowId, WorkflowDefinition> = {
  bulk_update: bulkUpdateWorkflow,
  bulk_localization: localizeFieldsWorkflow,
  transaction_builder: transactionBuilderWorkflow,
}

export function getWorkflowDefinition(workflowId: WorkflowId): WorkflowDefinition {
  return WORKFLOW_REGISTRY[workflowId]
}
