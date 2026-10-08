import type { CommandEnvelope } from '@edgecms/schemas/commands'
import type { WorkflowDefinition, WorkflowInput } from './workflow-registry'

const DEFAULT_AI_ACTOR_ID = '00000000-0000-4000-8000-000000000000'
const SAMPLE_ENTRY_ID = '00000000-0000-4000-8000-000000000001'

function buildBulkUpdateCommand(input: WorkflowInput): CommandEnvelope {
  const prompt = input.prompt.toLowerCase()
  const status = prompt.includes('archive') ? 'archived' : 'published'
  return {
    type: 'bulkUpdate',
    payload: {
      entryIds: [SAMPLE_ENTRY_ID],
      updates: {
        status,
      },
    },
    actor: {
      userId: DEFAULT_AI_ACTOR_ID,
      source: 'ai',
    },
    timestamp: new Date().toISOString(),
  }
}

export const bulkUpdateWorkflow: WorkflowDefinition = {
  id: 'bulk_update',
  label: 'Bulk update',
  buildPrompt: (input) =>
    [
      'You are running the bulk update workflow.',
      'Return one or more bulkUpdate commands that can be safely previewed.',
      `User request: ${input.prompt}`,
    ].join('\n'),
  fallbackCommands: (input) => [buildBulkUpdateCommand(input)],
}
