import { createDb } from '@/database/db'
import { getRequestUrl } from '@/shared/utils/request-url'
import { tenantsRepository } from '@/tenants/tenants.repository'
import { usersRepository } from '@/users/users.repository'
import { createAuth } from './auth'
import { getSessionForRequest } from './session-cache'

export type ActorRole = 'viewer' | 'editor' | 'admin'
export type TenantActorRole = 'viewer' | 'member' | 'editor' | 'admin' | 'owner'
export type ActorSessionDetails = {
  actorId?: string
  actorRole?: ActorRole
  actorEmail?: string
  actorUserRoleRaw?: string
  actorSessionRoleRaw?: string
}

const ADMIN_MUTATION_PREFIXES = ['/api/admin/', '/api/tenants/']

export function isAdminMutationPath(pathname: string, method: string): boolean {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false
  return ADMIN_MUTATION_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

export function canMutate(role: ActorRole | undefined): boolean {
  return role === 'admin' || role === 'editor'
}

function asTenantActorRole(role: unknown): TenantActorRole | undefined {
  if (
    role === 'viewer' ||
    role === 'member' ||
    role === 'editor' ||
    role === 'admin' ||
    role === 'owner'
  ) {
    return role
  }
  return undefined
}

export function canMutateTenantRole(role: TenantActorRole | undefined): boolean {
  return role === 'owner' || role === 'admin' || role === 'editor'
}

function asActorRole(role: unknown): ActorRole | undefined {
  if (role === 'viewer' || role === 'editor' || role === 'admin') return role
  return undefined
}

async function resolveFallbackRole(
  d1: D1Database,
  sessionUser: { id: string; email?: string | null }
): Promise<ActorRole | undefined> {
  const db = createDb(d1)
  const persistedRole = await usersRepository.findRoleById(db, sessionUser.id)
  const actorRole = asActorRole(persistedRole)
  if (actorRole) return actorRole

  const firstUserId = await usersRepository.findFirstUserId(db)
  if (firstUserId === sessionUser.id) return 'admin'
  return undefined
}

const actorSessionCache = new WeakMap<Request, Promise<ActorSessionDetails>>()

export async function resolveActorSessionDetails(request: Request): Promise<ActorSessionDetails> {
  let cached = actorSessionCache.get(request)
  if (cached) {
    return cached
  }

  cached = (async () => {
    const { env } = await import('cloudflare:workers')
    const typedEnv = env as {
      DB: D1Database
      BETTER_AUTH_SECRET?: string
      ENTRA_CLIENT_ID?: string
      ENTRA_CLIENT_SECRET?: string
      ENTRA_TENANT_ID?: string
      GOOGLE_CLIENT_ID?: string
      GOOGLE_CLIENT_SECRET?: string
    }
    const auth = createAuth(typedEnv.DB, {
      secret: typedEnv.BETTER_AUTH_SECRET,
      baseURL: getRequestUrl(request).origin,
      entra: {
        clientId: typedEnv.ENTRA_CLIENT_ID,
        clientSecret: typedEnv.ENTRA_CLIENT_SECRET,
        tenantId: typedEnv.ENTRA_TENANT_ID,
      },
      google: {
        clientId: typedEnv.GOOGLE_CLIENT_ID,
        clientSecret: typedEnv.GOOGLE_CLIENT_SECRET,
      },
    })
    const session = await getSessionForRequest(auth, request)
    if (!session?.user) return {}
    const actorUserRoleRaw =
      typeof (session.user as { role?: unknown }).role === 'string'
        ? (session.user as { role?: string }).role
        : undefined
    const actorSessionRoleRaw =
      typeof (session.session as { role?: unknown } | undefined)?.role === 'string'
        ? (session.session as { role?: string }).role
        : undefined
    const roleFromSession = asActorRole(actorUserRoleRaw)
    const actorRole =
      roleFromSession ??
      (await resolveFallbackRole(typedEnv.DB, {
        id: session.user.id,
        email: session.user.email,
      }))

    return {
      actorId: session.user.id,
      actorRole,
      actorEmail: session.user.email,
      actorUserRoleRaw,
      actorSessionRoleRaw,
    }
  })()

  actorSessionCache.set(request, cached)
  return cached
}

export async function resolveActorFromSession(request: Request): Promise<{
  actorId?: string
  actorRole?: ActorRole
}> {
  const details = await resolveActorSessionDetails(request)
  return {
    actorId: details.actorId,
    actorRole: details.actorRole,
  }
}

export async function resolveTenantRoleForActor(
  d1: D1Database,
  actorId: string,
  tenantSlug: string
): Promise<TenantActorRole | undefined> {
  const db = createDb(d1)
  const role = await tenantsRepository.findMembershipRole(db, actorId, tenantSlug)
  return asTenantActorRole(role)
}
