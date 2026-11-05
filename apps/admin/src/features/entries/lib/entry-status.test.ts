import { describe, expect, it } from 'bun:test'
import {
  getEntryStatusDescriptor,
  getQueuedCommandEntryId,
  groupQueueByEntry,
} from './entry-status'

const fmt = (iso: string) => `<${iso}>`
const FUTURE = '2026-12-01T09:00:00.000Z'

describe('getEntryStatusDescriptor lifecycle', () => {
  it.each([
    ['draft', 'Draft', 'neutral'],
    ['published', 'Published', 'success'],
    ['scheduled', 'Scheduled', 'info'],
    ['archived', 'Archived', 'muted'],
  ] as const)('maps %s to label %s with an icon', (status, label, tone) => {
    const d = getEntryStatusDescriptor({ status })
    expect(d.lifecycle.label).toBe(label)
    expect(d.lifecycle.tone).toBe(tone)
    expect(d.lifecycle.icon).toBe(status)
    expect(d.accessibleName).toBe(`Status: ${label}.`)
  })

  it('every lifecycle state has a distinct label and icon (not colour alone)', () => {
    const states = ['draft', 'published', 'scheduled', 'archived'].map(
      (status) => getEntryStatusDescriptor({ status }).lifecycle
    )
    expect(new Set(states.map((s) => s.label)).size).toBe(4)
    expect(new Set(states.map((s) => s.icon)).size).toBe(4)
  })

  it('falls back to Draft for an unknown server status', () => {
    expect(getEntryStatusDescriptor({ status: 'weird' }).lifecycle.key).toBe('draft')
  })
})

describe('getEntryStatusDescriptor schedule', () => {
  it('shows the publish time for scheduled entries', () => {
    const d = getEntryStatusDescriptor({ status: 'scheduled', publishAt: FUTURE, formatDate: fmt })
    expect(d.schedule).toEqual({ kind: 'publish', at: FUTURE, label: `Publishes <${FUTURE}>` })
    expect(d.accessibleName).toBe(`Status: Scheduled, publishes <${FUTURE}>.`)
  })

  it('shows the unpublish time for published entries with an unpublish date', () => {
    const d = getEntryStatusDescriptor({ status: 'published', unpublishAt: FUTURE, formatDate: fmt })
    expect(d.schedule?.kind).toBe('unpublish')
    expect(d.schedule?.label).toBe(`Unpublishes <${FUTURE}>`)
  })

  it('ignores publishAt on non-scheduled entries and invalid dates', () => {
    expect(getEntryStatusDescriptor({ status: 'draft', publishAt: FUTURE }).schedule).toBeUndefined()
    expect(
      getEntryStatusDescriptor({ status: 'scheduled', publishAt: 'not-a-date' }).schedule
    ).toBeUndefined()
    expect(getEntryStatusDescriptor({ status: 'scheduled', publishAt: null }).schedule).toBeUndefined()
  })
})

describe('getEntryStatusDescriptor sync state', () => {
  it('shows nothing for a list row with no local changes', () => {
    expect(getEntryStatusDescriptor({ status: 'published' }).sync).toBeUndefined()
  })

  it('shows Saved in the editor when nothing is pending', () => {
    const d = getEntryStatusDescriptor({ status: 'draft', showSaved: true })
    expect(d.sync?.key).toBe('saved')
    expect(d.accessibleName).toBe('Status: Draft. Saved.')
  })

  it('shows Unsaved changes when the form is dirty', () => {
    const d = getEntryStatusDescriptor({ status: 'draft', showSaved: true, hasUnsavedChanges: true })
    expect(d.sync?.key).toBe('unsaved')
    expect(d.sync?.label).toBe('Unsaved changes')
  })

  it('shows Saving while a save is in flight', () => {
    const d = getEntryStatusDescriptor({ status: 'draft', hasUnsavedChanges: true, isSaving: true })
    expect(d.sync?.key).toBe('saving')
  })

  it('queued offline wins over saving/unsaved and is announced as not yet synced', () => {
    const d = getEntryStatusDescriptor({
      status: 'published',
      queue: { pending: 2, conflicted: 0 },
      hasUnsavedChanges: true,
      isSaving: true,
      showSaved: true,
    })
    expect(d.sync).toMatchObject({ key: 'queued', label: 'Queued offline', count: 2, icon: 'queued' })
    expect(d.accessibleName).toBe('Status: Published. 2 changes queued offline, not yet synced.')
  })

  it('a conflict wins over queued work', () => {
    const d = getEntryStatusDescriptor({ status: 'draft', queue: { pending: 3, conflicted: 1 } })
    expect(d.sync).toMatchObject({ key: 'conflicted', tone: 'danger', count: 1 })
    expect(d.accessibleName).toBe('Status: Draft. 1 queued change in conflict, needs review.')
  })

  it('treats zero/negative queue counts as nothing queued', () => {
    expect(
      getEntryStatusDescriptor({ status: 'draft', queue: { pending: 0, conflicted: -1 } }).sync
    ).toBeUndefined()
  })

  it('never uses a yellow-family tone', () => {
    const tones = [
      getEntryStatusDescriptor({ status: 'archived' }).lifecycle.tone,
      getEntryStatusDescriptor({ status: 'draft', queue: { pending: 1, conflicted: 0 } }).sync?.tone,
      getEntryStatusDescriptor({ status: 'draft', hasUnsavedChanges: true }).sync?.tone,
    ]
    for (const tone of tones) expect(tone).not.toMatch(/yellow|amber|warning/)
  })
})

describe('getQueuedCommandEntryId', () => {
  it('reads payload.entryId from command envelopes', () => {
    expect(getQueuedCommandEntryId({ type: 'updateEntry', payload: { entryId: 'e1' } })).toBe('e1')
    expect(getQueuedCommandEntryId({ type: 'schedulePublish', payload: { entryId: 'e2' } })).toBe('e2')
  })

  it('attributes relation commands to the source entry', () => {
    expect(
      getQueuedCommandEntryId({
        type: 'linkRelation',
        payload: { sourceEntryId: 's1', targetEntryId: 't1' },
      })
    ).toBe('s1')
  })

  it('parses legacy httpMutation paths', () => {
    expect(
      getQueuedCommandEntryId({
        type: 'httpMutation',
        payload: { method: 'PUT', path: '/admin/entries/abc%201/publish' },
      })
    ).toBe('abc 1')
  })

  it('attributes a single-entry transaction and skips multi-entry ones', () => {
    const one = {
      type: 'transaction',
      payload: {
        commands: [
          { type: 'updateEntry', payload: { entryId: 'e1' } },
          { type: 'publishNow', payload: { entryId: 'e1' } },
        ],
      },
    }
    const many = {
      type: 'transaction',
      payload: {
        commands: [
          { type: 'updateEntry', payload: { entryId: 'e1' } },
          { type: 'updateEntry', payload: { entryId: 'e2' } },
        ],
      },
    }
    expect(getQueuedCommandEntryId(one)).toBe('e1')
    expect(getQueuedCommandEntryId(many)).toBeUndefined()
  })

  it('returns undefined for createEntry and malformed envelopes', () => {
    expect(getQueuedCommandEntryId({ type: 'createEntry', payload: { collectionId: 'c1' } })).toBeUndefined()
    expect(getQueuedCommandEntryId({ type: 'updateEntry' })).toBeUndefined()
    expect(getQueuedCommandEntryId({ type: 'updateEntry', payload: 'x' })).toBeUndefined()
  })
})

describe('groupQueueByEntry', () => {
  const env = (entryId: string) => ({ type: 'updateEntry', payload: { entryId } })

  it('counts pending/syncing as pending, conflicted separately, and skips synced', () => {
    const map = groupQueueByEntry([
      { envelope: env('e1'), status: 'pending', tenantSlug: 'acme' },
      { envelope: env('e1'), status: 'syncing', tenantSlug: 'acme' },
      { envelope: env('e1'), status: 'conflicted', tenantSlug: 'acme' },
      { envelope: env('e2'), status: 'synced', tenantSlug: 'acme' },
    ])
    expect(map.get('e1')).toEqual({ pending: 2, conflicted: 1 })
    expect(map.has('e2')).toBe(false)
  })

  it('skips rows from another tenant but keeps rows with no tenant recorded', () => {
    const map = groupQueueByEntry(
      [
        { envelope: env('e1'), status: 'pending', tenantSlug: 'other' },
        { envelope: env('e2'), status: 'pending', tenantSlug: null },
        { envelope: env('e3'), status: 'pending', tenantSlug: 'acme' },
      ],
      'acme'
    )
    expect([...map.keys()].sort()).toEqual(['e2', 'e3'])
  })
})
