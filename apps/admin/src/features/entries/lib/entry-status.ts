import type { CommandQueueItem } from '@/features/sync/local-db'
import type { EntryStatus } from '../api/entries-api'

/**
 * OF-05: one mapping from entry lifecycle + local sync state to what the admin shows.
 *
 * Two independent axes:
 * - lifecycle: what the server says (draft / published / scheduled / archived)
 * - sync: what this browser knows (saved, unsaved edits, queued offline, conflicted)
 *
 * Every state carries a text label and an icon key so colour is never the only signal.
 */

export type LifecycleKey = EntryStatus
export type SyncKey = 'saved' | 'unsaved' | 'saving' | 'queued' | 'conflicted'

export type StatusTone = 'neutral' | 'info' | 'success' | 'muted' | 'accent' | 'danger'

export type LifecycleDescriptor = {
  key: LifecycleKey
  label: string
  tone: StatusTone
  icon: 'draft' | 'published' | 'scheduled' | 'archived'
}

export type ScheduleDescriptor = {
  kind: 'publish' | 'unpublish'
  at: string
  label: string
}

export type SyncDescriptor = {
  key: SyncKey
  label: string
  tone: StatusTone
  icon: 'saved' | 'unsaved' | 'saving' | 'queued' | 'conflicted'
  count?: number
}

export type EntryStatusDescriptor = {
  lifecycle: LifecycleDescriptor
  schedule?: ScheduleDescriptor
  /** Undefined when there is nothing worth showing (list rows with no local changes). */
  sync?: SyncDescriptor
  /** Full sentence for screen readers, e.g. "Status: Scheduled, publishes 5 Nov 2026, 10:00. 1 change queued offline, not yet synced." */
  accessibleName: string
}

export type EntryQueueState = {
  pending: number
  conflicted: number
}

export type EntryStatusInput = {
  status: EntryStatus | string
  publishAt?: string | null
  unpublishAt?: string | null
  queue?: EntryQueueState
  /** Editor only: the form has edits that have not been saved or queued yet. */
  hasUnsavedChanges?: boolean
  /** Editor only: a save is in flight. */
  isSaving?: boolean
  /** Editor only: show "Saved" when nothing else applies. List rows leave this off. */
  showSaved?: boolean
  formatDate?: (iso: string) => string
}

const LIFECYCLE: Record<LifecycleKey, LifecycleDescriptor> = {
  draft: { key: 'draft', label: 'Draft', tone: 'neutral', icon: 'draft' },
  published: { key: 'published', label: 'Published', tone: 'success', icon: 'published' },
  scheduled: { key: 'scheduled', label: 'Scheduled', tone: 'info', icon: 'scheduled' },
  archived: { key: 'archived', label: 'Archived', tone: 'muted', icon: 'archived' },
}

function isLifecycleKey(value: string): value is LifecycleKey {
  return value in LIFECYCLE
}

function defaultFormatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function isValidDate(iso: string | null | undefined): iso is string {
  return typeof iso === 'string' && iso.length > 0 && !Number.isNaN(new Date(iso).getTime())
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

export function getEntryStatusDescriptor(input: EntryStatusInput): EntryStatusDescriptor {
  const formatDate = input.formatDate ?? defaultFormatDate
  // Unknown server values fall back to Draft rather than rendering a blank badge.
  const lifecycle = isLifecycleKey(input.status) ? LIFECYCLE[input.status] : LIFECYCLE.draft

  let schedule: ScheduleDescriptor | undefined
  if (lifecycle.key === 'scheduled' && isValidDate(input.publishAt)) {
    schedule = {
      kind: 'publish',
      at: input.publishAt,
      label: `Publishes ${formatDate(input.publishAt)}`,
    }
  } else if (lifecycle.key === 'published' && isValidDate(input.unpublishAt)) {
    schedule = {
      kind: 'unpublish',
      at: input.unpublishAt,
      label: `Unpublishes ${formatDate(input.unpublishAt)}`,
    }
  }

  const pending = Math.max(0, input.queue?.pending ?? 0)
  const conflicted = Math.max(0, input.queue?.conflicted ?? 0)

  // Priority: a conflict needs action, then queued work, then in-flight, then unsaved edits.
  let sync: SyncDescriptor | undefined
  if (conflicted > 0) {
    sync = {
      key: 'conflicted',
      label: 'Sync conflict',
      tone: 'danger',
      icon: 'conflicted',
      count: conflicted,
    }
  } else if (pending > 0) {
    sync = {
      key: 'queued',
      label: 'Queued offline',
      tone: 'accent',
      icon: 'queued',
      count: pending,
    }
  } else if (input.isSaving) {
    sync = { key: 'saving', label: 'Saving', tone: 'neutral', icon: 'saving' }
  } else if (input.hasUnsavedChanges) {
    sync = { key: 'unsaved', label: 'Unsaved changes', tone: 'neutral', icon: 'unsaved' }
  } else if (input.showSaved) {
    sync = { key: 'saved', label: 'Saved', tone: 'success', icon: 'saved' }
  }

  const parts = [`Status: ${lifecycle.label}`]
  if (schedule) parts[0] += `, ${schedule.label.charAt(0).toLowerCase()}${schedule.label.slice(1)}`
  if (sync?.key === 'conflicted') {
    parts.push(`${plural(conflicted, 'queued change')} in conflict, needs review`)
  } else if (sync?.key === 'queued') {
    parts.push(`${plural(pending, 'change')} queued offline, not yet synced`)
  } else if (sync) {
    parts.push(sync.label)
  }

  return { lifecycle, schedule, sync, accessibleName: `${parts.join('. ')}.` }
}

const ENTRY_PATH_PATTERN = /\/entries\/([^/?#]+)/

/**
 * Which entry a queued command touches. Command envelopes (OF-02) carry
 * `payload.entryId`; legacy `httpMutation` envelopes carry a path.
 */
export function getQueuedCommandEntryId(envelope: Record<string, unknown>): string | undefined {
  const payload = envelope.payload
  if (!payload || typeof payload !== 'object') return undefined
  const p = payload as Record<string, unknown>

  if (typeof p.entryId === 'string' && p.entryId) return p.entryId
  // linkRelation / unlinkRelation change the source entry.
  if (typeof p.sourceEntryId === 'string' && p.sourceEntryId) return p.sourceEntryId

  if (envelope.type === 'httpMutation' && typeof p.path === 'string') {
    const match = ENTRY_PATH_PATTERN.exec(p.path)
    if (match?.[1]) return decodeURIComponent(match[1])
  }

  if (envelope.type === 'transaction' && Array.isArray(p.commands)) {
    // A transaction touching one entry is attributed to it; multi-entry ones are left to the sync indicator.
    const ids = new Set(
      p.commands
        .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
        .map(getQueuedCommandEntryId)
        .filter((id): id is string => !!id)
    )
    if (ids.size === 1) return [...ids][0]
  }

  return undefined
}

/**
 * Group unsynced command-queue rows by entry id. Synced rows are ignored;
 * `syncing` rows still count as pending because the server has not confirmed them.
 * Rows from another tenant are skipped when a tenant is given.
 */
export function groupQueueByEntry(
  items: Pick<CommandQueueItem, 'envelope' | 'status' | 'tenantSlug'>[],
  tenantSlug?: string | null
): Map<string, EntryQueueState> {
  const result = new Map<string, EntryQueueState>()
  for (const item of items) {
    if (item.status === 'synced') continue
    if (tenantSlug && item.tenantSlug && item.tenantSlug !== tenantSlug) continue
    const entryId = getQueuedCommandEntryId(item.envelope)
    if (!entryId) continue
    const state = result.get(entryId) ?? { pending: 0, conflicted: 0 }
    if (item.status === 'conflicted') state.conflicted += 1
    else state.pending += 1
    result.set(entryId, state)
  }
  return result
}
