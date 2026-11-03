import { describe, expect, it } from 'bun:test'
import {
  loadHostingConfig,
  resolveCacheDriverFromEnv,
  resolveCacheL1FromEnv,
  resolveRedisUrlFromEnv,
} from '@/hosting/config'

describe('resolveRedisUrlFromEnv', () => {
  it('prefers REDIS_URL', () => {
    expect(
      resolveRedisUrlFromEnv({
        REDIS_URL: 'redis://user:pass@redis:6379/1',
        REDIS_HOST: 'ignored',
      })
    ).toBe('redis://user:pass@redis:6379/1')
  })

  it('builds URL from host/port/password/db', () => {
    expect(
      resolveRedisUrlFromEnv({
        REDIS_HOST: 'redis.internal',
        REDIS_PORT: '6380',
        REDIS_PASSWORD: 's3cret',
        REDIS_DB: '2',
      })
    ).toBe('redis://:s3cret@redis.internal:6380/2')
  })

  it('returns undefined when Redis env is unset (memory fallback)', () => {
    expect(resolveRedisUrlFromEnv({})).toBeUndefined()
  })
})

describe('resolveCacheDriverFromEnv', () => {
  it('defaults to memory when Redis env is unset', () => {
    expect(resolveCacheDriverFromEnv({})).toEqual({ driver: 'memory' })
  })

  it('auto-selects redis when REDIS_URL is set and CACHE_DRIVER is unset', () => {
    expect(resolveCacheDriverFromEnv({ REDIS_URL: 'redis://localhost:6379' })).toEqual({
      driver: 'redis',
      redisUrl: 'redis://localhost:6379',
    })
  })

  it('keeps memory when CACHE_DRIVER=memory even if REDIS_URL is set', () => {
    expect(
      resolveCacheDriverFromEnv({
        CACHE_DRIVER: 'memory',
        REDIS_URL: 'redis://localhost:6379',
      })
    ).toEqual({ driver: 'memory', redisUrl: 'redis://localhost:6379' })
  })

  it('requires Redis connection info when CACHE_DRIVER=redis', () => {
    expect(() => resolveCacheDriverFromEnv({ CACHE_DRIVER: 'redis' })).toThrow(/REDIS_URL|REDIS_HOST/)
  })
})

describe('resolveCacheL1FromEnv', () => {
  it('disables L1 for memory driver', () => {
    expect(resolveCacheL1FromEnv('memory', {})).toMatchObject({
      l1Enabled: false,
      writeMode: 'write-through',
      l1DefaultTtlSeconds: 30,
      l1MaxTtlSeconds: 60,
    })
  })

  it('defaults L1 on for redis', () => {
    expect(resolveCacheL1FromEnv('redis', {})).toMatchObject({
      l1Enabled: true,
      writeMode: 'write-through',
    })
  })

  it('honors CACHE_L1_ENABLED=false and write-invalidate', () => {
    expect(
      resolveCacheL1FromEnv('redis', {
        CACHE_L1_ENABLED: 'false',
        CACHE_WRITE_MODE: 'write-invalidate',
        CACHE_L1_TTL_SECONDS: '20',
        CACHE_L1_MAX_TTL_SECONDS: '40',
      })
    ).toEqual({
      l1Enabled: false,
      writeMode: 'write-invalidate',
      l1DefaultTtlSeconds: 20,
      l1MaxTtlSeconds: 40,
    })
  })

  it('rejects max TTL below default TTL', () => {
    expect(() =>
      resolveCacheL1FromEnv('redis', {
        CACHE_L1_TTL_SECONDS: '60',
        CACHE_L1_MAX_TTL_SECONDS: '30',
      })
    ).toThrow(/CACHE_L1_MAX_TTL_SECONDS/)
  })
})

describe('loadHostingConfig', () => {
  it('loads postgres config from env', () => {
    const prev = { ...process.env }
    try {
      process.env.DATABASE_DRIVER = 'postgres'
      process.env.DATABASE_URL = 'postgres://edgecms:edgecms@127.0.0.1:5432/edgecms'
      process.env.BETTER_AUTH_SECRET = 'x'.repeat(32)
      process.env.MEDIA_DRIVER = 'filesystem'
      process.env.CACHE_DRIVER = 'memory'
      delete process.env.REDIS_URL
      delete process.env.REDIS_HOST
      process.env.SIGNUP_POLICY = 'disabled'
      const cfg = loadHostingConfig('/workspace/apps/api')
      expect(cfg.database.driver).toBe('postgres')
      expect(cfg.database.databaseUrl).toContain('postgres://')
      expect(cfg.featureFlags.signupPolicy).toBe('disabled')
      expect(cfg.media.driver).toBe('filesystem')
      expect(cfg.cache.driver).toBe('memory')
    } finally {
      process.env = prev
    }
  })

  it('wires redis from REDIS_HOST when CACHE_DRIVER=redis', () => {
    const prev = { ...process.env }
    try {
      process.env.DATABASE_DRIVER = 'sqlite'
      process.env.BETTER_AUTH_SECRET = 'x'.repeat(32)
      process.env.MEDIA_DRIVER = 'filesystem'
      process.env.CACHE_DRIVER = 'redis'
      delete process.env.REDIS_URL
      process.env.REDIS_HOST = 'redis'
      process.env.REDIS_PORT = '6379'
      process.env.REDIS_PASSWORD = 'pw'
      const cfg = loadHostingConfig('/workspace/apps/api')
      expect(cfg.cache.driver).toBe('redis')
      expect(cfg.cache.redisUrl).toBe('redis://:pw@redis:6379')
      expect(cfg.cache.l1Enabled).toBe(true)
      expect(cfg.cache.writeMode).toBe('write-through')
    } finally {
      process.env = prev
    }
  })

  it('allows disabling L1 on redis via CACHE_L1_ENABLED=false', () => {
    const prev = { ...process.env }
    try {
      process.env.DATABASE_DRIVER = 'sqlite'
      process.env.BETTER_AUTH_SECRET = 'x'.repeat(32)
      process.env.MEDIA_DRIVER = 'filesystem'
      process.env.CACHE_DRIVER = 'redis'
      process.env.REDIS_URL = 'redis://localhost:6379'
      process.env.CACHE_L1_ENABLED = 'false'
      process.env.CACHE_WRITE_MODE = 'write-invalidate'
      const cfg = loadHostingConfig('/workspace/apps/api')
      expect(cfg.cache.l1Enabled).toBe(false)
      expect(cfg.cache.writeMode).toBe('write-invalidate')
    } finally {
      process.env = prev
    }
  })

  it('prefers CDN_BASE_URL over MEDIA_PUBLIC_BASE_URL for public media origin', () => {
    const prev = { ...process.env }
    try {
      process.env.DATABASE_DRIVER = 'sqlite'
      process.env.BETTER_AUTH_SECRET = 'x'.repeat(32)
      process.env.MEDIA_DRIVER = 's3'
      process.env.S3_ENDPOINT = 'http://minio:9000'
      process.env.S3_ACCESS_KEY_ID = 'minio'
      process.env.S3_SECRET_ACCESS_KEY = 'minio'
      process.env.MEDIA_PUBLIC_BASE_URL = 'https://legacy-media.example.com'
      process.env.CDN_BASE_URL = 'https://cdn.example.com'
      process.env.CACHE_DRIVER = 'memory'
      delete process.env.REDIS_URL
      delete process.env.REDIS_HOST
      const cfg = loadHostingConfig('/workspace/apps/api')
      expect(cfg.media.publicBaseUrl).toBe('https://cdn.example.com')
      expect(cfg.media.cdnBaseUrl).toBe('https://cdn.example.com')
      expect(cfg.media.endpoint).toBe('http://minio:9000')
    } finally {
      process.env = prev
    }
  })

  it('rejects postgres without DATABASE_URL', () => {
    const prev = { ...process.env }
    try {
      process.env.DATABASE_DRIVER = 'postgres'
      delete process.env.DATABASE_URL
      process.env.BETTER_AUTH_SECRET = 'x'.repeat(32)
      expect(() => loadHostingConfig('/workspace/apps/api')).toThrow(/DATABASE_URL/)
    } finally {
      process.env = prev
    }
  })

  it('passthrough includes Entra ID and SSO packaging env keys', () => {
    const prev = { ...process.env }
    try {
      process.env.DATABASE_DRIVER = 'sqlite'
      process.env.BETTER_AUTH_SECRET = 'x'.repeat(32)
      process.env.MEDIA_DRIVER = 'filesystem'
      process.env.CACHE_DRIVER = 'memory'
      process.env.ENTRA_CLIENT_ID = 'entra-id'
      process.env.ENTRA_CLIENT_SECRET = 'entra-secret'
      process.env.ENTRA_TENANT_ID = '11111111-1111-1111-1111-111111111111'
      process.env.ENTRA_REDIRECT_URI =
        'http://127.0.0.1:8787/api/auth/callback/microsoft'
      process.env.SSO_MODE = 'entra'
      process.env.SSO_LOCAL_AUTH_LOCKOUT = 'true'
      const cfg = loadHostingConfig('/workspace/apps/api')
      expect(cfg.passthrough.ENTRA_CLIENT_ID).toBe('entra-id')
      expect(cfg.passthrough.ENTRA_CLIENT_SECRET).toBe('entra-secret')
      expect(cfg.passthrough.ENTRA_TENANT_ID).toBe(
        '11111111-1111-1111-1111-111111111111'
      )
      expect(cfg.passthrough.ENTRA_REDIRECT_URI).toContain('/api/auth/callback/microsoft')
      expect(cfg.passthrough.SSO_MODE).toBe('entra')
      expect(cfg.passthrough.SSO_LOCAL_AUTH_LOCKOUT).toBe('true')
    } finally {
      process.env = prev
    }
  })
})
