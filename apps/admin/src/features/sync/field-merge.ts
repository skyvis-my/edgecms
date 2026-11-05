/**
 * OF-04: field-level three-way merge for queued entry updates.
 *
 * base   = the entry data the editor started from (the version sent as optimisticVersion)
 * local  = the data in the queued command
 * remote = the newer data on the server
 *
 * Fields (and, for localized fields, each locale) merge independently. A key is a
 * conflict only when both sides changed it to different values. Unresolved conflicts
 * take the remote value, so a newer server version is never overwritten without a
 * choice from the user.
 *
 * Pure: no I/O, no input mutation.
 */

type Data = Record<string, unknown>

export type MergeSource = 'local' | 'remote'

export type FieldConflict = {
  field: string
  locale?: string
  base: unknown
  local: unknown
  remote: unknown
}

export type AutoMergedChange = {
  field: string
  locale?: string
  source: MergeSource
}

export type MergeResult = {
  /** Merged data with every conflict set to the remote value. */
  merged: Data
  conflicts: FieldConflict[]
  autoMerged: AutoMergedChange[]
}

export type MergeInput = {
  /** null/undefined when the base snapshot is unknown (two-way fallback). */
  base: Data | null | undefined
  local: Data
  remote: Data
  /** Field names whose values are `{ [locale]: value }` maps. */
  localizedFields?: Iterable<string>
}

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key)
}

function isPlainObject(value: unknown): value is Data {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Structural equality for JSON-like values; object key order is ignored. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, i) => deepEqual(item, b[i]))
  }
  if (isPlainObject(a)) {
    if (!isPlainObject(b)) return false
    const aKeys = Object.keys(a).filter((k) => a[k] !== undefined)
    const bKeys = Object.keys(b).filter((k) => b[k] !== undefined)
    if (aKeys.length !== bKeys.length) return false
    return aKeys.every((k) => hasOwn(b, k) && deepEqual(a[k], b[k]))
  }
  return false
}

function clone<T>(value: T): T {
  if (value === undefined) return value
  return structuredClone(value)
}

type KeyOutcome =
  | { kind: 'same'; value: unknown }
  | { kind: 'take'; source: MergeSource; value: unknown }
  | { kind: 'conflict'; base: unknown; local: unknown; remote: unknown }

function mergeValue(
  hasBase: boolean,
  base: unknown,
  local: unknown,
  remote: unknown,
  localHasKey: boolean
): KeyOutcome {
  if (deepEqual(local, remote)) return { kind: 'same', value: remote }
  if (!hasBase) {
    // Unknown base: a key the local command never sent is the server's to keep.
    if (!localHasKey) return { kind: 'same', value: remote }
    return { kind: 'conflict', base: undefined, local, remote }
  }
  if (deepEqual(local, base)) return { kind: 'take', source: 'remote', value: remote }
  if (deepEqual(remote, base)) return { kind: 'take', source: 'local', value: local }
  return { kind: 'conflict', base, local, remote }
}

function sortedKeys(...objects: Array<Data | null | undefined>): string[] {
  const keys = new Set<string>()
  for (const obj of objects) {
    if (!obj) continue
    for (const key of Object.keys(obj)) keys.add(key)
  }
  return [...keys].sort()
}

function isLocaleMapOrMissing(value: unknown): boolean {
  return value === undefined || value === null || isPlainObject(value)
}

export function threeWayMerge(input: MergeInput): MergeResult {
  const hasBase = isPlainObject(input.base)
  const base: Data = hasBase ? (input.base as Data) : {}
  const { local, remote } = input
  const localized = new Set(input.localizedFields ?? [])

  const merged: Data = {}
  const conflicts: FieldConflict[] = []
  const autoMerged: AutoMergedChange[] = []

  for (const field of sortedKeys(base, local, remote)) {
    const b = base[field]
    const l = local[field]
    const r = remote[field]
    const localHasKey = hasOwn(local, field)

    const perLocale =
      localized.has(field) &&
      isLocaleMapOrMissing(b) &&
      isLocaleMapOrMissing(l) &&
      isLocaleMapOrMissing(r) &&
      (isPlainObject(l) || isPlainObject(r))

    if (perLocale) {
      const bm = isPlainObject(b) ? b : {}
      const lm = isPlainObject(l) ? l : {}
      const rm = isPlainObject(r) ? r : {}
      const out: Data = {}
      for (const locale of sortedKeys(bm, lm, rm)) {
        const outcome = mergeValue(
          hasBase,
          bm[locale],
          lm[locale],
          rm[locale],
          localHasKey && hasOwn(lm, locale)
        )
        let value: unknown
        if (outcome.kind === 'conflict') {
          conflicts.push({
            field,
            locale,
            base: clone(outcome.base),
            local: clone(outcome.local),
            remote: clone(outcome.remote),
          })
          value = outcome.remote
        } else {
          if (outcome.kind === 'take') autoMerged.push({ field, locale, source: outcome.source })
          value = outcome.value
        }
        if (value !== undefined) out[locale] = clone(value)
      }
      merged[field] = out
      continue
    }

    const outcome = mergeValue(hasBase, b, l, r, localHasKey)
    let value: unknown
    if (outcome.kind === 'conflict') {
      conflicts.push({
        field,
        base: clone(outcome.base),
        local: clone(outcome.local),
        remote: clone(outcome.remote),
      })
      value = outcome.remote
    } else {
      if (outcome.kind === 'take') autoMerged.push({ field, source: outcome.source })
      value = outcome.value
    }
    if (value !== undefined) merged[field] = clone(value)
  }

  return { merged, conflicts, autoMerged }
}

/** Stable id for a conflict: `field` or `field@locale`. */
export function conflictKey(conflict: Pick<FieldConflict, 'field' | 'locale'>): string {
  return conflict.locale === undefined ? conflict.field : `${conflict.field}@${conflict.locale}`
}

export type ConflictChoices = Record<string, MergeSource>

/**
 * Apply per-conflict choices to a merge result. Conflicts without a choice keep the
 * remote value. `overwritesRemote` lists every key where the user chose their own
 * value over the newer server value: the caller must confirm these before saving.
 */
export function applyConflictChoices(
  result: MergeResult,
  choices: ConflictChoices
): { data: Data; overwritesRemote: Array<{ field: string; locale?: string }> } {
  const data = clone(result.merged)
  const overwritesRemote: Array<{ field: string; locale?: string }> = []

  for (const conflict of result.conflicts) {
    if (choices[conflictKey(conflict)] !== 'local') continue
    overwritesRemote.push(
      conflict.locale === undefined
        ? { field: conflict.field }
        : { field: conflict.field, locale: conflict.locale }
    )
    const value = clone(conflict.local)
    if (conflict.locale === undefined) {
      if (value === undefined) delete data[conflict.field]
      else data[conflict.field] = value
      continue
    }
    const map = isPlainObject(data[conflict.field]) ? (data[conflict.field] as Data) : {}
    if (value === undefined) delete map[conflict.locale]
    else map[conflict.locale] = value
    data[conflict.field] = map
  }

  return { data, overwritesRemote }
}

/** Snapshot of the entry a queued update was based on (stored beside the queue row). */
export type ConflictBase = {
  version: number
  slug?: string
  data: Data
}

export type ServerEntrySnapshot = {
  version: number
  slug?: string
  status?: string
  collectionId?: string
  data: Data
}

export type QueuedEnvelope = Record<string, unknown> & {
  type?: unknown
  payload?: unknown
  optimisticVersion?: unknown
}

export type AutoMergePlan =
  | { kind: 'merged'; envelope: QueuedEnvelope; base: ConflictBase; merge: MergeResult }
  | { kind: 'noop'; merge: MergeResult }
  | { kind: 'review'; merge?: MergeResult }

/** Parse the `serverState.entry` a sync push conflict returns; tolerates JSON-string data. */
export function readServerEntry(serverState: unknown): ServerEntrySnapshot | undefined {
  if (!isPlainObject(serverState)) return undefined
  const entry = serverState.entry
  if (!isPlainObject(entry)) return undefined
  let data: unknown = entry.data
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data)
    } catch {
      return undefined
    }
  }
  if (!isPlainObject(data)) return undefined
  const version =
    typeof serverState.version === 'number'
      ? serverState.version
      : typeof entry.version === 'number'
        ? entry.version
        : undefined
  if (version === undefined) return undefined
  return {
    version,
    data,
    ...(typeof entry.slug === 'string' && { slug: entry.slug }),
    ...(typeof entry.status === 'string' && { status: entry.status }),
    ...(typeof entry.collectionId === 'string' && { collectionId: entry.collectionId }),
  }
}

/** Choice key for a conflicting entry slug (not a data field). */
export const SLUG_CONFLICT_KEY = '$slug'

export type ConflictReview = {
  envelope: QueuedEnvelope
  payload: Data
  serverEntry: ServerEntrySnapshot
  /** False when no base snapshot was stored: every differing field is listed. */
  hasBase: boolean
  merge: MergeResult
  slugConflict?: FieldConflict
  mergedSlug?: string
}

/**
 * Build the review for a conflicted queued `updateEntry`: the per-field (and per-locale)
 * merge plus the slug outcome. Returns undefined when the row is not a reviewable update.
 */
export function buildConflictReview(params: {
  envelope: QueuedEnvelope
  base: ConflictBase | undefined
  serverEntry: ServerEntrySnapshot | undefined
  localizedFields?: Iterable<string>
}): ConflictReview | undefined {
  const { envelope, base, serverEntry } = params
  if (envelope.type !== 'updateEntry' || !isPlainObject(envelope.payload)) return undefined
  if (!serverEntry) return undefined
  const usableBase = base && isPlainObject(base.data) ? base : undefined

  const payload = envelope.payload
  const localData = isPlainObject(payload.data) ? payload.data : (usableBase?.data ?? {})
  const merge = threeWayMerge({
    base: usableBase?.data ?? null,
    local: localData,
    remote: serverEntry.data,
    localizedFields: params.localizedFields,
  })

  const sentSlug = typeof payload.slug === 'string'
  const localSlug = sentSlug ? (payload.slug as string) : usableBase?.slug
  const slugOutcome = mergeValue(
    usableBase !== undefined,
    usableBase?.slug,
    localSlug,
    serverEntry.slug,
    sentSlug
  )

  const review: ConflictReview = {
    envelope,
    payload,
    serverEntry,
    hasBase: usableBase !== undefined,
    merge,
  }
  if (slugOutcome.kind === 'conflict') {
    review.slugConflict = {
      field: SLUG_CONFLICT_KEY,
      base: slugOutcome.base,
      local: slugOutcome.local,
      remote: slugOutcome.remote,
    }
    review.mergedSlug = serverEntry.slug
  } else {
    review.mergedSlug = slugOutcome.value as string | undefined
  }
  return review
}

/** Number of choices the user must make (data conflicts plus a slug conflict). */
export function countConflicts(review: ConflictReview): number {
  return review.merge.conflicts.length + (review.slugConflict ? 1 : 0)
}

export type ConflictResolution = {
  /** The rebased command (optimisticVersion = server version). */
  envelope: QueuedEnvelope
  /** New base snapshot for the rebased command. */
  base: ConflictBase
  /** Keys where the user's value replaces a newer server value; confirm before saving. */
  overwritesRemote: Array<{ field: string; locale?: string }>
  /** True when the result equals the server state: nothing needs to be pushed. */
  unchanged: boolean
}

export function resolveConflictReview(
  review: ConflictReview,
  choices: ConflictChoices
): ConflictResolution {
  const { data, overwritesRemote } = applyConflictChoices(review.merge, choices)
  let slug = review.mergedSlug
  if (review.slugConflict && choices[SLUG_CONFLICT_KEY] === 'local') {
    slug = review.slugConflict.local as string | undefined
    overwritesRemote.push({ field: SLUG_CONFLICT_KEY })
  }
  const { serverEntry } = review
  const unchanged = deepEqual(data, serverEntry.data) && (slug ?? serverEntry.slug) === serverEntry.slug

  const nextPayload: Data = { ...review.payload, data }
  if (slug !== undefined) nextPayload.slug = slug
  return {
    envelope: { ...review.envelope, payload: nextPayload, optimisticVersion: serverEntry.version },
    base: {
      version: serverEntry.version,
      ...(serverEntry.slug !== undefined && { slug: serverEntry.slug }),
      data: clone(serverEntry.data),
    },
    overwritesRemote,
    unchanged,
  }
}

/**
 * Decide what to do with an `updateEntry` that the server rejected with VERSION_CONFLICT.
 * - merged: no overlapping changes; rebased envelope targets the server version.
 * - noop: the merge equals the server state; nothing left to push.
 * - review: true conflicts (or no base snapshot) need the user.
 */
export function planConflictAutoMerge(params: {
  envelope: QueuedEnvelope
  base: ConflictBase | undefined
  serverEntry: ServerEntrySnapshot | undefined
  localizedFields?: Iterable<string>
}): AutoMergePlan {
  // Automatic merges need a base: without one, any difference may be a lost server change.
  if (!params.base) return { kind: 'review' }
  const review = buildConflictReview(params)
  if (!review) return { kind: 'review' }
  if (countConflicts(review) > 0) return { kind: 'review', merge: review.merge }
  const resolution = resolveConflictReview(review, {})
  if (resolution.unchanged) return { kind: 'noop', merge: review.merge }
  return { kind: 'merged', merge: review.merge, envelope: resolution.envelope, base: resolution.base }
}
