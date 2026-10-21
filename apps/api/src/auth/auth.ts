import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { createAuthMiddleware } from 'better-auth/api'
import { twoFactor } from 'better-auth/plugins/two-factor'
import { drizzle } from 'drizzle-orm/d1'
import { createDb } from '@/database/db'
import * as schema from '@/database/schema'
import type { Env } from '@/env'
import { invitesService } from '@/invites/invites.service'
import {
  type AuthEmailSender,
  type AuthPolicies,
  resolveAuthPolicies,
} from './auth-policies'
import { enforceSignupPolicy, readInviteToken } from './signup-policy'

export type CreateAuthOptions = {
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
  /** Signup, email verification and MFA policies. Defaults keep historical behavior. */
  policies?: AuthPolicies
}

const DEFAULT_POLICIES: AuthPolicies = { signupPolicy: 'open', requireMfaForSuperAdmins: false }

/** Better Auth endpoints whose new session proves a second factor (HS-11). */
const SECOND_FACTOR_PATHS = new Set([
  '/two-factor/verify-totp',
  '/two-factor/verify-backup-code',
  '/two-factor/verify-otp',
])

export function isSecondFactorPath(path: string | undefined): boolean {
  return path !== undefined && SECOND_FACTOR_PATHS.has(path)
}

const senderIds = new WeakMap<AuthEmailSender, number>()
let nextSenderId = 1

function senderKey(sender: AuthEmailSender | undefined): string {
  if (!sender) return ''
  let id = senderIds.get(sender)
  if (id === undefined) {
    id = nextSenderId++
    senderIds.set(sender, id)
  }
  return String(id)
}

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

function buildOptionsKey(options?: CreateAuthOptions): string {
  const policies = options?.policies ?? DEFAULT_POLICIES
  return [
    options?.secret ?? '',
    options?.baseURL ?? '',
    options?.entra?.clientId ?? '',
    options?.entra?.clientSecret ?? '',
    options?.entra?.tenantId ?? '',
    options?.google?.clientId ?? '',
    options?.google?.clientSecret ?? '',
    policies.signupPolicy,
    senderKey(policies.emailSender),
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
  options?: CreateAuthOptions
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
  const gateDb = createDb(d1)
  const policies = options?.policies ?? DEFAULT_POLICIES
  const emailSender = policies.emailSender
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
        twoFactor: schema.twoFactor,
      },
    }),
    appName: 'EdgeCMS',
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      requireEmailVerification: Boolean(emailSender),
    },
    ...(emailSender
      ? {
          emailVerification: {
            sendOnSignUp: true,
            sendOnSignIn: true,
            autoSignInAfterVerification: true,
            async sendVerificationEmail({ user, url }: { user: { email: string }; url: string }) {
              await emailSender.send({
                to: user.email,
                subject: 'Verify your email address',
                text: `Open this link to verify your email address and sign in:\n\n${url}\n\nIf you did not create an account, ignore this email.`,
              })
            },
          },
        }
      : {}),
    user: {
      additionalFields: {
        role: {
          type: 'string',
          defaultValue: 'viewer',
          // Global role is assigned by admins only; never accept it from sign-up
          // or update-user input.
          input: false,
        },
      },
    },
    plugins: [twoFactor({ issuer: 'EdgeCMS' })],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-up/email') return
        const email = (ctx.body as { email?: unknown } | undefined)?.email
        await enforceSignupPolicy(gateDb, {
          policy: policies.signupPolicy,
          email: typeof email === 'string' ? email : '',
          inviteToken: readInviteToken(ctx),
          mode: 'check',
        })
      }),
    },
    databaseHooks: {
      user: {
        create: {
          async before(newUser, ctx) {
            await enforceSignupPolicy(gateDb, {
              policy: policies.signupPolicy,
              email: newUser.email,
              inviteToken: readInviteToken(ctx),
              mode: 'consume',
            })
          },
          async after(createdUser, ctx) {
            if (policies.signupPolicy !== 'invite-only') return
            const token = readInviteToken(ctx)
            if (token) await invitesService.complete(gateDb, { token, userId: createdUser.id })
          },
        },
      },
      session: {
        create: {
          async before(newSession, ctx) {
            return { data: { ...newSession, mfaVerified: isSecondFactorPath(ctx?.path) } }
          },
        },
      },
    },
    session: {
      additionalFields: {
        mfaVerified: {
          type: 'boolean',
          defaultValue: false,
          required: false,
          input: false,
        },
      },
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

type AuthEnv = Pick<
  Env,
  | 'DB'
  | 'BETTER_AUTH_SECRET'
  | 'ENTRA_CLIENT_ID'
  | 'ENTRA_CLIENT_SECRET'
  | 'ENTRA_TENANT_ID'
  | 'GOOGLE_CLIENT_ID'
  | 'GOOGLE_CLIENT_SECRET'
  | 'SIGNUP_POLICY'
  | 'AUTH_EMAIL_SENDER'
  | 'SUPER_ADMIN_REQUIRE_MFA'
>

/** Builds the auth instance for a Worker env, including composition-time policies. */
export function createAuthForEnv(env: AuthEnv, baseURL: string) {
  return createAuth(env.DB, {
    secret: env.BETTER_AUTH_SECRET,
    baseURL,
    entra: {
      clientId: env.ENTRA_CLIENT_ID,
      clientSecret: env.ENTRA_CLIENT_SECRET,
      tenantId: env.ENTRA_TENANT_ID,
    },
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    },
    policies: resolveAuthPolicies(env),
  })
}

export { getSessionForRequest } from './session-cache'

/** The type of the auth instance returned by `createAuth`. */
export type Auth = ReturnType<typeof createAuth>
