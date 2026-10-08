/**
 * Command envelope and builder utilities for the admin command system.
 *
 * These functions construct typed command envelopes that are sent to the
 * `/api/admin/commands` endpoint. The server validates and executes them,
 * returning either the result or a diff for dry-run previews.
 */

export type CommandType =
  | 'createEntry'
  | 'updateEntry'
  | 'deleteEntry'
  | 'bulkUpdate'
  | 'updateSingleton'
  | 'linkRelation'
  | 'unlinkRelation'
  | 'publishNow'
  | 'unpublishNow'
  | 'schedulePublish'
  | 'scheduleUnpublish'
  | 'cancelSchedule'
  | 'transaction'

export type CommandActor = {
  source: 'admin' | 'ai' | 'sync' | 'scheduler'
}

/** Build the actor field for command envelopes. Server resolves userId from session. */
function adminActor(): CommandActor {
  return { source: 'admin' }
}

export type CommandEnvelope = {
  type: CommandType
  payload: Record<string, unknown>
  actor: CommandActor
  optimisticVersion?: number
  transactionId?: string
  dryRun?: boolean
  timestamp: string
}

/**
 * Build a createEntry command envelope
 */
export function buildCreateEntryCommand(
  collectionId: string,
  data: Record<string, unknown>,
  slug?: string,
  status?: string
): CommandEnvelope {
  return {
    type: 'createEntry',
    payload: {
      collectionId,
      data,
      slug,
      status,
    },
    actor: adminActor(),
    timestamp: new Date().toISOString(),
  }
}

/**
 * Build an updateEntry command envelope
 */
export function buildUpdateEntryCommand(
  entryId: string,
  data?: Record<string, unknown>,
  slug?: string,
  status?: string,
  optimisticVersion?: number
): CommandEnvelope {
  return {
    type: 'updateEntry',
    payload: {
      entryId,
      data,
      slug,
      status,
    },
    actor: adminActor(),
    optimisticVersion,
    timestamp: new Date().toISOString(),
  }
}

/**
 * Build a deleteEntry command envelope
 */
export function buildDeleteEntryCommand(entryId: string): CommandEnvelope {
  return {
    type: 'deleteEntry',
    payload: {
      entryId,
    },
    actor: adminActor(),
    timestamp: new Date().toISOString(),
  }
}

/**
 * Build a linkRelation command envelope
 */
export function buildLinkRelationCommand(params: {
  sourceEntryId: string
  targetEntryId: string
  sourceCollectionId: string
  targetCollectionId: string
  relationType: string
  fieldName: string
  sortOrder?: number
}): CommandEnvelope {
  return {
    type: 'linkRelation',
    payload: {
      sourceEntryId: params.sourceEntryId,
      targetEntryId: params.targetEntryId,
      sourceCollectionId: params.sourceCollectionId,
      targetCollectionId: params.targetCollectionId,
      relationType: params.relationType,
      fieldName: params.fieldName,
      sortOrder: params.sortOrder,
    },
    actor: adminActor(),
    timestamp: new Date().toISOString(),
  }
}

/**
 * Build an unlinkRelation command envelope
 */
export function buildUnlinkRelationCommand(
  sourceEntryId: string,
  targetEntryId: string,
  fieldName: string
): CommandEnvelope {
  return {
    type: 'unlinkRelation',
    payload: {
      sourceEntryId,
      targetEntryId,
      fieldName,
    },
    actor: adminActor(),
    timestamp: new Date().toISOString(),
  }
}

/**
 * Build a publishNow command envelope
 */
export function buildPublishNowCommand(entryId: string): CommandEnvelope {
  return {
    type: 'publishNow',
    payload: {
      entryId,
    },
    actor: adminActor(),
    timestamp: new Date().toISOString(),
  }
}

/**
 * Build an unpublishNow command envelope
 */
export function buildUnpublishNowCommand(entryId: string): CommandEnvelope {
  return {
    type: 'unpublishNow',
    payload: {
      entryId,
    },
    actor: adminActor(),
    timestamp: new Date().toISOString(),
  }
}

/**
 * Build a schedulePublish command envelope
 */
export function buildSchedulePublishCommand(entryId: string, publishAt: string): CommandEnvelope {
  return {
    type: 'schedulePublish',
    payload: {
      entryId,
      publishAt,
    },
    actor: adminActor(),
    timestamp: new Date().toISOString(),
  }
}

/**
 * Build a scheduleUnpublish command envelope
 */
export function buildScheduleUnpublishCommand(
  entryId: string,
  unpublishAt: string
): CommandEnvelope {
  return {
    type: 'scheduleUnpublish',
    payload: {
      entryId,
      unpublishAt,
    },
    actor: adminActor(),
    timestamp: new Date().toISOString(),
  }
}

/**
 * Build a cancelSchedule command envelope
 */
export function buildCancelScheduleCommand(entryId: string): CommandEnvelope {
  return {
    type: 'cancelSchedule',
    payload: {
      entryId,
    },
    actor: adminActor(),
    timestamp: new Date().toISOString(),
  }
}
