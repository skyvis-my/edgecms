import { describe, expect, it, vi } from 'bun:test'
import type { Database } from '@/database/db'
import type { Env } from '@/env'
import type { CommandEnvelope } from '@edgecms/schemas/commands'

const { runWorkflow } = await import(`../../ai/workflows/workflow-engine?bypass=${Date.now()}`)

describe('AI workflows', () => {
  it('bulk update workflow produces bulkUpdate command', async () => {
    const result = await runWorkflow(
      'bulk_update',
      { prompt: 'Publish all draft entries in this collection.' },
      { env: {} as Env, db: {} as Database },
      {
        generateCommands: vi.fn().mockResolvedValue({
          commands: [] as CommandEnvelope[],
          explanation: 'Fallback to workflow defaults.',
        }),
      }
    )

    expect(
      result.commands.some((command: CommandEnvelope) => command.type === 'bulkUpdate')
    ).toBe(true)
  })

  it('transaction builder workflow produces transaction command', async () => {
    const result = await runWorkflow(
      'transaction_builder',
      { prompt: 'Create entry and publish immediately as one transaction.' },
      { env: {} as Env, db: {} as Database },
      {
        generateCommands: vi.fn().mockResolvedValue({
          commands: [] as CommandEnvelope[],
          explanation: 'Fallback to workflow defaults.',
        }),
      }
    )

    expect(
      result.commands.some((command: CommandEnvelope) => command.type === 'transaction')
    ).toBe(true)
  })
})
