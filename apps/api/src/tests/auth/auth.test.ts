import { beforeEach, describe, expect, it, mock } from 'bun:test'

const betterAuthMock = mock(() => ({
  handler: mock(() => new Response('ok')),
  api: {
    getSession: mock(async () => null),
  },
}))

const drizzleAdapterMock = mock(() => ({ adapter: true }))
const drizzleMock = mock(() => ({ db: true }))

mock.module('better-auth', () => ({
  betterAuth: betterAuthMock,
}))

mock.module('better-auth/adapters/drizzle', () => ({
  drizzleAdapter: drizzleAdapterMock,
}))

mock.module('drizzle-orm/d1', () => ({
  drizzle: drizzleMock,
}))

describe('createAuth', () => {
  beforeEach(() => {
    betterAuthMock.mockClear()
    drizzleAdapterMock.mockClear()
    drizzleMock.mockClear()
  })

  it('includes trusted dev origins for email sign-up requests', async () => {
    const { createAuth } = await import(`../../auth/auth?bypass=${Date.now()}`)

    createAuth({} as D1Database, {
      baseURL: 'http://localhost:8787',
      secret: 'test-secret-at-least-32-characters',
    })

    expect(betterAuthMock).toHaveBeenCalledTimes(1)

    const firstCall = betterAuthMock.mock.calls[0] as [unknown] | undefined
    expect(firstCall).toBeDefined()
    if (!firstCall) throw new Error('Expected betterAuth call')

    const config = firstCall[0] as {
      trustedOrigins?: string[]
      baseURL?: string
    }

    expect(config.baseURL).toBe('http://localhost:8787')
    expect(config.trustedOrigins).toEqual(
      expect.arrayContaining([
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'http://localhost:4173',
        'http://127.0.0.1:4173',
        'http://localhost:8787',
      ])
    )
  })

  it('configures a persisted global user role field', async () => {
    const { createAuth } = await import(`../../auth/auth?bypass=${Date.now()}`)

    createAuth({} as D1Database, {
      baseURL: 'http://localhost:8787',
      secret: 'test-secret-at-least-32-characters',
    })

    const firstCall = betterAuthMock.mock.calls[0] as [unknown] | undefined
    expect(firstCall).toBeDefined()
    if (!firstCall) throw new Error('Expected betterAuth call')

    const config = firstCall[0] as {
      user?: {
        additionalFields?: {
          role?: {
            defaultValue?: string
            type?: string
          }
        }
      }
    }

    expect(config.user?.additionalFields?.role).toMatchObject({
      type: 'string',
      defaultValue: 'viewer',
    })
  })

  it('throws when auth secret is missing', async () => {
    const { createAuth } = await import(`../../auth/auth?bypass=${Date.now()}`)

    expect(() =>
      createAuth({} as D1Database, {
        baseURL: 'http://localhost:8787',
      })
    ).toThrow('BETTER_AUTH_SECRET must be configured')
  })

  it('deduplicates createAuth calls for the same D1 database and options', async () => {
    const { createAuth, __resetAuthCacheForTests } = await import(`../../auth/auth?bypass=${Date.now()}`)
    __resetAuthCacheForTests()
    const d1 = {} as D1Database
    const opts = {
      baseURL: 'http://localhost:8787',
      secret: 'test-secret-at-least-32-characters',
    }

    const auth1 = createAuth(d1, opts)
    const auth2 = createAuth(d1, opts)

    expect(auth1).toBe(auth2)
    expect(betterAuthMock).toHaveBeenCalledTimes(1)
  })

  it('separates cache entries when OAuth provider configs differ', async () => {
    const { createAuth, __resetAuthCacheForTests } = await import(`../../auth/auth?bypass=${Date.now()}`)
    __resetAuthCacheForTests()
    const d1 = {} as D1Database

    const authWithoutOAuth = createAuth(d1, {
      baseURL: 'http://localhost:8787',
      secret: 'test-secret-at-least-32-characters',
    })

    const authWithOAuth = createAuth(d1, {
      baseURL: 'http://localhost:8787',
      secret: 'test-secret-at-least-32-characters',
      google: { clientId: 'g-client', clientSecret: 'g-secret' },
    })

    expect(authWithoutOAuth).not.toBe(authWithOAuth)
    expect(betterAuthMock).toHaveBeenCalledTimes(2)
  })

  it('enables session cookieCache for fast-path session lookups', async () => {
    const { createAuth, __resetAuthCacheForTests } = await import(`../../auth/auth?bypass=${Date.now()}`)
    __resetAuthCacheForTests()
    const d1 = {} as D1Database

    createAuth(d1, {
      baseURL: 'http://localhost:8787',
      secret: 'test-secret-at-least-32-characters',
    })

    const firstCall = (betterAuthMock.mock.calls as unknown[][])[0]
    const config = (firstCall?.[0] ?? {}) as {
      session?: {
        cookieCache?: {
          enabled?: boolean
          maxAge?: number
        }
      }
    }

    expect(config.session?.cookieCache?.enabled).toBe(true)
    expect(config.session?.cookieCache?.maxAge).toBe(300)
  })

  it('clears active auth cache on __resetAuthCacheForTests()', async () => {
    const { createAuth, __resetAuthCacheForTests } = await import(`../../auth/auth?bypass=${Date.now()}`)
    __resetAuthCacheForTests()
    const d1 = {} as D1Database
    const opts = {
      baseURL: 'http://localhost:8787',
      secret: 'test-secret-at-least-32-characters',
    }

    createAuth(d1, opts)
    expect(betterAuthMock).toHaveBeenCalledTimes(1)

    __resetAuthCacheForTests()

    createAuth(d1, opts)
    expect(betterAuthMock).toHaveBeenCalledTimes(2)
  })
})
