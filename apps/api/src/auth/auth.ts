import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '@/database/schema'

/**
 * Creates a better-auth instance configured for the CMS Worker.
 *
 * This factory function accepts the D1 binding from the Cloudflare Worker
 * environment and returns a fully configured auth instance with:
 * - Email/password authentication
 * - Session management via D1-backed storage
 * - Drizzle ORM adapter with the auth schema
 *
 * The factory pattern is required because D1 bindings are only available
 * inside a request context on Cloudflare Workers. Each request creates a
 * fresh auth instance backed by the D1 binding from `env.DB`.
 *
 * @param d1 - The D1Database binding from the Worker environment
 * @param options - Additional configuration (secret, baseURL for production)
 *
 * @example
 * ```ts
 * import { createAuth } from '@/auth/auth'
 *
 * // In an ElysiaJS route handler:
 * const auth = createAuth(env.DB, {
 *   secret: env.BETTER_AUTH_SECRET,
 *   baseURL: 'https://cms.example.com',
 * })
 * ```
 */
const authCache = new WeakMap<object, Map<string, any>>()
const activeAuthMaps = new Set<Map<string, any>>()

function buildOptionsKey(options?: {
  secret?: string
  baseURL?: string
  entra?: {
    clientId?: string
    clientSecret?: string
    tenantId?: string
  }
  google?: {
    clientId?: string
    clientSecret?: string
  }
}): string {
  return [
    options?.secret ?? '',
    options?.baseURL ?? '',
    options?.entra?.clientId ?? '',
    options?.entra?.clientSecret ?? '',
    options?.entra?.tenantId ?? '',
    options?.google?.clientId ?? '',
    options?.google?.clientSecret ?? '',
  ].join('::')
}

export function __resetAuthCacheForTests(): void {
  for (const map of activeAuthMaps) {
    map.clear()
  }
  activeAuthMaps.clear()
}

export function createAuth(
  d1: D1Database,
  options?: {
    secret?: string
    baseURL?: string
    entra?: {
      clientId?: string
      clientSecret?: string
      tenantId?: string
    }
    google?: {
      clientId?: string
      clientSecret?: string
    }
  }
) {
  const secret = options?.secret?.trim()
  if (!secret || secret.length < 32) {
    throw new Error('BETTER_AUTH_SECRET must be configured and at least 32 characters long')
  }

  const cacheKey = buildOptionsKey(options)
  if (typeof d1 === 'object' && d1 !== null) {
    const existing = authCache.get(d1)?.get(cacheKey)
    if (existing) {
      return existing
    }
  }

  const db = drizzle(d1, { schema })
  const trustedOrigins = Array.from(
    new Set(
      [
        options?.baseURL,
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'http://localhost:4173',
        'http://127.0.0.1:4173',
        'http://localhost:8787',
        'http://127.0.0.1:8787',
      ]
        .filter((origin): origin is string => Boolean(origin))
        .map((origin) => origin.replace(/\/$/, ''))
    )
  )

  const instance = betterAuth({
    basePath: '/api/auth',
    secret,
    baseURL: options?.baseURL,
    trustedOrigins,
    database: drizzleAdapter(db, {
      provider: 'sqlite',
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
    },
    user: {
      additionalFields: {
        role: {
          type: 'string',
          defaultValue: 'viewer',
        },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // refresh session every 24 hours
      cookieCache: {
        enabled: true,
        maxAge: 60 * 5, // 5 minutes
      },
    },
    advanced: {
      crossSubDomainCookies: {
        enabled: false,
      },
    },
    socialProviders: {
      ...(options?.entra?.clientId && options?.entra?.clientSecret
        ? {
            microsoft: {
              clientId: options.entra.clientId,
              clientSecret: options.entra.clientSecret,
              tenantId: options.entra.tenantId ?? 'common',
            },
          }
        : {}),
      ...(options?.google?.clientId && options?.google?.clientSecret
        ? {
            google: {
              clientId: options.google.clientId,
              clientSecret: options.google.clientSecret,
            },
          }
        : {}),
    },
  })

  if (typeof d1 === 'object' && d1 !== null) {
    let d1Map = authCache.get(d1)
    if (!d1Map) {
      d1Map = new Map()
      authCache.set(d1, d1Map)
      activeAuthMaps.add(d1Map)
    }
    d1Map.set(cacheKey, instance)
  }

  return instance
}

export { getSessionForRequest } from './session-cache'

/** The type of the auth instance returned by `createAuth`. */
export type Auth = ReturnType<typeof createAuth>
