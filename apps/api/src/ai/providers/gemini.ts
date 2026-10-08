import { createGoogleGenerativeAI } from '@ai-sdk/google'

/**
 * Google Gemini AI Provider Configuration
 *
 * Fallback provider when Qwen (DashScope) is unavailable.
 * Uses Google Generative AI API for model access.
 *
 * @see https://ai.google.dev/gemini-api/docs
 */

/**
 * Create a Gemini provider instance.
 *
 * @param apiKey - Google AI API key (from GEMINI_API_KEY environment variable)
 * @returns Gemini provider instance
 */
export function createGeminiProvider(apiKey: string) {
  return createGoogleGenerativeAI({
    apiKey,
  })
}

/**
 * Get Gemini 2.0 Flash model (nano/mid tier)
 *
 * Fast, efficient model for quick tasks and high-volume usage.
 *
 * @param apiKey - Google AI API key
 */
export function getGemini2Flash(apiKey: string) {
  const provider = createGeminiProvider(apiKey)
  return provider('gemini-2.0-flash')
}

/**
 * Get Gemini 2.5 Flash model (heavy tier)
 *
 * Enhanced flash model with improved reasoning capabilities.
 *
 * @param apiKey - Google AI API key
 */
export function getGemini25Flash(apiKey: string) {
  const provider = createGeminiProvider(apiKey)
  return provider('gemini-2.5-flash')
}
