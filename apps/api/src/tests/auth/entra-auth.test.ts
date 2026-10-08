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

describe('createAuth Entra integration', () => {
  beforeEach(() => {
    betterAuthMock.mockClear()
    drizzleAdapterMock.mockClear()
    drizzleMock.mockClear()
  })

  it('exposes Entra ID auth provider config', async () => {
    const { createAuth } = await import(`../../auth/auth?bypass=${Date.now()}`)

    createAuth({} as D1Database, {
      baseURL: 'http://localhost:8787',
      secret: 'test-secret-at-least-32-characters',
      entra: {
        clientId: 'entra-client-id',
        clientSecret: 'entra-client-secret',
        tenantId: 'common',
      },
    })

    const firstCall = betterAuthMock.mock.calls[0] as [unknown] | undefined
    expect(firstCall).toBeDefined()
    if (!firstCall) throw new Error('Expected betterAuth call')

    const config = firstCall[0] as {
      socialProviders?: {
        microsoft?: {
          clientId?: string
          clientSecret?: string
          tenantId?: string
        }
      }
    }

    expect(config.socialProviders?.microsoft).toEqual({
      clientId: 'entra-client-id',
      clientSecret: 'entra-client-secret',
      tenantId: 'common',
    })
  })
})
