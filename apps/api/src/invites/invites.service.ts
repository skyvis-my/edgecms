import type { Database } from '@/database/db'
import type { ServiceResult } from '@/shared/utils/service-response'
import { tenantsRepository } from '@/tenants/tenants.repository'
import { invitesRepository, type SignupInviteRow } from './invites.repository'

export const INVITE_TENANT_ROLES = ['owner', 'admin', 'member'] as const
export type InviteTenantRole = (typeof INVITE_TENANT_ROLES)[number]

export const DEFAULT_INVITE_TTL_HOURS = 72
export const MAX_INVITE_TTL_HOURS = 24 * 30

/** Invite fields safe to return to admins; never includes the token hash. */
export type SignupInviteView = {
  id: string
  email: string
  tenantId: string | null
  tenantRole: string | null
  createdBy: string | null
  expiresAt: string
  usedAt: string | null
  usedBy: string | null
  revoked: boolean
  createdAt: string
  status: 'pending' | 'used' | 'revoked' | 'expired'
}

export type CreateInviteInput = {
  email: string
  tenantSlug?: string
  tenantRole?: InviteTenantRole
  expiresInHours?: number
  createdBy?: string
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** SHA-256 of the invite token, hex encoded. Tokens are never stored. */
export async function hashInviteToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

function generateInviteToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)))
}

function toView(row: SignupInviteRow, now = Date.now()): SignupInviteView {
  const status = row.revoked
    ? 'revoked'
    : row.usedAt !== null
      ? 'used'
      : row.expiresAt <= now
        ? 'expired'
        : 'pending'
  return {
    id: row.id,
    email: row.email,
    tenantId: row.tenantId,
    tenantRole: row.tenantRole,
    createdBy: row.createdBy,
    expiresAt: new Date(row.expiresAt).toISOString(),
    usedAt: row.usedAt === null ? null : new Date(row.usedAt).toISOString(),
    usedBy: row.usedBy,
    revoked: row.revoked,
    createdAt: new Date(row.createdAt).toISOString(),
    status,
  }
}

/**
 * Single-use sign-up invites for the `invite-only` signup policy (PRD HS-01).
 * An invite is bound to one email and can grant membership of one tenant.
 */
export const invitesService = {
  async create(
    db: Database,
    input: CreateInviteInput
  ): Promise<ServiceResult<{ invite: SignupInviteView; token: string }>> {
    const email = normalizeEmail(input.email)
    if (!email.includes('@')) {
      return { success: false, error: { code: 'VALIDATION_ERROR', message: 'A valid email is required' } }
    }
    const hours = input.expiresInHours ?? DEFAULT_INVITE_TTL_HOURS
    if (!Number.isFinite(hours) || hours <= 0 || hours > MAX_INVITE_TTL_HOURS) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: `expiresInHours must be between 1 and ${MAX_INVITE_TTL_HOURS}`,
        },
      }
    }
    if (input.tenantRole && !input.tenantSlug) {
      return {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'tenantRole requires tenantSlug' },
      }
    }

    let tenantId: string | null = null
    if (input.tenantSlug) {
      // Repository, not tenantsService: this module is imported by the auth
      // config and must stay free of Worker-only dependencies.
      const tenant =
        (await tenantsRepository.findBySlug(db, input.tenantSlug)) ??
        (await tenantsRepository.findById(db, input.tenantSlug))
      if (!tenant) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: `Tenant '${input.tenantSlug}' not found` },
        }
      }
      tenantId = tenant.id
    }

    const token = generateInviteToken()
    const now = Date.now()
    const row = await invitesRepository.create(db, {
      id: crypto.randomUUID(),
      tokenHash: await hashInviteToken(token),
      email,
      tenantId,
      tenantRole: tenantId ? (input.tenantRole ?? 'member') : null,
      createdBy: input.createdBy ?? null,
      expiresAt: now + Math.round(hours * 60 * 60 * 1000),
      createdAt: now,
    })
    return { success: true, data: { invite: toView(row, now), token } }
  },

  async list(db: Database): Promise<ServiceResult<SignupInviteView[]>> {
    const now = Date.now()
    const rows = await invitesRepository.list(db)
    return { success: true, data: rows.map((row) => toView(row, now)) }
  },

  async revoke(db: Database, id: string): Promise<ServiceResult<{ id: string }>> {
    const existing = await invitesRepository.findById(db, id)
    if (!existing) {
      return { success: false, error: { code: 'NOT_FOUND', message: `Invite '${id}' not found` } }
    }
    if (!(await invitesRepository.revoke(db, id, Date.now()))) {
      return {
        success: false,
        error: { code: 'CONFLICT', message: 'Invite was already used or revoked' },
      }
    }
    return { success: true, data: { id } }
  },

  /** Read-only check used to reject sign-up early with a clear error. */
  async isUsable(db: Database, input: { token: string; email: string }): Promise<boolean> {
    const row = await invitesRepository.findByTokenHash(db, await hashInviteToken(input.token))
    return Boolean(
      row &&
        !row.revoked &&
        row.usedAt === null &&
        row.expiresAt > Date.now() &&
        row.email === normalizeEmail(input.email)
    )
  },

  /** Atomically consumes the invite; only one concurrent caller can win. */
  async consume(
    db: Database,
    input: { token: string; email: string }
  ): Promise<SignupInviteRow | undefined> {
    return invitesRepository.consume(db, {
      tokenHash: await hashInviteToken(input.token),
      email: normalizeEmail(input.email),
      now: Date.now(),
    })
  },

  /** Links a consumed invite to the new user and grants its tenant membership. */
  async complete(db: Database, input: { token: string; userId: string }): Promise<void> {
    const row = await invitesRepository.findByTokenHash(db, await hashInviteToken(input.token))
    if (!row || row.usedAt === null || row.usedBy !== null || row.revoked) return
    await invitesRepository.setUsedBy(db, row.id, input.userId)
    if (row.tenantId && row.tenantRole) {
      const existing = await tenantsRepository.findTenantUser(db, row.tenantId, input.userId)
      if (!existing) {
        await tenantsRepository.addUserToTenant(db, {
          tenantId: row.tenantId,
          userId: input.userId,
          role: row.tenantRole,
          createdAt: new Date().toISOString(),
        })
      }
    }
  },
}
