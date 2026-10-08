import { describe, expect, it, vi } from 'bun:test'

const createDb = vi.fn((binding) => ({ binding }))

vi.mock('@/database/db', () => ({ createDb }))

const { resolveTenantBindings } = await import(`../../tenants/tenant-context?bypass=${Date.now()}`)

describe('tenant binding resolution', () => {
  it('resolves tenant-specific KV/R2/D1 bindings', async () => {
    const env = {
      DB: { name: 'default-db' } as unknown as D1Database,
      CACHE: { name: 'default-kv' } as unknown as KVNamespace,
      MEDIA: { name: 'default-r2' } as unknown as R2Bucket,
      DB_ACME: { name: 'acme-db' } as unknown as D1Database,
      CACHE_ACME: { name: 'acme-kv' } as unknown as KVNamespace,
      MEDIA_ACME: { name: 'acme-r2' } as unknown as R2Bucket,
    }

    const tenantContext = {
      tenant: {
        id: 'tenant-acme',
        slug: 'acme',
        name: 'Acme',
        status: 'active',
      },
      resources: {
        mode: 'isolated' as const,
        bindings: {
          db: 'DB_ACME',
          kv: 'CACHE_ACME',
          r2: 'MEDIA_ACME',
        },
      },
    }

    const bindings = resolveTenantBindings(tenantContext, env)

    expect(createDb).toHaveBeenCalledWith(env.DB_ACME)
    expect(bindings.kv).toBe(env.CACHE_ACME)
    expect(bindings.r2).toBe(env.MEDIA_ACME)
  })
})
