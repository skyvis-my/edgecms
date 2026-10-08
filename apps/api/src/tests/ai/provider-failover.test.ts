import { describe, expect, it } from 'bun:test'

/**
 * AI Provider Failover Tests
 * 
 * The failover logic is implemented via a Proxy wrapper in the registry.
 * Full integration testing requires actual API keys and is done at runtime.
 * These tests verify the basic registry functionality.
 */

describe('AI Provider Registry', () => {
  it('throws error when no provider is configured', async () => {
    const { getModel } = await import(`../../ai/providers/registry?bypass=${Date.now()}`)
    
    expect(() => {
      getModel('mid', {
        QWEN_API_KEY: undefined,
        GEMINI_API_KEY: undefined,
      })
    }).toThrow('No AI provider configured')
  })

  it('exports hasAIProvider utility function', async () => {
    const { hasAIProvider } = await import(`../../ai/providers/registry?bypass=${Date.now()}`)
    
    expect(hasAIProvider({ QWEN_API_KEY: 'key' })).toBe(true)
    expect(hasAIProvider({ GEMINI_API_KEY: 'key' })).toBe(true)
    expect(hasAIProvider({})).toBe(false)
  })

  it('exports getPrimaryProvider utility function', async () => {
    const { getPrimaryProvider } = await import(`../../ai/providers/registry?bypass=${Date.now()}`)
    
    expect(getPrimaryProvider({ QWEN_API_KEY: 'key' })).toBe('qwen')
    expect(getPrimaryProvider({ GEMINI_API_KEY: 'key' })).toBe('gemini')
    expect(getPrimaryProvider({})).toBe('none')
  })

  it('exports ModelTier type variants', async () => {
    const registry = await import(`../../ai/providers/registry?bypass=${Date.now()}`)
    
    // Verify the module exports the expected types/functions
    expect(registry.getModel).toBeDefined()
    expect(registry.hasAIProvider).toBeDefined()
    expect(registry.getPrimaryProvider).toBeDefined()
  })
})
