import type { CommandEnvelope } from '@edgecms/schemas/commands'
import type { Database } from '@/database/db'
import { collectionsRepository } from '@/collections/collections.repository'
import { entriesRepository } from '@/entries/entries.repository'
import type { DbPermission } from './authorization'
import type { TenantActorRole } from './rbac'

/**
 * PL-03: per-collection content permissions.
 *
 * The request guard decides whether a caller may reach a content route at all.
 * This module answers the finer question handlers and the command engine ask:
 * may this caller do `action` on entries of collection `slug`?
 *
 * Grants that cover content:
 * - `entry:<collectionSlug>` with `read`, `create`, `update`, `delete`,
 *   `publish`, `manage` or `*` — one collection.
 * - `entry:*` or `*:*` — every collection.
 * - `TenantAdminApi` — every collection (`read`, or `mutate` for writes).
 */
export type ContentAction = 'read' | 'create' | 'update' | 'delete' | 'publish'

export type ContentAccess = {
  /** The caller may do `action` on entries of every collection. */
  canAll(action: ContentAction): boolean
  /** The caller may do `action` on entries of the collection with this slug. */
  can(action: ContentAction, collectionSlug: string): boolean
}

const WRITE_ACTIONS = new Set<ContentAction>(['create', 'update', 'delete', 'publish'])

function actionGrants(permAction: string, action: ContentAction): boolean {
  if (permAction === action || permAction === 'manage' || permAction === '*') return true
  return permAction === 'mutate' && WRITE_ACTIONS.has(action)
}

function grantsAllCollections(subject: string): boolean {
  return subject === '*:*' || subject === 'entry:*' || subject === 'TenantAdminApi'
}

/** Content access from stored permission rows (custom roles). */
export function createContentAccess(permissions: readonly DbPermission[]): ContentAccess {
  const rows = permissions.map((p) => ({ subject: p.subject, action: p.action }))
  return {
    canAll(action) {
      return rows.some((p) => grantsAllCollections(p.subject) && actionGrants(p.action, action))
    },
    can(action, collectionSlug) {
      return rows.some(
        (p) =>
          (grantsAllCollections(p.subject) || p.subject === `entry:${collectionSlug}`) &&
          actionGrants(p.action, action)
      )
    },
  }
}

export const FULL_CONTENT_ACCESS: ContentAccess = createContentAccess([
  { subject: '*:*', action: 'manage' },
])
export const READ_ONLY_CONTENT_ACCESS: ContentAccess = createContentAccess([
  { subject: 'entry:*', action: 'read' },
])
export const NO_CONTENT_ACCESS: ContentAccess = createContentAccess([])

/**
 * Content access for a built-in tenant role. Mirrors the request guard:
 * owner, admin and editor write everywhere; member reads; viewer has none.
 */
export function builtInContentAccess(role: TenantActorRole | undefined): ContentAccess {
  if (role === 'owner' || role === 'admin' || role === 'editor') return FULL_CONTENT_ACCESS
  if (role === 'member') return READ_ONLY_CONTENT_ACCESS
  return NO_CONTENT_ACCESS
}

// ---------------------------------------------------------------------------
// Per-request handoff from the request guard to handlers
// ---------------------------------------------------------------------------

const requestContentAccess = new WeakMap<Request, () => Promise<ContentAccess>>()
const requestContentActor = new WeakMap<Request, string>()

/**
 * Called by the request guard once it has authorized a tenant request.
 * The resolver runs at most once and only if a handler asks. `actorId` is
 * the authorized user, for handlers that bind their output to the caller.
 */
export function setRequestContentAccess(
  request: Request,
  resolve: () => Promise<ContentAccess>,
  actorId?: string
): void {
  let memo: Promise<ContentAccess> | undefined
  requestContentAccess.set(request, () => {
    memo ??= resolve().catch(() => NO_CONTENT_ACCESS)
    return memo
  })
  if (actorId) requestContentActor.set(request, actorId)
}

/** The user the request guard authorized for this tenant request, if any. */
export function getRequestContentActorId(request: Request): string | undefined {
  return requestContentActor.get(request)
}

/**
 * The caller's content access for this request, or `undefined` when the
 * request guard did not authorize it as a tenant user (global routes,
 * deployment MCP keys, direct controller tests).
 */
export async function getRequestContentAccess(request: Request): Promise<ContentAccess | undefined> {
  return requestContentAccess.get(request)?.()
}

// ---------------------------------------------------------------------------
// Collection resolution
// ---------------------------------------------------------------------------

export type ContentTarget = {
  collectionIds?: readonly (string | undefined)[]
  collectionSlugs?: readonly (string | undefined)[]
  entryIds?: readonly (string | undefined)[]
}

/**
 * True when `access` allows `action` on every collection the target touches.
 * Fails closed: an id that does not resolve in this tenant is denied (unless
 * the caller has the action on every collection, which skips all reads).
 */
export async function canAccessContent(
  access: ContentAccess,
  db: Database,
  tenantId: string | undefined,
  action: ContentAction,
  target: ContentTarget
): Promise<boolean> {
  if (access.canAll(action)) return true

  const slugs = target.collectionSlugs ?? []
  if (slugs.some((slug) => typeof slug !== 'string' || !access.can(action, slug))) return false

  const entryIds = [...new Set(target.entryIds ?? [])]
  const collectionIds = new Set(target.collectionIds ?? [])
  if (entryIds.length === 0 && collectionIds.size === 0) return slugs.length > 0
  if (entryIds.some((id) => typeof id !== 'string' || id.length === 0)) return false
  if ([...collectionIds].some((id) => typeof id !== 'string' || id.length === 0)) return false

  if (entryIds.length > 0) {
    if (entryIds.length > 100) return false
    const rows = await entriesRepository.findByIds(db, entryIds as string[], tenantId)
    if (rows.length !== entryIds.length) return false
    for (const row of rows) collectionIds.add(row.collectionId)
  }

  const ids = [...collectionIds] as string[]
  if (ids.length > 100) return false
  const collections = await collectionsRepository.findByIds(db, ids, tenantId)
  if (collections.length !== ids.length) return false
  return collections.every((collection) => access.can(action, collection.slug))
}

/**
 * Request-level check for content handlers. Allows when the request guard
 * attached no content access (global routes, direct controller use).
 */
export async function requestCanAccessContent(
  request: Request,
  db: Database,
  tenantId: string | undefined,
  action: ContentAction,
  target: ContentTarget
): Promise<boolean> {
  const access = await getRequestContentAccess(request)
  if (!access) return true
  return canAccessContent(access, db, tenantId, action, target)
}

/** True when `access` allows `action` on the collection with this slug. */
export function canAccessCollectionSlug(
  access: ContentAccess,
  action: ContentAction,
  collectionSlug: string | undefined
): boolean {
  if (access.canAll(action)) return true
  return typeof collectionSlug === 'string' && access.can(action, collectionSlug)
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

const COMMAND_ACTIONS: Record<string, ContentAction> = {
  createEntry: 'create',
  updateEntry: 'update',
  updateSingleton: 'update',
  bulkUpdate: 'update',
  linkRelation: 'update',
  unlinkRelation: 'update',
  deleteEntry: 'delete',
  publishNow: 'publish',
  unpublishNow: 'publish',
  schedulePublish: 'publish',
  scheduleUnpublish: 'publish',
  cancelSchedule: 'publish',
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function commandTarget(envelope: CommandEnvelope): ContentTarget {
  const payload = (envelope.payload ?? {}) as Record<string, unknown>
  switch (envelope.type) {
    case 'createEntry':
    case 'updateSingleton':
      return { collectionIds: [str(payload.collectionId)] }
    case 'bulkUpdate': {
      const ids = Array.isArray(payload.entryIds) ? payload.entryIds.map(str) : [undefined]
      return { entryIds: ids }
    }
    case 'linkRelation':
    case 'unlinkRelation':
      return { entryIds: [str(payload.sourceEntryId)] }
    default:
      return { entryIds: [str(payload.entryId)] }
  }
}

/**
 * Check one command (and every command inside a transaction) against the
 * caller's content access. Returns an error to fail the command with, or
 * `null` when it is allowed.
 */
export async function authorizeCommandContent(
  access: ContentAccess,
  db: Database,
  tenantId: string | undefined,
  envelope: CommandEnvelope
): Promise<{ code: 'FORBIDDEN'; message: string } | null> {
  if (envelope.type === 'transaction') {
    const commands = (envelope.payload as { commands?: unknown }).commands
    if (!Array.isArray(commands)) return null
    for (const command of commands) {
      const denied = await authorizeCommandContent(access, db, tenantId, command as CommandEnvelope)
      if (denied) return denied
    }
    return null
  }

  const action = COMMAND_ACTIONS[envelope.type]
  if (!action) {
    // Unmapped command types fail closed for restricted callers.
    const unrestricted = (['create', 'update', 'delete', 'publish'] as const).every((a) =>
      access.canAll(a)
    )
    return unrestricted
      ? null
      : { code: 'FORBIDDEN', message: `Your role cannot run '${envelope.type}' commands` }
  }
  if (await canAccessContent(access, db, tenantId, action, commandTarget(envelope))) return null
  return {
    code: 'FORBIDDEN',
    message: `Your role cannot ${action} entries in this collection`,
  }
}
