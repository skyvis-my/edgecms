import { createOpenAI } from '@ai-sdk/openai'

/**
 * Qwen (DashScope) AI Provider Configuration
 *
 * Uses OpenAI-compatible API endpoint provided by Alibaba Cloud DashScope.
 * DashScope offers multiple Qwen models suitable for different performance tiers.
 *
 * @see https://help.aliyun.com/zh/model-studio/developer-reference/compatibility-of-openai-with-dashscope
 */

/**
 * Create a Qwen provider instance configured for DashScope.
 *
 * @param apiKey - DashScope API key (from QWEN_API_KEY environment variable)
 * @returns OpenAI-compatible provider instance
 */
export function createQwenProvider(apiKey: string) {
  return createOpenAI({
    apiKey,
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  })
}

/**
 * Get Qwen Turbo model (nano tier)
 *
 * Fast, efficient model for simple tasks and high-volume usage.
 *
 * @param apiKey - DashScope API key
 */
export function getQwenTurbo(apiKey: string) {
  const provider = createQwenProvider(apiKey)
  return provider('qwen-turbo')
}

/**
 * Get Qwen3 235B A22B model (mid tier)
 *
 * Balanced performance model for general-purpose tasks.
 *
 * @param apiKey - DashScope API key
 */
export function getQwen3_235B(apiKey: string) {
  const provider = createQwenProvider(apiKey)
  return provider('qwen3-235b-a22b')
}

/**
 * Get Qwen3 Max model (heavy tier)
 *
 * Most capable model for complex reasoning and nuanced tasks.
 *
 * @param apiKey - DashScope API key
 */
export function getQwen3Max(apiKey: string) {
  const provider = createQwenProvider(apiKey)
  return provider('qwen3-max')
}
