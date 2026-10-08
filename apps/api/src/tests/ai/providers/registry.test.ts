import { describe, expect, it } from 'bun:test'

const { getModel, getPrimaryProvider, hasAIProvider } = await import(
  `../../../ai/providers/registry?bypass=${Date.now()}`
)

describe('AI Provider Registry', () => {
  describe('hasAIProvider', () => {
    it('returns true when QWEN_API_KEY is set', () => {
      const env = { QWEN_API_KEY: 'test-qwen-key' }
      expect(hasAIProvider(env)).toBe(true)
    })

    it('returns true when GEMINI_API_KEY is set', () => {
      const env = { GEMINI_API_KEY: 'test-gemini-key' }
      expect(hasAIProvider(env)).toBe(true)
    })

    it('returns true when both keys are set', () => {
      const env = {
        QWEN_API_KEY: 'test-qwen-key',
        GEMINI_API_KEY: 'test-gemini-key',
      }
      expect(hasAIProvider(env)).toBe(true)
    })

    it('returns false when no keys are set', () => {
      const env = {}
      expect(hasAIProvider(env)).toBe(false)
    })
  })

  describe('getPrimaryProvider', () => {
    it('returns "qwen" when QWEN_API_KEY is set', () => {
      const env = { QWEN_API_KEY: 'test-qwen-key' }
      expect(getPrimaryProvider(env)).toBe('qwen')
    })

    it('returns "qwen" when both keys are set (Qwen takes precedence)', () => {
      const env = {
        QWEN_API_KEY: 'test-qwen-key',
        GEMINI_API_KEY: 'test-gemini-key',
      }
      expect(getPrimaryProvider(env)).toBe('qwen')
    })

    it('returns "gemini" when only GEMINI_API_KEY is set', () => {
      const env = { GEMINI_API_KEY: 'test-gemini-key' }
      expect(getPrimaryProvider(env)).toBe('gemini')
    })

    it('returns "none" when no keys are set', () => {
      const env = {}
      expect(getPrimaryProvider(env)).toBe('none')
    })
  })

  describe('getModel', () => {
    describe('with Qwen provider', () => {
      const env = { QWEN_API_KEY: 'test-qwen-key' }

      it('returns Qwen Turbo model for nano tier', () => {
        const model = getModel('nano', env)
        expect(model).toBeDefined()
        // oxlint-disable-next-line lint/suspicious/noExplicitAny: Testing internal model property
        expect((model as any).modelId).toBe('qwen-turbo')
      })

      it('returns Qwen3 235B model for mid tier', () => {
        const model = getModel('mid', env)
        expect(model).toBeDefined()
        // oxlint-disable-next-line lint/suspicious/noExplicitAny: Testing internal model property
        expect((model as any).modelId).toBe('qwen3-235b-a22b')
      })

      it('returns Qwen3 Max model for heavy tier', () => {
        const model = getModel('heavy', env)
        expect(model).toBeDefined()
        // oxlint-disable-next-line lint/suspicious/noExplicitAny: Testing internal model property
        expect((model as any).modelId).toBe('qwen3-max')
      })
    })

    describe('with Gemini provider', () => {
      const env = { GEMINI_API_KEY: 'test-gemini-key' }

      it('returns Gemini 2.0 Flash model for nano tier', () => {
        const model = getModel('nano', env)
        expect(model).toBeDefined()
        // oxlint-disable-next-line lint/suspicious/noExplicitAny: Testing internal model property
        expect((model as any).modelId).toBe('gemini-2.0-flash')
      })

      it('returns Gemini 2.0 Flash model for mid tier', () => {
        const model = getModel('mid', env)
        expect(model).toBeDefined()
        // oxlint-disable-next-line lint/suspicious/noExplicitAny: Testing internal model property
        expect((model as any).modelId).toBe('gemini-2.0-flash')
      })

      it('returns Gemini 2.5 Flash model for heavy tier', () => {
        const model = getModel('heavy', env)
        expect(model).toBeDefined()
        // oxlint-disable-next-line lint/suspicious/noExplicitAny: Testing internal model property
        expect((model as any).modelId).toBe('gemini-2.5-flash')
      })
    })

    describe('fallback behavior', () => {
      it('prefers Qwen when both providers are configured', () => {
        const env = {
          QWEN_API_KEY: 'test-qwen-key',
          GEMINI_API_KEY: 'test-gemini-key',
        }
        const model = getModel('nano', env)
        // oxlint-disable-next-line lint/suspicious/noExplicitAny: Testing internal model property
        expect((model as any).modelId).toBe('qwen-turbo')
      })

      it('throws error when no provider is configured', () => {
        const env = {}
        expect(() => getModel('nano', env)).toThrow(
          'No AI provider configured. Set either QWEN_API_KEY or GEMINI_API_KEY environment variable.'
        )
      })
    })

    describe('with AI Gateway', () => {
      it('routes Qwen through gateway when AI_GATEWAY_URL is configured', () => {
        const env = {
          QWEN_API_KEY: 'test-qwen-key',
          AI_GATEWAY_URL: 'https://gateway.ai.cloudflare.com/v1/account-id/gateway-id',
        }
        const model = getModel('nano', env)
        expect(model).toBeDefined()
        // oxlint-disable-next-line lint/suspicious/noExplicitAny: Testing internal model property
        expect((model as any).modelId).toBe('qwen-turbo')
      })

      it('routes Gemini through gateway when AI_GATEWAY_URL is configured', () => {
        const env = {
          GEMINI_API_KEY: 'test-gemini-key',
          AI_GATEWAY_URL: 'https://gateway.ai.cloudflare.com/v1/account-id/gateway-id',
        }
        const model = getModel('nano', env)
        expect(model).toBeDefined()
        // oxlint-disable-next-line lint/suspicious/noExplicitAny: Testing internal model property
        expect((model as any).modelId).toBe('gemini-2.0-flash')
      })

      it('works with all model tiers through gateway', () => {
        const env = {
          QWEN_API_KEY: 'test-qwen-key',
          AI_GATEWAY_URL: 'https://gateway.ai.cloudflare.com/v1/account-id/gateway-id',
        }
        expect(getModel('nano', env)).toBeDefined()
        expect(getModel('mid', env)).toBeDefined()
        expect(getModel('heavy', env)).toBeDefined()
      })

      it('falls back to direct access when AI_GATEWAY_URL not configured', () => {
        const env = {
          QWEN_API_KEY: 'test-qwen-key',
        }
        const model = getModel('nano', env)
        expect(model).toBeDefined()
        // oxlint-disable-next-line lint/suspicious/noExplicitAny: Testing internal model property
        expect((model as any).modelId).toBe('qwen-turbo')
      })

      it('throws error when only AI_GATEWAY_URL is set without API keys', () => {
        const env = {
          AI_GATEWAY_URL: 'https://gateway.ai.cloudflare.com/v1/account-id/gateway-id',
        }
        expect(() => getModel('nano', env)).toThrow(
          'No AI provider configured. Set either QWEN_API_KEY or GEMINI_API_KEY environment variable.'
        )
      })
    })
  })
})
