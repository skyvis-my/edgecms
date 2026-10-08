import type { CommandEnvelope } from '@edgecms/schemas/commands'
import type { WorkflowDefinition, WorkflowInput } from './workflow-registry'

const DEFAULT_AI_ACTOR_ID = '00000000-0000-4000-8000-000000000000'
const SAMPLE_ENTRY_ID = '00000000-0000-4000-8000-000000000002'

function buildLocalizationCommand(input: WorkflowInput): CommandEnvelope {
  return {
    type: 'updateEntry',
    payload: {
      entryId: SAMPLE_ENTRY_ID,
      data: {
        title: {
          fr: `[Localized] ${input.prompt}`,
        },
      },
    },
    actor: {
      userId: DEFAULT_AI_ACTOR_ID,
      source: 'ai',
    },
    timestamp: new Date().toISOString(),
  }
}

export const localizeFieldsWorkflow: WorkflowDefinition = {
  id: 'bulk_localization',
  label: 'Bulk localization',
  buildPrompt: (input) =>
    [
      'You are running the localization workflow.',
      'Generate updateEntry commands with locale maps in data fields.',
      `User request: ${input.prompt}`,
    ].join('\n'),
  fallbackCommands: (input) => [buildLocalizationCommand(input)],
}
