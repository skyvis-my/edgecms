/**
 * Entry lifecycle state machine for EdgeCMS.
 *
 * Manages valid transitions between entry status values and provides
 * validation for scheduling and publishing operations.
 */

/** Valid entry status values. */
export const EntryStatus = {
  DRAFT: 'draft',
  SCHEDULED: 'scheduled',
  PUBLISHED: 'published',
  ARCHIVED: 'archived',
} as const

export type EntryStatusValue = (typeof EntryStatus)[keyof typeof EntryStatus]

/** Valid state transitions map. Key: current status, Value: array of allowed target statuses. */
export const VALID_TRANSITIONS: Record<EntryStatusValue, EntryStatusValue[]> = {
  [EntryStatus.DRAFT]: [EntryStatus.SCHEDULED, EntryStatus.PUBLISHED],
  [EntryStatus.SCHEDULED]: [EntryStatus.PUBLISHED, EntryStatus.DRAFT],
  [EntryStatus.PUBLISHED]: [EntryStatus.ARCHIVED, EntryStatus.DRAFT],
  [EntryStatus.ARCHIVED]: [EntryStatus.DRAFT],
}

/** Validation result for state transitions. */
export type TransitionResult = { valid: true } | { valid: false; error: string }

/**
 * Validate whether a transition from one status to another is allowed.
 *
 * @param currentStatus - The current entry status
 * @param targetStatus - The desired target status
 * @returns Validation result with error message if invalid
 */
export function validateTransition(currentStatus: string, targetStatus: string): TransitionResult {
  // Validate status values exist
  if (!Object.values(EntryStatus).includes(currentStatus as EntryStatusValue)) {
    return {
      valid: false,
      error: `Invalid current status: '${currentStatus}'`,
    }
  }

  if (!Object.values(EntryStatus).includes(targetStatus as EntryStatusValue)) {
    return {
      valid: false,
      error: `Invalid target status: '${targetStatus}'`,
    }
  }

  // Check if already in target status
  if (currentStatus === targetStatus) {
    return {
      valid: false,
      error: `Entry is already in '${targetStatus}' status`,
    }
  }

  // Check if transition is allowed
  const allowedTransitions = VALID_TRANSITIONS[currentStatus as EntryStatusValue]
  if (!allowedTransitions.includes(targetStatus as EntryStatusValue)) {
    return {
      valid: false,
      error: `Cannot transition from '${currentStatus}' to '${targetStatus}'`,
    }
  }

  return { valid: true }
}

/**
 * Get all allowed target statuses from a given current status.
 *
 * @param currentStatus - The current entry status
 * @returns Array of allowed target statuses
 */
export function getAllowedTransitions(currentStatus: string): EntryStatusValue[] {
  if (!Object.values(EntryStatus).includes(currentStatus as EntryStatusValue)) {
    return []
  }
  return VALID_TRANSITIONS[currentStatus as EntryStatusValue]
}
