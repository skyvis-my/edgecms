import { type } from 'arktype'
import { commandEnvelope } from '@/shared/schemas'

/**
 * AI tool for executing multiple commands atomically.
 *
 * This tool allows the AI to group multiple commands into a single transaction.
 * All commands execute atomically — if any command fails, all changes are rolled back.
 *
 * Use for complex multi-step operations that must succeed or fail together.
 */
export const transactionTool = {
  name: 'transaction',
  description:
    'Execute multiple commands as a single atomic transaction. Use this when the user requests a complex operation that involves multiple steps that must all succeed together (e.g., "create a blog post and link it to an author", "duplicate this entry and publish it", "move all products from category A to category B"). If any command in the transaction fails, all changes are rolled back.',
  parameters: type({
    commands: commandEnvelope.array(),
  }),
}

export type TransactionToolParams = typeof transactionTool.parameters.infer
