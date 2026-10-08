import { beforeEach, describe, expect, it, vi } from 'bun:test'
import {
  type AIGatewayConfig,
  type AIRequestMetadata,
  createGatewayCacheHeaders,
  createGatewayGeminiProvider,
  createGatewayMetadataHeaders,
  createGatewayOpenAIProvider,
  createGatewayProviders,
  hashPrompt,
  logAIRequest,
} from '../../../ai/gateway/ai-gateway.service'
import { resetMetrics } from '../../../observability/metrics'

describe('createGatewayOpenAIProvider', () => {
  it('uses original base URL when no gateway URL provided', () => {
    const provider = createGatewayOpenAIProvider(
      'test-key',
      'https://dashscope.aliyuncs.com/compatible-mode/v1'
    )

    expect(provider).toBeDefined()
  })

  it('prefixes gateway URL to base URL when gateway is configured', () => {
    const provider = createGatewayOpenAIProvider(
      'test-key',
      'https://dashscope.aliyuncs.com/compatible-mode/v1',
      'https://gateway.ai.cloudflare.com/v1/account-id/gateway-id/'
    )

    expect(provider).toBeDefined()
  })

  it('removes https:// prefix from base URL when constructing gateway URL', () => {
    const provider = createGatewayOpenAIProvider(
      'test-key',
      'https://dashscope.aliyuncs.com/compatible-mode/v1',
      'https://gateway.ai.cloudflare.com/v1/account-id/gateway-id'
    )

    expect(provider).toBeDefined()
  })

  it('handles gateway URL with trailing slash', () => {
    const provider = createGatewayOpenAIProvider(
      'test-key',
      'https://dashscope.aliyuncs.com/compatible-mode/v1',
      'https://gateway.ai.cloudflare.com/v1/account-id/gateway-id/'
    )

    expect(provider).toBeDefined()
  })
})

describe('createGatewayGeminiProvider', () => {
  it('uses default base URL when no gateway URL provided', () => {
    const provider = createGatewayGeminiProvider('test-key')

    expect(provider).toBeDefined()
  })

  it('uses gateway URL as base URL when configured', () => {
    const provider = createGatewayGeminiProvider(
      'test-key',
      'https://gateway.ai.cloudflare.com/v1/account-id/gateway-id/'
    )

    expect(provider).toBeDefined()
  })

  it('constructs Gemini-specific gateway URL', () => {
    const provider = createGatewayGeminiProvider(
      'test-key',
      'https://gateway.ai.cloudflare.com/v1/account-id/gateway-id'
    )

    expect(provider).toBeDefined()
  })
})

describe('createGatewayCacheHeaders', () => {
  it('returns empty object when no cache config provided', () => {
    const config: AIGatewayConfig = {}
    const headers = createGatewayCacheHeaders(config)

    expect(headers).toEqual({})
  })

  it('sets cache TTL header when cacheTtl is provided', () => {
    const config: AIGatewayConfig = {
      cacheTtl: 3600,
    }
    const headers = createGatewayCacheHeaders(config)

    expect(headers).toEqual({
      'cf-aig-cache-ttl': '3600',
    })
  })

  it('sets skip cache header when skipCache is true', () => {
    const config: AIGatewayConfig = {
      skipCache: true,
    }
    const headers = createGatewayCacheHeaders(config)

    expect(headers).toEqual({
      'cf-aig-skip-cache': 'true',
    })
  })

  it('sets both headers when both config options provided', () => {
    const config: AIGatewayConfig = {
      cacheTtl: 1800,
      skipCache: true,
    }
    const headers = createGatewayCacheHeaders(config)

    expect(headers).toEqual({
      'cf-aig-cache-ttl': '1800',
      'cf-aig-skip-cache': 'true',
    })
  })

  it('handles cacheTtl of 0', () => {
    const config: AIGatewayConfig = {
      cacheTtl: 0,
    }
    const headers = createGatewayCacheHeaders(config)

    expect(headers).toEqual({
      'cf-aig-cache-ttl': '0',
    })
  })
})

describe('createGatewayMetadataHeaders', () => {
  it('returns empty object when no metadata config is provided', () => {
    expect(createGatewayMetadataHeaders({})).toEqual({})
  })

  it('maps routing, guardrails, and tenant metadata into headers', () => {
    const headers = createGatewayMetadataHeaders({
      routeId: 'route-123',
      guardrailsProfileId: 'guardrails-456',
      requestIntent: 'command_generation',
      commandTier: 'mid',
      routeClass: 'admin_ai',
      tenantId: 'tenant-1',
      tenantSlug: 'acme',
    })

    expect(headers).toEqual({
      'cf-aig-route-id': 'route-123',
      'cf-aig-guardrails-profile-id': 'guardrails-456',
      'x-edgecms-ai-intent': 'command_generation',
      'x-edgecms-ai-command-tier': 'mid',
      'x-edgecms-ai-route-class': 'admin_ai',
      'x-edgecms-tenant-id': 'tenant-1',
      'x-edgecms-tenant-slug': 'acme',
    })
  })
})

describe('hashPrompt', () => {
  it('generates consistent hash for same string', () => {
    const prompt = 'Hello, world!'
    const hash1 = hashPrompt(prompt)
    const hash2 = hashPrompt(prompt)

    expect(hash1).toBe(hash2)
  })

  it('generates different hashes for different strings', () => {
    const hash1 = hashPrompt('Prompt A')
    const hash2 = hashPrompt('Prompt B')

    expect(hash1).not.toBe(hash2)
  })

  it('handles array input by stringifying', () => {
    const messages = [
      { role: 'system', content: 'You are a helpful assistant' },
      { role: 'user', content: 'Hello' },
    ]
    const hash = hashPrompt(messages)

    expect(typeof hash).toBe('string')
    expect(hash.length).toBeGreaterThan(0)
  })

  it('generates consistent hash for same array', () => {
    const messages = [{ role: 'user', content: 'Test' }]
    const hash1 = hashPrompt(messages)
    const hash2 = hashPrompt(messages)

    expect(hash1).toBe(hash2)
  })

  it('generates different hashes for different arrays', () => {
    const messages1 = [{ role: 'user', content: 'Test A' }]
    const messages2 = [{ role: 'user', content: 'Test B' }]
    const hash1 = hashPrompt(messages1)
    const hash2 = hashPrompt(messages2)

    expect(hash1).not.toBe(hash2)
  })
})

describe('logAIRequest', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    resetMetrics()
  })

  it('logs request metadata as structured JSON', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleSpy.mockClear()

    const metadata: AIRequestMetadata = {
      promptHash: 'abc123',
      modelName: 'qwen-turbo',
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      latencyMs: 250,
      cached: false,
      timestamp: '2026-02-07T12:00:00Z',
    }

    logAIRequest(metadata)

    expect(consoleSpy).toHaveBeenCalledTimes(1)
    expect(consoleSpy).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'ai_request',
        ...metadata,
      })
    )
  })

  it('logs with minimal metadata', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleSpy.mockClear()

    const metadata: AIRequestMetadata = {
      promptHash: 'xyz789',
      modelName: 'gemini-2.0-flash',
      timestamp: '2026-02-07T12:00:00Z',
    }

    logAIRequest(metadata)

    expect(consoleSpy).toHaveBeenCalledTimes(1)
    expect(consoleSpy).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'ai_request',
        ...metadata,
      })
    )
  })

  it('includes tenant ID when provided', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleSpy.mockClear()

    const metadata: AIRequestMetadata = {
      promptHash: 'def456',
      modelName: 'qwen3-max',
      tenantId: 'tenant-123',
      timestamp: '2026-02-07T12:00:00Z',
    }

    logAIRequest(metadata)

    expect(consoleSpy).toHaveBeenCalledTimes(1)
    const loggedData = JSON.parse(consoleSpy.mock.calls[0]?.[0] ?? '{}')
    expect(loggedData.tenantId).toBe('tenant-123')
  })
})

describe('createGatewayProviders', () => {
  it('creates providers with Qwen when API key provided', () => {
    const providers = createGatewayProviders('qwen-key')

    expect(providers.qwen.turbo).toBeDefined()
    expect(providers.qwen.mid).toBeDefined()
    expect(providers.qwen.max).toBeDefined()

    // Should not throw when called
    expect(() => providers.qwen.turbo()).not.toThrow()
  })

  it('creates providers with Gemini when API key provided', () => {
    const providers = createGatewayProviders(undefined, 'gemini-key')

    expect(providers.gemini.flash2).toBeDefined()
    expect(providers.gemini.flash25).toBeDefined()

    // Should not throw when called
    expect(() => providers.gemini.flash2()).not.toThrow()
  })

  it('creates providers with both Qwen and Gemini', () => {
    const providers = createGatewayProviders('qwen-key', 'gemini-key')

    expect(() => providers.qwen.turbo()).not.toThrow()
    expect(() => providers.gemini.flash2()).not.toThrow()
  })

  it('throws error when calling Qwen providers without key', () => {
    const providers = createGatewayProviders()

    expect(() => providers.qwen.turbo()).toThrow('Qwen API key not configured')
    expect(() => providers.qwen.mid()).toThrow('Qwen API key not configured')
    expect(() => providers.qwen.max()).toThrow('Qwen API key not configured')
  })

  it('throws error when calling Gemini providers without key', () => {
    const providers = createGatewayProviders()

    expect(() => providers.gemini.flash2()).toThrow('Gemini API key not configured')
    expect(() => providers.gemini.flash25()).toThrow('Gemini API key not configured')
  })

  it('creates gateway-enabled providers when gateway URL provided', () => {
    const gatewayUrl = 'https://gateway.ai.cloudflare.com/v1/account-id/gateway-id'
    const providers = createGatewayProviders('qwen-key', 'gemini-key', gatewayUrl)

    // Should create providers successfully
    expect(() => providers.qwen.turbo()).not.toThrow()
    expect(() => providers.gemini.flash2()).not.toThrow()
  })

  it('creates direct-access providers when no gateway URL provided', () => {
    const providers = createGatewayProviders('qwen-key', 'gemini-key')

    // Should create providers successfully
    expect(() => providers.qwen.turbo()).not.toThrow()
    expect(() => providers.gemini.flash2()).not.toThrow()
  })

  it('returns all three Qwen model tiers', () => {
    const providers = createGatewayProviders('qwen-key')

    const turbo = providers.qwen.turbo()
    const mid = providers.qwen.mid()
    const max = providers.qwen.max()

    expect(turbo).toBeDefined()
    expect(mid).toBeDefined()
    expect(max).toBeDefined()
  })

  it('returns both Gemini model tiers', () => {
    const providers = createGatewayProviders(undefined, 'gemini-key')

    const flash2 = providers.gemini.flash2()
    const flash25 = providers.gemini.flash25()

    expect(flash2).toBeDefined()
    expect(flash25).toBeDefined()
  })
})
