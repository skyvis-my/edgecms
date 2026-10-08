import { describe, expect, it, vi } from 'bun:test'
import type { Database } from '@/database/db'
import type { Env } from '@/env'
import type { CommandEnvelope } from '@edgecms/schemas/commands'

const { runWorkflow } = await import(`../../ai/workflows/workflow-engine?bypass=${Date.now()}`)

describe('workflow-engine', () => {
  it('executes multi-step AI workflow and returns command set', async () => {
    const generateCommands = vi.fn().mockResolvedValue({
      commands: [] as CommandEnvelope[],
      explanation: 'No direct tool call generated.',
    })

    const result = await runWorkflow(
      'bulk_localization',
      { prompt: 'Translate all title fields to French.' },
      { env: {} as Env, db: {} as Database },
      { generateCommands }
    )

    expect(generateCommands).toHaveBeenCalledTimes(1)
    expect(result.steps).toHaveLength(3)
    expect(result.commands.length).toBeGreaterThan(0)
  })
})
