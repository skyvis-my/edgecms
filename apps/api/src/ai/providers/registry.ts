import type { LanguageModel } from 'ai'
import { createGatewayProviders, type AIGatewayConfig } from '../gateway/ai-gateway.service'
import { getGemini2Flash, getGemini25Flash } from './gemini'
import { getQwen3_235B, getQwen3Max, getQwenTurbo } from './qwen'
import { logger } from '@/observability/logger'

/**
 * AI Provider Registry
 *
 * Provides tier-based model selection with primary (Qwen) and fallback (Gemini) providers.
 * Automatically routes all LLM calls through Cloudflare AI Gateway when configured.
 *
 * Environment variables:
 *   - QWEN_API_KEY: Primary provider (DashScope)
 *   - GEMINI_API_KEY: Fallback provider (Google AI)
 *   - AI_GATEWAY_URL: Optional Cloudflare AI Gateway URL for caching, rate limiting, and observability
 */

/**
 * Model tier for selecting appropriate AI model based on task complexity.
 *
 * - nano: Fast, efficient models for simple tasks (Qwen Turbo / Gemini 2.0 Flash)
 * - mid: Balanced models for general-purpose tasks (Qwen3 235B / Gemini 2.0 Flash)
 * - heavy: Most capable models for complex reasoning (Qwen3 Max / Gemini 2.5 Flash)
 */
export type ModelTier = 'nano' | 'mid' | 'heavy'
type ResolvedLanguageModel = Exclude<LanguageModel, string>

function asResolvedLanguageModel(model: LanguageModel): ResolvedLanguageModel {
  if (typeof model === 'string') {
    throw new Error('Expected a provider-backed language model instance')
  }
  return model
}

/**
 * Create a failover wrapper for AI model calls.
 *
 * Failover logic:
 * 1. Call the primary model generator
 * 2. On error, log warning and retry once
 * 3. On second error, call fallback if available
 * 4. If no fallback or fallback fails, throw original error
 *
 * @param primary - Function that returns the primary model
 * @param fallback - Optional function that returns the fallback model
 * @param tier - Model tier for logging
 * @returns Language model with failover capability
 */
function createFailoverModel(
  primary: () => ResolvedLanguageModel,
  fallback: (() => ResolvedLanguageModel) | undefined,
  tier: ModelTier
): ResolvedLanguageModel {
  // Return a proxy that wraps the model's generate methods with failover logic
  const primaryModel = primary()

  return new Proxy(primaryModel, {
    get(target, prop, receiver) {
      const originalValue = Reflect.get(target as object, prop, receiver)

      // Only wrap function properties that are likely to be model generation methods
      if (typeof originalValue !== 'function') {
        return originalValue
      }

      // Wrap the function with failover logic
      return async function (...args: unknown[]) {
        try {
          return await (originalValue as (...args: unknown[]) => Promise<unknown>)(...args)
        } catch (primaryError) {
          logger.warn('ai_provider_primary_failed', {
            tier,
            error: primaryError instanceof Error ? primaryError.message : String(primaryError),
            willRetry: true,
          })
          
          // Retry once
          try {
            return await (originalValue as (...args: unknown[]) => Promise<unknown>)(...args)
          } catch (retryError) {
            logger.warn('ai_provider_retry_failed', {
              tier,
              error: retryError instanceof Error ? retryError.message : String(retryError),
              hasFallback: !!fallback,
            })
            
            // Try fallback if available
            if (fallback) {
              try {
                const fallbackModel = fallback()
                const fallbackMethod = Reflect.get(fallbackModel as object, prop)
                if (typeof fallbackMethod === 'function') {
                  logger.info('ai_provider_failover_triggered', {
                    tier,
                    from: 'primary',
                    to: 'fallback',
                  })
                  return await (fallbackMethod as (...args: unknown[]) => Promise<unknown>)(...args)
                }
              } catch (fallbackError) {
                logger.error('ai_provider_fallback_failed', {
                  tier,
                  error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
                })
                // Throw original error
                throw primaryError
              }
            }
            
            // No fallback available, throw original error
            throw primaryError
          }
        }
      }
    },
  })
}

/**
 * Environment interface for AI provider configuration.
 */
export interface AIEnv {
  QWEN_API_KEY?: string
  GEMINI_API_KEY?: string
  AI_GATEWAY_URL?: string
  AI_GATEWAY_ROUTE_ID?: string
  AI_GATEWAY_GUARDRAILS_PROFILE_ID?: string
}

/**
 * Get an AI model based on tier and available API keys.
 *
 * Selection logic:
 * 1. If AI_GATEWAY_URL is configured, route through Cloudflare AI Gateway
 * 2. If QWEN_API_KEY is available, use Qwen as primary provider
 * 3. If QWEN_API_KEY is not available but GEMINI_API_KEY is, use Gemini
 * 4. If neither is available, throw an error
 *
 * @param tier - Model tier (nano, mid, heavy)
 * @param env - Environment containing API keys and gateway URL
 * @returns Language model instance
 * @throws Error if no API keys are configured
 */
export interface ModelRequestOptions {
  tenantId?: string
  tenantSlug?: string
  requestIntent?: string
  routeClass?: string
}

export function getModel(tier: ModelTier, env: AIEnv, options?: ModelRequestOptions): LanguageModel {
  const qwenKey = env.QWEN_API_KEY
  const geminiKey = env.GEMINI_API_KEY
  const gatewayUrl = env.AI_GATEWAY_URL

  // Helper to get primary and fallback model generators
  const getPrimaryModel = (): ResolvedLanguageModel => {
    if (gatewayUrl && qwenKey) {
      const gatewayConfig: AIGatewayConfig = {
        routeId: env.AI_GATEWAY_ROUTE_ID,
        guardrailsProfileId: env.AI_GATEWAY_GUARDRAILS_PROFILE_ID,
        requestIntent: options?.requestIntent,
        commandTier: tier,
        routeClass: options?.routeClass,
        tenantId: options?.tenantId,
        tenantSlug: options?.tenantSlug,
      }
      const providers = createGatewayProviders(qwenKey, geminiKey, gatewayUrl, gatewayConfig)
      switch (tier) {
        case 'nano': return asResolvedLanguageModel(providers.qwen.turbo())
        case 'mid': return asResolvedLanguageModel(providers.qwen.mid())
        case 'heavy': return asResolvedLanguageModel(providers.qwen.max())
      }
    }
    if (!qwenKey) {
      throw new Error('Qwen API key not configured')
    }
    // Direct access (no gateway)
    switch (tier) {
      case 'nano': return getQwenTurbo(qwenKey)
      case 'mid': return getQwen3_235B(qwenKey)
      case 'heavy': return getQwen3Max(qwenKey)
    }
  }

  const getFallbackModel = (): ResolvedLanguageModel => {
    if (gatewayUrl && geminiKey) {
      const gatewayConfig: AIGatewayConfig = {
        routeId: env.AI_GATEWAY_ROUTE_ID,
        guardrailsProfileId: env.AI_GATEWAY_GUARDRAILS_PROFILE_ID,
        requestIntent: options?.requestIntent,
        commandTier: tier,
        routeClass: options?.routeClass,
        tenantId: options?.tenantId,
        tenantSlug: options?.tenantSlug,
      }
      const providers = createGatewayProviders(qwenKey, geminiKey, gatewayUrl, gatewayConfig)
      switch (tier) {
        case 'nano':
        case 'mid': return asResolvedLanguageModel(providers.gemini.flash2())
        case 'heavy': return asResolvedLanguageModel(providers.gemini.flash25())
      }
    }
    if (!geminiKey) {
      throw new Error('Gemini API key not configured')
    }
    // Direct access (no gateway)
    switch (tier) {
      case 'nano':
      case 'mid': return getGemini2Flash(geminiKey)
      case 'heavy': return getGemini25Flash(geminiKey)
    }
  }

  // Use gateway providers if gateway URL is configured
  if (gatewayUrl && (qwenKey || geminiKey)) {
    // Both providers configured: use failover wrapper
    if (qwenKey && geminiKey) {
      return createFailoverModel(getPrimaryModel, getFallbackModel, tier)
    }
    
    // Only Qwen configured
    if (qwenKey) {
      return getPrimaryModel()
    }
    
    // Only Gemini configured
    if (geminiKey) {
      return getFallbackModel()
    }
  }

  // Direct access (no gateway) - legacy behavior
  // Both providers configured: use failover wrapper
  if (qwenKey && geminiKey) {
    return createFailoverModel(getPrimaryModel, getFallbackModel, tier)
  }

  // Primary provider: Qwen (DashScope)
  if (qwenKey) {
    return getPrimaryModel()
  }

  // Fallback provider: Gemini
  if (geminiKey) {
    return getFallbackModel()
  }

  throw new Error(
    'No AI provider configured. Set either QWEN_API_KEY or GEMINI_API_KEY environment variable.'
  )
}

/**
 * Check if any AI provider is configured.
 *
 * @param env - Environment containing API keys
 * @returns true if at least one provider is available
 */
export function hasAIProvider(env: AIEnv): boolean {
  return Boolean(env.QWEN_API_KEY || env.GEMINI_API_KEY)
}

/**
 * Get the name of the currently active primary provider.
 *
 * @param env - Environment containing API keys
 * @returns Provider name or 'none' if no provider is configured
 */
export function getPrimaryProvider(env: AIEnv): 'qwen' | 'gemini' | 'none' {
  if (env.QWEN_API_KEY) return 'qwen'
  if (env.GEMINI_API_KEY) return 'gemini'
  return 'none'
}
