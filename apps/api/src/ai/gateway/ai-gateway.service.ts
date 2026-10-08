import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModel } from 'ai'
import { incrementMetric } from '@/observability/metrics'

/**
 * Cloudflare AI Gateway Service
 *
 * Routes all LLM calls through Cloudflare AI Gateway for:
 * - Response caching (identical prompt deduplication)
 * - Rate limiting
 * - Request/response logging and observability
 *
 * @see https://developers.cloudflare.com/ai-gateway/
 */

/**
 * AI Gateway configuration options
 */
export interface AIGatewayConfig {
  /** Cloudflare AI Gateway URL (e.g., https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/) */
  gatewayUrl?: string
  /** Cache TTL in seconds for identical prompts (default: 3600 = 1 hour) */
  cacheTtl?: number
  /** Skip cache for this request */
  skipCache?: boolean
  /** Tenant identifier for multi-tenant rate limiting */
  tenantId?: string
  /** Dynamic routing policy identifier configured in AI Gateway */
  routeId?: string
  /** Guardrails profile identifier configured in AI Gateway */
  guardrailsProfileId?: string
  /** Request intent (e.g., command_generation) */
  requestIntent?: string
  /** Command tier selected by model router */
  commandTier?: string
  /** Route class for analytics segmentation */
  routeClass?: string
  /** Tenant slug for analytics segmentation */
  tenantSlug?: string
}

/**
 * Request metadata for logging
 */
export interface AIRequestMetadata {
  /** Hash of the prompt for deduplication tracking */
  promptHash: string
  /** Model name/identifier */
  modelName: string
  /** Tokens used in the request */
  promptTokens?: number
  /** Tokens used in the response */
  completionTokens?: number
  /** Total tokens used */
  totalTokens?: number
  /** Request latency in milliseconds */
  latencyMs?: number
  /** Whether response was served from cache */
  cached?: boolean
  /** Tenant identifier */
  tenantId?: string
  /** Tenant slug */
  tenantSlug?: string
  /** Request intent */
  requestIntent?: string
  /** Command tier selected for request */
  commandTier?: string
  /** Gateway route class */
  routeClass?: string
  /** Dynamic routing policy identifier */
  routeId?: string
  /** Guardrails profile identifier */
  guardrailsProfileId?: string
  /** Timestamp */
  timestamp: string
}

/**
 * Create a gateway-wrapped provider for OpenAI-compatible APIs (Qwen/DashScope).
 *
 * The gateway URL becomes the base URL prefix for OpenAI-compatible providers.
 * For example:
 * - Direct: https://dashscope.aliyuncs.com/compatible-mode/v1
 * - Via Gateway: https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/dashscope.aliyuncs.com/compatible-mode/v1
 *
 * @param apiKey - Provider API key
 * @param originalBaseUrl - Original provider base URL
 * @param gatewayUrl - AI Gateway URL (optional)
 * @returns OpenAI-compatible provider instance
 */
export function createGatewayOpenAIProvider(
  apiKey: string,
  originalBaseUrl: string,
  gatewayUrl?: string,
  headers?: Record<string, string>
) {
  const baseURL = gatewayUrl
    ? `${gatewayUrl.replace(/\/$/, '')}/${originalBaseUrl.replace(/^https?:\/\//, '')}`
    : originalBaseUrl

  return createOpenAI({
    apiKey,
    baseURL,
    headers,
  })
}

/**
 * Create a gateway-wrapped provider for Google Gemini API.
 *
 * Google's AI SDK doesn't support custom base URLs directly, so we need to
 * configure the gateway as a proxy endpoint via headers.
 *
 * @param apiKey - Google AI API key
 * @param gatewayUrl - AI Gateway URL (optional)
 * @returns Gemini provider instance
 */
export function createGatewayGeminiProvider(
  apiKey: string,
  gatewayUrl?: string,
  headers?: Record<string, string>
) {
  // Note: Google AI SDK v4 uses baseURL for the provider
  // For gateway routing, we need to use the gateway URL as baseURL
  if (gatewayUrl) {
    // Construct gateway URL for Google Gemini
    const baseURL = `${gatewayUrl.replace(/\/$/, '')}/generativelanguage.googleapis.com`

    return createGoogleGenerativeAI({
      apiKey,
      baseURL,
      headers,
    })
  }

  return createGoogleGenerativeAI({
    apiKey,
    headers,
  })
}

/**
 * Create cache control headers for AI Gateway.
 *
 * @param config - Gateway configuration
 * @returns Headers object with cache control directives
 */
export function createGatewayCacheHeaders(config: AIGatewayConfig): Record<string, string> {
  const headers: Record<string, string> = {}

  // Set cache TTL if provided
  if (config.cacheTtl !== undefined) {
    headers['cf-aig-cache-ttl'] = config.cacheTtl.toString()
  }

  // Skip cache if requested
  if (config.skipCache) {
    headers['cf-aig-skip-cache'] = 'true'
  }

  return headers
}

/**
 * Create request metadata headers for AI Gateway routing, guardrails, and analytics.
 */
export function createGatewayMetadataHeaders(config: AIGatewayConfig): Record<string, string> {
  const headers: Record<string, string> = {}

  if (config.routeId) {
    headers['cf-aig-route-id'] = config.routeId
  }

  if (config.guardrailsProfileId) {
    headers['cf-aig-guardrails-profile-id'] = config.guardrailsProfileId
  }

  if (config.requestIntent) {
    headers['x-edgecms-ai-intent'] = config.requestIntent
  }

  if (config.commandTier) {
    headers['x-edgecms-ai-command-tier'] = config.commandTier
  }

  if (config.routeClass) {
    headers['x-edgecms-ai-route-class'] = config.routeClass
  }

  if (config.tenantId) {
    headers['x-edgecms-tenant-id'] = config.tenantId
  }

  if (config.tenantSlug) {
    headers['x-edgecms-tenant-slug'] = config.tenantSlug
  }

  return headers
}

/**
 * Generate a hash for prompt deduplication tracking.
 *
 * Uses a simple hash function to create a deterministic identifier
 * for identical prompts. This is used for logging and observability,
 * not for security.
 *
 * @param prompt - The prompt string or messages array
 * @returns Hash string
 */
export function hashPrompt(prompt: string | unknown[]): string {
  const str = typeof prompt === 'string' ? prompt : JSON.stringify(prompt)

  // Simple FNV-1a hash
  let hash = 2166136261
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }

  return (hash >>> 0).toString(36)
}

/**
 * Log AI request metadata.
 *
 * Captures request details for observability and debugging.
 * Uses console.log with structured JSON for easy parsing.
 *
 * @param metadata - Request metadata
 */
export function logAIRequest(metadata: AIRequestMetadata): void {
  console.log(
    JSON.stringify({
      type: 'ai_request',
      ...metadata,
    })
  )
  incrementMetric('ai_gateway_requests_total')
  incrementMetric('ai_gateway_requests_total_by_model', { model: metadata.modelName })
}

/**
 * Gateway-enabled model providers.
 *
 * This interface provides model factory functions that automatically
 * route through AI Gateway when configured.
 */
export interface GatewayProviders {
  /** Qwen provider factory */
  qwen: {
    turbo: () => LanguageModel
    mid: () => LanguageModel
    max: () => LanguageModel
  }
  /** Gemini provider factory */
  gemini: {
    flash2: () => LanguageModel
    flash25: () => LanguageModel
  }
}

/**
 * Create gateway-enabled providers for all configured AI models.
 *
 * This function configures all providers to route through AI Gateway
 * when a gateway URL is provided. Falls back to direct access otherwise.
 *
 * @param qwenApiKey - Qwen/DashScope API key
 * @param geminiApiKey - Google Gemini API key
 * @param gatewayUrl - AI Gateway URL (optional)
 * @returns Object with model factory functions
 */
export function createGatewayProviders(
  qwenApiKey?: string,
  geminiApiKey?: string,
  gatewayUrl?: string,
  config?: AIGatewayConfig
): GatewayProviders {
  const headers = {
    ...createGatewayCacheHeaders(config ?? {}),
    ...createGatewayMetadataHeaders(config ?? {}),
  }

  const providers: GatewayProviders = {
    qwen: {
      turbo: () => {
        throw new Error('Qwen API key not configured')
      },
      mid: () => {
        throw new Error('Qwen API key not configured')
      },
      max: () => {
        throw new Error('Qwen API key not configured')
      },
    },
    gemini: {
      flash2: () => {
        throw new Error('Gemini API key not configured')
      },
      flash25: () => {
        throw new Error('Gemini API key not configured')
      },
    },
  }

  // Configure Qwen providers if key is available
  if (qwenApiKey) {
    const qwenProvider = createGatewayOpenAIProvider(
      qwenApiKey,
      'https://dashscope.aliyuncs.com/compatible-mode/v1',
      gatewayUrl,
      headers
    )

    providers.qwen = {
      turbo: () => qwenProvider('qwen-turbo'),
      mid: () => qwenProvider('qwen3-235b-a22b'),
      max: () => qwenProvider('qwen3-max'),
    }
  }

  // Configure Gemini providers if key is available
  if (geminiApiKey) {
    const geminiProvider = createGatewayGeminiProvider(geminiApiKey, gatewayUrl, headers)

    providers.gemini = {
      flash2: () => geminiProvider('gemini-2.0-flash'),
      flash25: () => geminiProvider('gemini-2.5-flash'),
    }
  }

  return providers
}
