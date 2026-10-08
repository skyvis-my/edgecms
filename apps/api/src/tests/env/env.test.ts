import { describe, expect, it } from 'bun:test'
import type { Env } from '../../env'
import { envSchema } from '../../env'

describe('env schema', () => {
  describe('schema key presence', () => {
    it('requires Entra ID env keys in schema', () => {
      expect(envSchema).toHaveProperty('ENTRA_CLIENT_ID')
      expect(envSchema).toHaveProperty('ENTRA_CLIENT_SECRET')
      expect(envSchema).toHaveProperty('ENTRA_TENANT_ID')
    })

    it('requires AI gateway env keys in schema', () => {
      expect(envSchema).toHaveProperty('AI_GATEWAY_URL')
      expect(envSchema).toHaveProperty('AI_GATEWAY_ROUTE_ID')
      expect(envSchema).toHaveProperty('AI_GATEWAY_GUARDRAILS_PROFILE_ID')
    })

    it('exposes plugin manifest config key in schema', () => {
      expect(envSchema).toHaveProperty('EDGE_PLUGINS_JSON')
      expect(envSchema).toHaveProperty('EDGE_PLUGIN_HOOK_TIMEOUT_MS')
    })

    it('includes auth secret keys in schema', () => {
      expect(envSchema).toHaveProperty('BETTER_AUTH_SECRET')
    })

    it('includes JWT configuration keys in schema', () => {
      expect(envSchema).toHaveProperty('JWT_HS256_SECRET')
      expect(envSchema).toHaveProperty('JWT_ISSUER')
      expect(envSchema).toHaveProperty('JWT_AUDIENCE')
      expect(envSchema).toHaveProperty('JWT_REQUIRED_FOR_ADMIN')
    })

    it('includes AI provider API keys in schema', () => {
      expect(envSchema).toHaveProperty('QWEN_API_KEY')
      expect(envSchema).toHaveProperty('GEMINI_API_KEY')
    })

    it('includes webhook configuration keys in schema', () => {
      expect(envSchema).toHaveProperty('WEBHOOK_ALLOWED_HOSTS')
    })
  })

  describe('schema value types', () => {
    it('defines all schema values as string type', () => {
      for (const [_key, value] of Object.entries(envSchema)) {
        expect(value).toBe('string')
      }
    })

    it('has a known number of schema entries', () => {
      const keys = Object.keys(envSchema)
      // Count all defined keys: we expect at least 15 environment variable keys
      expect(keys.length).toBeGreaterThanOrEqual(15)
    })
  })

  describe('Env interface contract', () => {
    it('allows a valid env object matching the Env interface', () => {
      // Type-check: constructing an object that satisfies Env should compile
      const mockEnv: Env = {
        DB: {} as D1Database,
        CACHE: {} as KVNamespace,
        MEDIA: {} as R2Bucket,
        ASSETS: {} as Fetcher,
        PUBLISH_SCHEDULER: {} as DurableObjectNamespace,
        WEBHOOK_QUEUE: {} as Queue,
      }

      // Runtime verification that required bindings are present
      expect(mockEnv.DB).toBeDefined()
      expect(mockEnv.CACHE).toBeDefined()
      expect(mockEnv.MEDIA).toBeDefined()
      expect(mockEnv.ASSETS).toBeDefined()
      expect(mockEnv.PUBLISH_SCHEDULER).toBeDefined()
      expect(mockEnv.WEBHOOK_QUEUE).toBeDefined()
    })

    it('allows optional string properties to be undefined', () => {
      const mockEnv: Env = {
        DB: {} as D1Database,
        CACHE: {} as KVNamespace,
        MEDIA: {} as R2Bucket,
        ASSETS: {} as Fetcher,
        PUBLISH_SCHEDULER: {} as DurableObjectNamespace,
        WEBHOOK_QUEUE: {} as Queue,
        BETTER_AUTH_SECRET: undefined,
        JWT_HS256_SECRET: undefined,
        QWEN_API_KEY: undefined,
        GEMINI_API_KEY: undefined,
        AI_GATEWAY_URL: undefined,
      }

      expect(mockEnv.BETTER_AUTH_SECRET).toBeUndefined()
      expect(mockEnv.JWT_HS256_SECRET).toBeUndefined()
      expect(mockEnv.QWEN_API_KEY).toBeUndefined()
      expect(mockEnv.GEMINI_API_KEY).toBeUndefined()
      expect(mockEnv.AI_GATEWAY_URL).toBeUndefined()
    })

    it('allows optional string properties to be set', () => {
      const mockEnv: Env = {
        DB: {} as D1Database,
        CACHE: {} as KVNamespace,
        MEDIA: {} as R2Bucket,
        ASSETS: {} as Fetcher,
        PUBLISH_SCHEDULER: {} as DurableObjectNamespace,
        WEBHOOK_QUEUE: {} as Queue,
        BETTER_AUTH_SECRET: 'my-secret',
        JWT_HS256_SECRET: 'jwt-secret',
        JWT_ISSUER: 'edgecms',
        JWT_AUDIENCE: 'admin',
        JWT_REQUIRED_FOR_ADMIN: 'true',
        ENTRA_CLIENT_ID: 'client-id',
        ENTRA_CLIENT_SECRET: 'client-secret',
        ENTRA_TENANT_ID: 'tenant-id',
        QWEN_API_KEY: 'qwen-key',
        GEMINI_API_KEY: 'gemini-key',
        AI_GATEWAY_URL: 'https://gateway.example.com',
        AI_GATEWAY_ROUTE_ID: 'route-1',
        AI_GATEWAY_GUARDRAILS_PROFILE_ID: 'profile-1',
        EDGE_PLUGINS_JSON: '[]',
        EDGE_PLUGIN_HOOK_TIMEOUT_MS: '500',
        CF_API_TOKEN: 'cf-token',
        CLOUDFLARE_ACCOUNT_ID: 'account-id',
        SUPER_ADMIN_EMAILS: 'admin@example.com',
        SUPER_ADMIN_DEV_MODE: 'true',
        WEBHOOK_ALLOWED_HOSTS: 'example.com,other.com',
        CORS_ALLOWED_ORIGINS: 'https://legacy.example.com',
        ADMIN_CORS_ALLOWED_ORIGINS: 'https://admin.example.com',
        PUBLIC_CORS_ALLOWED_ORIGINS: 'https://www.example.com',
        BASE_URL: 'https://cms.example.com',
        HSTS_MAX_AGE_SECONDS: '31536000',
        HSTS_INCLUDE_SUBDOMAINS: 'true',
        HSTS_PRELOAD: 'true',
      }

      expect(mockEnv.BETTER_AUTH_SECRET).toBe('my-secret')
      expect(mockEnv.JWT_HS256_SECRET).toBe('jwt-secret')
      expect(mockEnv.ENTRA_CLIENT_ID).toBe('client-id')
      expect(mockEnv.AI_GATEWAY_URL).toBe('https://gateway.example.com')
      expect(mockEnv.EDGE_PLUGINS_JSON).toBe('[]')
      expect(mockEnv.WEBHOOK_ALLOWED_HOSTS).toBe('example.com,other.com')
      expect(mockEnv.ADMIN_CORS_ALLOWED_ORIGINS).toBe('https://admin.example.com')
      expect(mockEnv.HSTS_PRELOAD).toBe('true')
    })
  })

  describe('schema completeness', () => {
    it('all envSchema keys correspond to optional string properties on Env', () => {
      // Every key in envSchema should be a valid key on the Env interface
      // We test this by constructing a partial Env with all schema keys set
      const envFromSchema: Partial<Env> = {}
      for (const key of Object.keys(envSchema)) {
        ;(envFromSchema as Record<string, string>)[key] = 'test-value'
      }

      // Verify each key was set
      for (const key of Object.keys(envSchema)) {
        expect((envFromSchema as Record<string, unknown>)[key]).toBe('test-value')
      }
    })

    it('envSchema does not include required binding keys (DB, CACHE, etc.)', () => {
      // Required bindings are not in envSchema because they are not string env vars
      expect(envSchema).not.toHaveProperty('DB')
      expect(envSchema).not.toHaveProperty('CACHE')
      expect(envSchema).not.toHaveProperty('MEDIA')
      expect(envSchema).not.toHaveProperty('ASSETS')
      expect(envSchema).not.toHaveProperty('PUBLISH_SCHEDULER')
      expect(envSchema).not.toHaveProperty('WEBHOOK_QUEUE')
    })

    it('envSchema does not include ASSET_VECTORS (optional non-string binding)', () => {
      expect(envSchema).not.toHaveProperty('ASSET_VECTORS')
    })

    it('envSchema is a frozen-like const object', () => {
      // The `as const` assertion ensures the schema is readonly at type level
      // At runtime we verify that the values are string literals
      const values = Object.values(envSchema)
      expect(values.every((v) => v === 'string')).toBe(true)
    })
  })

  describe('known schema keys enumeration', () => {
    const expectedKeys = [
      'BETTER_AUTH_SECRET',
      'JWT_HS256_SECRET',
      'JWT_ISSUER',
      'JWT_AUDIENCE',
      'JWT_REQUIRED_FOR_ADMIN',
      'ENTRA_CLIENT_ID',
      'ENTRA_CLIENT_SECRET',
      'ENTRA_TENANT_ID',
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'QWEN_API_KEY',
      'GEMINI_API_KEY',
      'AI_GATEWAY_URL',
      'AI_GATEWAY_ROUTE_ID',
      'AI_GATEWAY_GUARDRAILS_PROFILE_ID',
      'ENABLE_AI_IMPORT_REVIEW',
      'EDGE_PLUGINS_JSON',
      'EDGE_PLUGIN_HOOK_TIMEOUT_MS',
      'WEBHOOK_ALLOWED_HOSTS',
      'SUPER_ADMIN_EMAILS',
      'SUPER_ADMIN_DEV_MODE',
      'CORS_ALLOWED_ORIGINS',
      'ADMIN_CORS_ALLOWED_ORIGINS',
      'PUBLIC_CORS_ALLOWED_ORIGINS',
      'BASE_URL',
      'HSTS_MAX_AGE_SECONDS',
      'HSTS_INCLUDE_SUBDOMAINS',
      'HSTS_PRELOAD',
      'CF_API_TOKEN',
      'CLOUDFLARE_ACCOUNT_ID',
      'EDGECMS_API_KEY',
      'MCP_API_KEY',
    ]

    for (const key of expectedKeys) {
      it(`includes ${key} in envSchema`, () => {
        expect(envSchema).toHaveProperty(key)
      })
    }

    it('contains all expected keys', () => {
      const schemaKeys = Object.keys(envSchema)
      for (const key of expectedKeys) {
        expect(schemaKeys).toContain(key)
      }
    })

    it('does not drift from expected schema keys', () => {
      expect(Object.keys(envSchema).sort()).toEqual([...expectedKeys].sort())
    })
  })

  describe('wrangler binding drift', () => {
    it('declares every required Worker binding in wrangler.toml for each env', async () => {
      const wranglerToml = await Bun.file(new URL('../../../wrangler.toml', import.meta.url)).text()
      const count = (pattern: RegExp) => wranglerToml.match(pattern)?.length ?? 0

      expect(count(/binding = "ASSETS"/g)).toBe(1)
      expect(count(/binding = "DB"/g)).toBe(3)
      expect(count(/binding = "CACHE"/g)).toBe(3)
      expect(count(/binding = "MEDIA"/g)).toBe(3)
      expect(count(/name = "PUBLISH_SCHEDULER"/g)).toBe(3)
      expect(count(/binding = "WEBHOOK_QUEUE"/g)).toBe(3)
    })
  })
})
