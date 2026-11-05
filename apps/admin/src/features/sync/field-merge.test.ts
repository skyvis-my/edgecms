import { describe, expect, it } from 'bun:test'
import {
  applyConflictChoices,
  buildConflictReview,
  conflictKey,
  countConflicts,
  readServerEntry,
  resolveConflictReview,
  SLUG_CONFLICT_KEY,
  planConflictAutoMerge,
  threeWayMerge,
} from './field-merge'

describe('threeWayMerge (OF-04)', () => {
  it('merges automatically when local and remote change different fields', () => {
    const result = threeWayMerge({
      base: { title: 'A', body: 'old body', tags: ['x'] },
      local: { title: 'A local', body: 'old body', tags: ['x'] },
      remote: { title: 'A', body: 'remote body', tags: ['x'] },
    })

    expect(result.conflicts).toEqual([])
    expect(result.merged).toEqual({ title: 'A local', body: 'remote body', tags: ['x'] })
    expect(result.autoMerged).toEqual([
      { field: 'body', source: 'remote' },
      { field: 'title', source: 'local' },
    ])
  })

  it('reports a conflict only when both sides changed the same field to different values', () => {
    const result = threeWayMerge({
      base: { title: 'A', body: 'b', count: 1 },
      local: { title: 'Mine', body: 'b', count: 2 },
      remote: { title: 'Theirs', body: 'b2', count: 2 },
    })

    expect(result.conflicts).toEqual([
      { field: 'title', base: 'A', local: 'Mine', remote: 'Theirs' },
    ])
    // Unresolved conflicts default to the remote value: nothing newer is overwritten silently.
    expect(result.merged).toEqual({ title: 'Theirs', body: 'b2', count: 2 })
  })

  it('treats equal changes on both sides as no conflict', () => {
    const result = threeWayMerge({
      base: { title: 'A' },
      local: { title: 'Same' },
      remote: { title: 'Same' },
    })
    expect(result.conflicts).toEqual([])
    expect(result.merged).toEqual({ title: 'Same' })
  })

  it('compares nested values structurally, ignoring key order', () => {
    const result = threeWayMerge({
      base: { seo: { a: 1, b: 2 } },
      local: { seo: { b: 2, a: 1 } },
      remote: { seo: { a: 1, b: 3 } },
    })
    expect(result.conflicts).toEqual([])
    expect(result.merged).toEqual({ seo: { a: 1, b: 3 } })
  })

  it('handles additions and deletions on either side', () => {
    const result = threeWayMerge({
      base: { keep: 1, droppedLocally: 'x', droppedRemotely: 'y' },
      local: { keep: 1, droppedRemotely: 'y', addedLocally: true },
      remote: { keep: 1, droppedLocally: 'x', addedRemotely: true },
    })
    expect(result.conflicts).toEqual([])
    expect(result.merged).toEqual({ keep: 1, addedLocally: true, addedRemotely: true })
  })

  it('flags delete-vs-edit as a conflict', () => {
    const result = threeWayMerge({
      base: { note: 'v1' },
      local: {},
      remote: { note: 'v2' },
    })
    expect(result.conflicts).toEqual([
      { field: 'note', base: 'v1', local: undefined, remote: 'v2' },
    ])
    expect(result.merged).toEqual({ note: 'v2' })
  })

  it('merges localized fields per locale', () => {
    const result = threeWayMerge({
      base: { title: { en: 'Hello', ms: 'Halo' } },
      local: { title: { en: 'Hello there', ms: 'Halo' } },
      remote: { title: { en: 'Hello', ms: 'Halo semua' } },
      localizedFields: ['title'],
    })
    expect(result.conflicts).toEqual([])
    expect(result.merged).toEqual({ title: { en: 'Hello there', ms: 'Halo semua' } })
    expect(result.autoMerged).toEqual([
      { field: 'title', locale: 'en', source: 'local' },
      { field: 'title', locale: 'ms', source: 'remote' },
    ])
  })

  it('reports a localized conflict only for the locale both sides changed', () => {
    const result = threeWayMerge({
      base: { title: { en: 'Hello', ms: 'Halo' } },
      local: { title: { en: 'Hi (mine)', ms: 'Halo kawan' } },
      remote: { title: { en: 'Hey (theirs)', ms: 'Halo' } },
      localizedFields: ['title'],
    })
    expect(result.conflicts).toEqual([
      { field: 'title', locale: 'en', base: 'Hello', local: 'Hi (mine)', remote: 'Hey (theirs)' },
    ])
    expect(result.merged).toEqual({ title: { en: 'Hey (theirs)', ms: 'Halo kawan' } })
  })

  it('without the localized hint, a per-locale object is one field', () => {
    const result = threeWayMerge({
      base: { title: { en: 'Hello', ms: 'Halo' } },
      local: { title: { en: 'Hello there', ms: 'Halo' } },
      remote: { title: { en: 'Hello', ms: 'Halo semua' } },
    })
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0]?.field).toBe('title')
    expect(result.conflicts[0]?.locale).toBeUndefined()
  })

  it('falls back to whole-field merge when a localized value is not a locale map', () => {
    const result = threeWayMerge({
      base: { title: 'plain' },
      local: { title: { en: 'Hello' } },
      remote: { title: 'changed' },
      localizedFields: ['title'],
    })
    expect(result.conflicts).toEqual([
      { field: 'title', base: 'plain', local: { en: 'Hello' }, remote: 'changed' },
    ])
  })

  it('drops a locale removed on one side and untouched on the other', () => {
    const result = threeWayMerge({
      base: { title: { en: 'Hello', ms: 'Halo' } },
      local: { title: { en: 'Hello' } },
      remote: { title: { en: 'Hello', ms: 'Halo' } },
      localizedFields: ['title'],
    })
    expect(result.merged).toEqual({ title: { en: 'Hello' } })
  })

  it('without a base, every field both sides hold differently is a conflict', () => {
    const result = threeWayMerge({
      base: null,
      local: { title: 'Mine', body: 'same' },
      remote: { title: 'Theirs', body: 'same', extra: 'server only' },
    })
    expect(result.conflicts).toEqual([
      { field: 'title', base: undefined, local: 'Mine', remote: 'Theirs' },
    ])
    // A field the local command never sent is kept from the server, not treated as a deletion.
    expect(result.merged).toEqual({ title: 'Theirs', body: 'same', extra: 'server only' })
  })

  it('does not mutate its inputs', () => {
    const base = { title: { en: 'a' } }
    const local = { title: { en: 'b' } }
    const remote = { title: { en: 'a' }, x: [1] }
    const snapshot = JSON.stringify({ base, local, remote })
    const result = threeWayMerge({ base, local, remote, localizedFields: ['title'] })
    ;(result.merged.title as Record<string, unknown>).en = 'mutated'
    ;(result.merged.x as unknown[]).push(2)
    expect(JSON.stringify({ base, local, remote })).toBe(snapshot)
  })
})

describe('applyConflictChoices', () => {
  const result = threeWayMerge({
    base: { title: { en: 'Hello', ms: 'Halo' }, body: 'b' },
    local: { title: { en: 'Mine', ms: 'Halo mine' }, body: 'local body' },
    remote: { title: { en: 'Theirs', ms: 'Halo theirs' }, body: 'remote body' },
    localizedFields: ['title'],
  })

  it('uses keys of field or field@locale', () => {
    expect(result.conflicts.map(conflictKey)).toEqual(['body', 'title@en', 'title@ms'])
  })

  it('applies keep-mine per field and per locale, leaving the rest remote', () => {
    const { data, overwritesRemote } = applyConflictChoices(result, {
      'title@en': 'local',
      body: 'remote',
    })
    expect(data).toEqual({ title: { en: 'Mine', ms: 'Halo theirs' }, body: 'remote body' })
    expect(overwritesRemote).toEqual([{ field: 'title', locale: 'en' }])
  })

  it('defaults unchosen conflicts to the remote value', () => {
    const { data, overwritesRemote } = applyConflictChoices(result, {})
    expect(data).toEqual({ title: { en: 'Theirs', ms: 'Halo theirs' }, body: 'remote body' })
    expect(overwritesRemote).toEqual([])
  })

  it('removes a field when the chosen local side deleted it', () => {
    const r = threeWayMerge({ base: { note: 'v1' }, local: {}, remote: { note: 'v2' } })
    expect(applyConflictChoices(r, { note: 'local' }).data).toEqual({})
  })
})

describe('planConflictAutoMerge', () => {
  const envelope = {
    type: 'updateEntry',
    payload: { entryId: 'e1', slug: 'hello', data: { title: 'Mine', body: 'b' } },
    optimisticVersion: 3,
    actor: { userId: 'u', source: 'admin' },
    timestamp: '2026-11-05T00:00:00.000Z',
  }

  it('rebases the queued command onto the server version when nothing overlaps', () => {
    const plan = planConflictAutoMerge({
      envelope,
      base: { version: 3, slug: 'hello', data: { title: 'A', body: 'b' } },
      serverEntry: { version: 5, slug: 'hello', data: { title: 'A', body: 'remote' } },
    })
    expect(plan.kind).toBe('merged')
    if (plan.kind !== 'merged') return
    expect(plan.envelope.optimisticVersion).toBe(5)
    expect(plan.envelope.payload).toEqual({
      entryId: 'e1',
      slug: 'hello',
      data: { title: 'Mine', body: 'remote' },
    })
    expect(plan.base).toEqual({ version: 5, slug: 'hello', data: { title: 'A', body: 'remote' } })
  })

  it('keeps a remote slug change when the local slug is unchanged', () => {
    const plan = planConflictAutoMerge({
      envelope,
      base: { version: 3, slug: 'hello', data: { title: 'A', body: 'b' } },
      serverEntry: { version: 4, slug: 'hello-renamed', data: { title: 'A', body: 'b' } },
    })
    expect(plan.kind).toBe('merged')
    if (plan.kind !== 'merged') return
    expect((plan.envelope.payload as Record<string, unknown>).slug).toBe('hello-renamed')
  })

  it('needs review when fields truly conflict', () => {
    const plan = planConflictAutoMerge({
      envelope,
      base: { version: 3, slug: 'hello', data: { title: 'A', body: 'b' } },
      serverEntry: { version: 4, slug: 'hello', data: { title: 'Theirs', body: 'b' } },
    })
    expect(plan.kind).toBe('review')
  })

  it('needs review when slugs conflict', () => {
    const plan = planConflictAutoMerge({
      envelope: { ...envelope, payload: { ...envelope.payload, slug: 'mine' } },
      base: { version: 3, slug: 'hello', data: { title: 'Mine', body: 'b' } },
      serverEntry: { version: 4, slug: 'theirs', data: { title: 'Mine', body: 'b' } },
    })
    expect(plan.kind).toBe('review')
  })

  it('needs review without a base snapshot or for non-update commands', () => {
    expect(
      planConflictAutoMerge({
        envelope,
        base: undefined,
        serverEntry: { version: 4, data: { title: 'A', body: 'b' } },
      }).kind
    ).toBe('review')
    expect(
      planConflictAutoMerge({
        envelope: { ...envelope, type: 'deleteEntry' },
        base: { version: 3, data: {} },
        serverEntry: { version: 4, data: {} },
      }).kind
    ).toBe('review')
  })

  it('reports nothing to push when the merge equals the server state', () => {
    const plan = planConflictAutoMerge({
      envelope: { ...envelope, payload: { ...envelope.payload, data: { title: 'A', body: 'b' } } },
      base: { version: 3, slug: 'hello', data: { title: 'A', body: 'b' } },
      serverEntry: { version: 4, slug: 'hello', data: { title: 'A', body: 'remote' } },
    })
    expect(plan.kind).toBe('noop')
  })
})

describe('buildConflictReview / resolveConflictReview', () => {
  const envelope = {
    type: 'updateEntry',
    payload: { entryId: 'e1', slug: 'mine', data: { title: { en: 'Mine', ms: 'Hai' }, body: 'b' } },
    optimisticVersion: 2,
  }
  const base = { version: 2, slug: 'post', data: { title: { en: 'Hi', ms: 'Hai' }, body: 'b' } }
  const serverEntry = {
    version: 4,
    slug: 'theirs',
    data: { title: { en: 'Theirs', ms: 'Hai' }, body: 'server body' },
  }

  it('lists only true conflicts, including a slug both sides renamed', () => {
    const review = buildConflictReview({ envelope, base, serverEntry, localizedFields: ['title'] })
    expect(review).toBeDefined()
    if (!review) return
    expect(review.merge.conflicts.map(conflictKey)).toEqual(['title@en'])
    expect(review.slugConflict).toMatchObject({ field: SLUG_CONFLICT_KEY, local: 'mine', remote: 'theirs' })
    expect(countConflicts(review)).toBe(2)
  })

  it('takes theirs by default and targets the server version', () => {
    const review = buildConflictReview({ envelope, base, serverEntry, localizedFields: ['title'] })
    if (!review) throw new Error('no review')
    const res = resolveConflictReview(review, {})
    expect(res.overwritesRemote).toEqual([])
    expect(res.unchanged).toBe(true)
    expect(res.envelope.optimisticVersion).toBe(4)
    expect(res.base).toEqual({ version: 4, slug: 'theirs', data: serverEntry.data })
  })

  it('reports every keep-mine choice as an overwrite that needs confirmation', () => {
    const review = buildConflictReview({ envelope, base, serverEntry, localizedFields: ['title'] })
    if (!review) throw new Error('no review')
    const res = resolveConflictReview(review, { 'title@en': 'local', [SLUG_CONFLICT_KEY]: 'local' })
    expect(res.overwritesRemote).toEqual([
      { field: 'title', locale: 'en' },
      { field: SLUG_CONFLICT_KEY },
    ])
    expect(res.unchanged).toBe(false)
    expect(res.envelope.payload).toEqual({
      entryId: 'e1',
      slug: 'mine',
      data: { title: { en: 'Mine', ms: 'Hai' }, body: 'server body' },
    })
  })

  it('falls back to two-way review without a base', () => {
    const review = buildConflictReview({ envelope, base: undefined, serverEntry, localizedFields: ['title'] })
    if (!review) throw new Error('no review')
    expect(review.hasBase).toBe(false)
    expect(review.merge.conflicts.map(conflictKey)).toEqual(['body', 'title@en'])
  })

  it('returns undefined for non-update commands or missing server state', () => {
    expect(buildConflictReview({ envelope: { type: 'deleteEntry', payload: {} }, base, serverEntry })).toBeUndefined()
    expect(buildConflictReview({ envelope, base, serverEntry: undefined })).toBeUndefined()
  })
})

describe('readServerEntry', () => {
  it('reads the sync push conflict shape and JSON-string data', () => {
    expect(
      readServerEntry({
        entry: { id: 'e1', slug: 's', collectionId: 'c1', status: 'draft', data: '{"a":1}' },
        version: 7,
      })
    ).toEqual({ version: 7, slug: 's', collectionId: 'c1', status: 'draft', data: { a: 1 } })
  })

  it('rejects shapes it cannot merge against', () => {
    expect(readServerEntry(undefined)).toBeUndefined()
    expect(readServerEntry({ entry: { id: 'e1', title: 'no data' }, version: 1 })).toBeUndefined()
    expect(readServerEntry({ entry: { data: {} } })).toBeUndefined()
  })
})
