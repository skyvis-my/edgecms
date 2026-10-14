import { Type, createSchema } from './typebox'

export const editorialStatus = createSchema(
  Type.Union([
    Type.Literal('draft'),
    Type.Literal('review'),
    Type.Literal('scheduled'),
    Type.Literal('published'),
    Type.Literal('archived'),
  ])
)

export const duplicateEntryRequest = createSchema(
  Type.Object({
    sourceEntryId: Type.String({ minLength: 1 }),
    tenantSlug: Type.String({ minLength: 1 }),
    targetSlug: Type.String({ minLength: 1 }),
    copyReviewAssignment: Type.Optional(Type.Boolean()),
  })
)

export const autosaveDraftRequest = createSchema(
  Type.Object({
    entryId: Type.String({ minLength: 1 }),
    tenantSlug: Type.String({ minLength: 1 }),
    baseVersion: Type.Integer({ minimum: 0 }),
    draftVersion: Type.Integer({ minimum: 0 }),
    data: Type.Record(Type.String(), Type.Unknown()),
  })
)

export const autosaveDraftConflict = createSchema(
  Type.Object({
    entryId: Type.String({ minLength: 1 }),
    tenantSlug: Type.String({ minLength: 1 }),
    clientBaseVersion: Type.Integer({ minimum: 0 }),
    serverDraftVersion: Type.Integer({ minimum: 0 }),
  })
)

export const previewTokenRequest = createSchema(
  Type.Object({
    entryId: Type.String({ minLength: 1 }),
    tenantSlug: Type.String({ minLength: 1 }),
    expiresAt: Type.String({ minLength: 1 }),
    secretRef: Type.String({ minLength: 1 }),
  })
)

export const reviewAssignment = createSchema(
  Type.Object({
    entryId: Type.String({ minLength: 1 }),
    tenantSlug: Type.String({ minLength: 1 }),
    reviewerId: Type.String({ minLength: 1 }),
    note: Type.Optional(Type.String()),
  })
)

export const reviewTransition = createSchema(
  Type.Object({
    entryId: Type.String({ minLength: 1 }),
    tenantSlug: Type.String({ minLength: 1 }),
    fromStatus: editorialStatus,
    toStatus: editorialStatus,
    actorId: Type.String({ minLength: 1 }),
  })
)

export const scheduleWindow = createSchema(
  Type.Object({
    entryId: Type.String({ minLength: 1 }),
    tenantSlug: Type.String({ minLength: 1 }),
    publishAt: Type.Optional(Type.String({ minLength: 1 })),
    unpublishAt: Type.Optional(Type.String({ minLength: 1 })),
  })
)

export const versionRestoreRequest = createSchema(
  Type.Object({
    entryId: Type.String({ minLength: 1 }),
    tenantSlug: Type.String({ minLength: 1 }),
    actorId: Type.String({ minLength: 1 }),
    version: Type.Integer({ minimum: 1 }),
  })
)

export const versionDiffRequest = createSchema(
  Type.Object({
    entryId: Type.String({ minLength: 1 }),
    tenantSlug: Type.String({ minLength: 1 }),
    fromVersion: Type.Integer({ minimum: 1 }),
    toVersion: Type.Integer({ minimum: 1 }),
  })
)

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
