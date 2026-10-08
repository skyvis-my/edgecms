import { type } from 'arktype'

export const editorialStatus = type("'draft' | 'review' | 'scheduled' | 'published' | 'archived'")

export const duplicateEntryRequest = type({
  sourceEntryId: 'string > 0',
  tenantSlug: 'string > 0',
  targetSlug: 'string > 0',
  'copyReviewAssignment?': 'boolean',
})

export const autosaveDraftRequest = type({
  entryId: 'string > 0',
  tenantSlug: 'string > 0',
  baseVersion: 'number.integer >= 0',
  draftVersion: 'number.integer >= 0',
  data: 'Record<string, unknown>',
})

export const autosaveDraftConflict = type({
  entryId: 'string > 0',
  tenantSlug: 'string > 0',
  clientBaseVersion: 'number.integer >= 0',
  serverDraftVersion: 'number.integer >= 0',
})

export const previewTokenRequest = type({
  entryId: 'string > 0',
  tenantSlug: 'string > 0',
  expiresAt: 'string.date.iso',
  secretRef: 'string > 0',
})

export const reviewAssignment = type({
  entryId: 'string > 0',
  tenantSlug: 'string > 0',
  reviewerId: 'string > 0',
  'note?': 'string',
})

export const reviewTransition = type({
  entryId: 'string > 0',
  tenantSlug: 'string > 0',
  fromStatus: editorialStatus,
  toStatus: editorialStatus,
  actorId: 'string > 0',
})

export const scheduleWindow = type({
  entryId: 'string > 0',
  tenantSlug: 'string > 0',
  'publishAt?': 'string.date.iso',
  'unpublishAt?': 'string.date.iso',
})

export const versionRestoreRequest = type({
  entryId: 'string > 0',
  tenantSlug: 'string > 0',
  actorId: 'string > 0',
  version: 'number.integer > 0',
})

export const versionDiffRequest = type({
  entryId: 'string > 0',
  tenantSlug: 'string > 0',
  fromVersion: 'number.integer > 0',
  toVersion: 'number.integer > 0',
})

export type EditorialStatus = typeof editorialStatus.infer
export type AutosaveDraftRequest = typeof autosaveDraftRequest.infer
export type ScheduleWindow = typeof scheduleWindow.infer
export type ReviewTransition = typeof reviewTransition.infer

export const reviewWorkflowStates = ['draft', 'review', 'scheduled', 'published', 'archived'] as const satisfies EditorialStatus[]

export function canReadPublicStatus(status: EditorialStatus): boolean {
  return status === 'published'
}

export function hasAutosaveConflict(conflict: typeof autosaveDraftConflict.infer): boolean {
  return conflict.clientBaseVersion < conflict.serverDraftVersion
}

export function buildAutosaveDraftDecision(
  request: AutosaveDraftRequest,
  serverDraftVersion: number
): {
  accepted: boolean
  reason: 'accepted' | 'conflict'
  entryId: string
  tenantSlug: string
  draftVersion: number
  serverDraftVersion: number
} {
  const accepted = request.baseVersion >= serverDraftVersion
  return {
    accepted,
    reason: accepted ? 'accepted' : 'conflict',
    entryId: request.entryId,
    tenantSlug: request.tenantSlug,
    draftVersion: request.draftVersion,
    serverDraftVersion,
  }
}

export function canTransitionReviewStatus(transition: ReviewTransition): boolean {
  if (transition.fromStatus === transition.toStatus) return false
  if (transition.fromStatus === 'published') return transition.toStatus === 'archived'
  if (transition.toStatus === 'published') {
    return transition.fromStatus === 'review' || transition.fromStatus === 'scheduled'
  }
  return transition.fromStatus !== 'archived'
}

export function hasScheduleConflict(window: ScheduleWindow): boolean {
  if (!window.publishAt || !window.unpublishAt) {
    return false
  }

  return new Date(window.unpublishAt).getTime() <= new Date(window.publishAt).getTime()
}

export function canRestoreVersion(request: typeof versionRestoreRequest.infer): boolean {
  return request.version > 0
}

export function canDiffVersions(request: typeof versionDiffRequest.infer): boolean {
  return request.fromVersion !== request.toVersion
}
