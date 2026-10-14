import { createOpenAI } from '@ai-sdk/openai'

/**
 * Google Gemini AI Provider Configuration
 *
 * Configured via Google's official OpenAI-compatible endpoint:
 * https://generativelanguage.googleapis.com/v1beta/openai
 *
 * Eliminates vendor-specific Google SDK transport bloat while preserving full model support.
 */

/**
 * Create a Gemini provider instance using OpenAI-compatible transport.
 *
 * @param apiKey - Google AI API key (from GEMINI_API_KEY environment variable)
 * @param baseURL - Optional custom base URL or AI gateway prefix
 * @returns OpenAI-compatible provider instance pointing to Gemini
 */
export function createGeminiProvider(apiKey: string, baseURL?: string) {
  return createOpenAI({
    apiKey,
    baseURL: baseURL ?? 'https://generativelanguage.googleapis.com/v1beta/openai',
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
