import { describe, expect, it } from 'bun:test'
import {
  autosaveDraftConflict,
  autosaveDraftRequest,
  buildAutosaveDraftDecision,
  canDiffVersions,
  canReadPublicStatus,
  canRestoreVersion,
  canTransitionReviewStatus,
  duplicateEntryRequest,
  hasAutosaveConflict,
  hasScheduleConflict,
  previewTokenRequest,
  reviewAssignment,
  reviewTransition,
  reviewWorkflowStates,
  scheduleWindow,
  versionDiffRequest,
  versionRestoreRequest,
} from '../editorial-workflow'

describe('@edgecms/schemas editorial workflow', () => {
  it('validates tenant-scoped duplicate entry requests', () => {
    const result = duplicateEntryRequest({
      sourceEntryId: 'entry-1',
      tenantSlug: 'tenant-a',
      targetSlug: 'entry-1-copy',
      copyReviewAssignment: true,
    })

    expect(result).toMatchObject({ tenantSlug: 'tenant-a', targetSlug: 'entry-1-copy' })
  })

  it('validates autosave draft requests with optimistic versions', () => {
    const result = autosaveDraftRequest({
      entryId: 'entry-1',
      tenantSlug: 'tenant-a',
      baseVersion: 3,
      draftVersion: 4,
      data: { title: 'Draft title' },
    })

    expect(result).toMatchObject({ baseVersion: 3, draftVersion: 4 })
  })

  it('detects autosave draft version conflicts before save', () => {
    const conflict = autosaveDraftConflict({
      entryId: 'entry-1',
      tenantSlug: 'tenant-a',
      clientBaseVersion: 3,
      serverDraftVersion: 4,
    })
    const current = autosaveDraftConflict({
      entryId: 'entry-1',
      tenantSlug: 'tenant-a',
      clientBaseVersion: 4,
      serverDraftVersion: 4,
    })

    expect(hasAutosaveConflict(conflict)).toBe(true)
    expect(hasAutosaveConflict(current)).toBe(false)
  })

  it('builds autosave accept and conflict decisions with tenant context', () => {
    const accepted = buildAutosaveDraftDecision(
      autosaveDraftRequest({
        entryId: 'entry-1',
        tenantSlug: 'tenant-a',
        baseVersion: 4,
        draftVersion: 5,
        data: { title: 'Fresh draft' },
      }),
      4
    )
    const conflict = buildAutosaveDraftDecision(
      autosaveDraftRequest({
        entryId: 'entry-1',
        tenantSlug: 'tenant-a',
        baseVersion: 3,
        draftVersion: 5,
        data: { title: 'Stale draft' },
      }),
      4
    )

    expect(accepted).toMatchObject({ accepted: true, reason: 'accepted', tenantSlug: 'tenant-a' })
    expect(conflict).toMatchObject({ accepted: false, reason: 'conflict', serverDraftVersion: 4 })
  })

  it('requires signed server-only preview token metadata', () => {
    const result = previewTokenRequest({
      entryId: 'entry-1',
      tenantSlug: 'tenant-a',
      expiresAt: '2026-06-08T12:00:00.000Z',
      secretRef: 'PREVIEW_TOKEN_SECRET',
    })

    expect(result).toMatchObject({ secretRef: 'PREVIEW_TOKEN_SECRET' })
  })

  it('models review assignments separately from publication status', () => {
    const result = reviewAssignment({
      entryId: 'entry-1',
      tenantSlug: 'tenant-a',
      reviewerId: 'user-1',
      note: 'Check legal copy.',
    })

    expect(result).toMatchObject({ reviewerId: 'user-1' })
  })

  it('keeps review transitions explicit before publish', () => {
    const publishFromReview = reviewTransition({
      entryId: 'entry-1',
      tenantSlug: 'tenant-a',
      fromStatus: 'review',
      toStatus: 'published',
      actorId: 'user-1',
    })
    const publishFromDraft = reviewTransition({
      entryId: 'entry-1',
      tenantSlug: 'tenant-a',
      fromStatus: 'draft',
      toStatus: 'published',
      actorId: 'user-1',
    })

    expect(canTransitionReviewStatus(publishFromReview)).toBe(true)
    expect(canTransitionReviewStatus(publishFromDraft)).toBe(false)
  })

  it('keeps the review workflow state set explicit', () => {
    expect(reviewWorkflowStates).toEqual(['draft', 'review', 'scheduled', 'published', 'archived'])
  })

  it('keeps archived content out of public reads', () => {
    expect(canReadPublicStatus('published')).toBe(true)
    expect(canReadPublicStatus('draft')).toBe(false)
    expect(canReadPublicStatus('review')).toBe(false)
    expect(canReadPublicStatus('scheduled')).toBe(false)
    expect(canReadPublicStatus('archived')).toBe(false)
  })

  it('detects scheduled unpublish conflicts', () => {
    expect(
      hasScheduleConflict({
        entryId: 'entry-1',
        tenantSlug: 'tenant-a',
        publishAt: '2026-06-08T12:00:00.000Z',
        unpublishAt: '2026-06-08T11:00:00.000Z',
      }),
    ).toBe(true)

    expect(
      hasScheduleConflict({
        entryId: 'entry-1',
        tenantSlug: 'tenant-a',
        publishAt: '2026-06-08T12:00:00.000Z',
        unpublishAt: '2026-06-09T12:00:00.000Z',
      }),
    ).toBe(false)
  })

  it('validates schedule windows', () => {
    const result = scheduleWindow({
      entryId: 'entry-1',
      tenantSlug: 'tenant-a',
      publishAt: '2026-06-08T12:00:00.000Z',
      unpublishAt: '2026-06-09T12:00:00.000Z',
    })

    expect(result).toMatchObject({ tenantSlug: 'tenant-a' })
  })

  it('validates version restore requests', () => {
    const result = versionRestoreRequest({
      entryId: 'entry-1',
      tenantSlug: 'tenant-a',
      actorId: 'user-1',
      version: 3,
    })

    expect(canRestoreVersion(result)).toBe(true)
    expect(result).toMatchObject({ actorId: 'user-1', tenantSlug: 'tenant-a' })
  })

  it('rejects version restore requests without an explicit positive version', () => {
    expect(
      versionRestoreRequest({
        entryId: 'entry-1',
        tenantSlug: 'tenant-a',
        actorId: 'user-1',
        version: 0,
      }),
    ).toHaveProperty('issues')
  })

  it('validates version diff requests', () => {
    const result = versionDiffRequest({
      entryId: 'entry-1',
      tenantSlug: 'tenant-a',
      fromVersion: 2,
      toVersion: 3,
    })

    expect(canDiffVersions(result)).toBe(true)
  })
})
