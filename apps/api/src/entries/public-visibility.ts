import { publicEntryStatuses } from '@/shared/schemas/entry'

type VisibilityFields = {
  status: string
  publishAt?: string | null
  unpublishAt?: string | null
}

/**
 * In-memory twin of the SQL rule in `entriesRepository.findVisibleByCollection`:
 * an entry is publicly visible when its status is public (published|scheduled)
 * and `now` is inside its publish window (publishAt <= now < unpublishAt).
 */
export function isEntryPubliclyVisible(entry: VisibilityFields, nowIso: string): boolean {
  if (!(publicEntryStatuses as readonly string[]).includes(entry.status)) return false
  if (entry.publishAt && entry.publishAt > nowIso) return false
  if (entry.unpublishAt && entry.unpublishAt <= nowIso) return false
  return true
}

/**
 * Public-read visibility context for relation resolution. Pins one `now` for
 * a whole populate tree and records the nearest future publishAt/unpublishAt
 * among every related entry it saw (visible or not), so the caller can expire
 * the snapshot before a related entry enters or leaves its window.
 */
export interface PublicVisibility {
  readonly now: string
  nearestTransitionAt: string | null
}

export function createPublicVisibility(now = new Date().toISOString()): PublicVisibility {
  return { now, nearestTransitionAt: null }
}

/** Record future transitions of `entries`, then return only the visible ones. */
export function filterPubliclyVisible<T extends VisibilityFields>(
  entries: T[],
  visibility: PublicVisibility
): T[] {
  const { now } = visibility
  for (const entry of entries) {
    for (const at of [entry.publishAt, entry.unpublishAt]) {
      if (at && at > now && (!visibility.nearestTransitionAt || at < visibility.nearestTransitionAt)) {
        visibility.nearestTransitionAt = at
      }
    }
  }
  return entries.filter((entry) => isEntryPubliclyVisible(entry, now))
}

/** Seconds until the recorded nearest transition, or null when none. */
export function secondsUntilTransition(visibility: PublicVisibility | undefined): number | null {
  if (!visibility?.nearestTransitionAt) return null
  const ms = new Date(visibility.nearestTransitionAt).getTime() - Date.now()
  if (Number.isNaN(ms)) return null
  return Math.max(0, Math.floor(ms / 1000))
}
