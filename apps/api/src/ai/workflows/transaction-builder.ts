import type { CommandEnvelope } from '@edgecms/schemas/commands'
import type { WorkflowDefinition, WorkflowInput } from './workflow-registry'

const DEFAULT_AI_ACTOR_ID = '00000000-0000-4000-8000-000000000000'
const SAMPLE_ENTRY_ID = '00000000-0000-4000-8000-000000000003'
const SAMPLE_COLLECTION_ID = '00000000-0000-4000-8000-000000000004'

function buildTransactionCommand(input: WorkflowInput): CommandEnvelope {
  const timestamp = new Date().toISOString()
  const transactionId = crypto.randomUUID()
  const actor = {
    userId: DEFAULT_AI_ACTOR_ID,
    source: 'ai' as const,
  }

  return {
    type: 'transaction',
    payload: {
      commands: [
        {
          type: 'createEntry',
          payload: {
            collectionId: SAMPLE_COLLECTION_ID,
            slug: 'workflow-generated-entry',
            status: 'draft',
            data: {
              title: input.prompt,
            },
          },
          actor,
          transactionId,
          timestamp,
        },
        {
          type: 'publishNow',
          payload: {
            entryId: SAMPLE_ENTRY_ID,
          },
          actor,
          transactionId,
          timestamp,
        },
      ],
    },
    actor,
    timestamp,
  }
}

export const transactionBuilderWorkflow: WorkflowDefinition = {
  id: 'transaction_builder',
  label: 'Transaction builder',
  buildPrompt: (input) =>
    [
      'You are running the transaction workflow.',
      'Return a transaction command that groups dependent operations.',
      `User request: ${input.prompt}`,
    ].join('\n'),
  fallbackCommands: (input) => [buildTransactionCommand(input)],
}
