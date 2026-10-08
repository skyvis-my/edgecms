import type { LanguageModel } from 'ai'
import type { CommandType } from '@/shared/schemas'
import { getModel, type ModelTier } from '../providers/registry'

/**
 * Model Router
 *
 * Routes command types to appropriate AI model tiers based on task complexity.
 * Tier selection optimizes for latency and cost while ensuring adequate reasoning capability.
 *
 * Routing tiers:
 * - Nano: Fast, efficient models for simple CRUD operations
 * - Mid: Balanced models for moderate complexity (bulk updates, relations, scheduling)
 * - Heavy: Most capable models for complex reasoning (transactions, cross-collection ops)
 */

/**
 * Environment interface for model router.
 */
export interface ModelRouterEnv {
  QWEN_API_KEY?: string
  GEMINI_API_KEY?: string
}

/**
 * Command type to model tier mapping.
 *
 * Exported for testability and potential runtime configuration.
 */
export const COMMAND_TIER_MAP: Record<CommandType, ModelTier> = {
  // Nano tier: Simple single-entity operations
  createEntry: 'nano',
  updateEntry: 'nano',
  deleteEntry: 'nano',
  publishNow: 'nano',
  unpublishNow: 'nano',

  // Mid tier: Moderate complexity operations
  bulkUpdate: 'mid',
  linkRelation: 'mid',
  unlinkRelation: 'mid',
  updateSingleton: 'mid',
  schedulePublish: 'mid',
  scheduleUnpublish: 'mid',
  cancelSchedule: 'mid',

  // Heavy tier: Complex reasoning required
  transaction: 'heavy',
}

/**
 * Get the appropriate AI model for a given command type.
 *
 * @param commandType - The type of command to be executed
 * @param env - Environment containing API keys
 * @returns Language model instance configured for the command's complexity tier
 * @throws Error if no AI provider is configured
 */
export function getModelForCommand(commandType: CommandType, env: ModelRouterEnv): LanguageModel {
  const tier = COMMAND_TIER_MAP[commandType] ?? 'heavy'
  return getModel(tier, env)
}

/**
 * Get the tier for a given command type.
 *
 * Useful for telemetry, logging, and debugging.
 *
 * @param commandType - The type of command
 * @returns Model tier (nano, mid, heavy)
 */
export function getTierForCommand(commandType: CommandType): ModelTier {
  return COMMAND_TIER_MAP[commandType] ?? 'heavy'
}

export function inferTierForPrompt(prompt: string): ModelTier {
  const text = prompt.toLowerCase()

  if (text.includes('transaction') || text.includes('across collections')) {
    return 'heavy'
  }

  if (
    text.includes('bulk') ||
    text.includes('relation') ||
    text.includes('schedule') ||
    text.includes('publish at') ||
    text.includes('unpublish at')
  ) {
    return 'mid'
  }

  return 'nano'
}
