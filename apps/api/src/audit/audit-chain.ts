/**
 * Pure hash-chain helpers for the audit events ledger (HS-12).
 *
 * Hash algorithm (documented in docs/public/operations-security.md so auditors
 * can re-verify an export offline):
 *
 *   hash = sha256hex(prevHash + '\n' + canonicalJson(hashedFields(event)))
 *
 * `canonicalJson` sorts object keys recursively. Personal identifiers enter the
 * hash only through `actorDigest` / `targetDigest`, so replacing `actorId` or
 * `targetId` with a pseudonym (HS-13) keeps every hash valid.
 */

export const AUDIT_GENESIS_HASH = '0'.repeat(64)
export const AUDIT_PSEUDONYM_PREFIX = 'deleted-user:'
export const AUDIT_GLOBAL_SCOPE = 'global'
export const AUDIT_PRUNE_ACTION = 'audit.retention_pruned'

export type AuditChainEvent = {
  id: string
  scope: string
  seq: number
  category: string
  action: string
  outcome: string
  actorId: string | null
  actorDigest: string | null
  actorSource: string
  targetType: string | null
  targetId: string | null
  targetDigest: string | null
  metadata: Record<string, unknown>
  occurredAt: string
  prevHash: string
  hash: string
}

export type AuditChainFailureReason =
  | 'hash_mismatch'
  | 'broken_link'
  | 'seq_gap'
  | 'bad_genesis'
  | 'missing_prune_record'
  | 'actor_digest_mismatch'
  | 'target_digest_mismatch'
  | 'scope_mismatch'

export type AuditChainVerification = {
  valid: boolean
  checked: number
  firstSeq: number | null
  headSeq: number | null
  headHash: string | null
  failure?: { seq: number; reason: AuditChainFailureReason }
}

const SECRET_KEY_PATTERN =
  /pass(word)?|secret|token|api[-_]?key|authorization|cookie|credential|e-?mail|session/i

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
}

export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Digest committed to the chain for a personal identifier. */
export async function subjectDigest(id: string | null | undefined): Promise<string | null> {
  if (!id) return null
  return sha256Hex(`edgecms-audit-subject:${id}`)
}

export function isPseudonym(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(AUDIT_PSEUDONYM_PREFIX)
}

/**
 * Recursively replace values under secret-looking keys with `[redacted]`.
 * Applied when events are written and again when they are exported.
 */
export function redactAuditMetadata(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[truncated]'
  if (Array.isArray(value)) return value.map((item) => redactAuditMetadata(item, depth + 1))
  if (value === null || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEY_PATTERN.test(key) ? '[redacted]' : redactAuditMetadata(v, depth + 1)
  }
  return out
}

function hashedFields(event: Omit<AuditChainEvent, 'hash' | 'prevHash' | 'actorId' | 'targetId'>) {
  return {
    id: event.id,
    scope: event.scope,
    seq: event.seq,
    category: event.category,
    action: event.action,
    outcome: event.outcome,
    actorDigest: event.actorDigest,
    actorSource: event.actorSource,
    targetType: event.targetType,
    targetDigest: event.targetDigest,
    metadata: event.metadata,
    occurredAt: event.occurredAt,
  }
}

export async function computeAuditHash(event: Omit<AuditChainEvent, 'hash'>): Promise<string> {
  return sha256Hex(`${event.prevHash}\n${canonicalJson(hashedFields(event))}`)
}

/**
 * Incremental verifier: push events of one scope in ascending `seq` order.
 * Works page by page so large chains never need to be held in memory.
 */
export function createAuditChainVerifier(scope: string) {
  let checked = 0
  let firstSeq: number | null = null
  let firstPrevHash: string | null = null
  let prev: { seq: number; hash: string } | null = null
  let failure: AuditChainVerification['failure']
  const pruneRecords = new Map<number, string>()

  const fail = (seq: number, reason: AuditChainFailureReason) => {
    if (!failure) failure = { seq, reason }
  }

  return {
    async push(event: AuditChainEvent): Promise<boolean> {
      if (failure) return false
      checked += 1
      if (event.scope !== scope) {
        fail(event.seq, 'scope_mismatch')
        return false
      }
      if (prev === null) {
        firstSeq = event.seq
        firstPrevHash = event.prevHash
        if (event.seq === 1 && event.prevHash !== AUDIT_GENESIS_HASH) {
          fail(event.seq, 'bad_genesis')
          return false
        }
      } else {
        if (event.seq !== prev.seq + 1) {
          fail(event.seq, 'seq_gap')
          return false
        }
        if (event.prevHash !== prev.hash) {
          fail(event.seq, 'broken_link')
          return false
        }
      }
      const recomputed = await computeAuditHash(event)
      if (recomputed !== event.hash) {
        fail(event.seq, 'hash_mismatch')
        return false
      }
      if (event.actorId && !isPseudonym(event.actorId)) {
        if ((await subjectDigest(event.actorId)) !== event.actorDigest) {
          fail(event.seq, 'actor_digest_mismatch')
          return false
        }
      }
      if (event.targetId && !isPseudonym(event.targetId)) {
        if ((await subjectDigest(event.targetId)) !== event.targetDigest) {
          fail(event.seq, 'target_digest_mismatch')
          return false
        }
      }
      if (event.action === AUDIT_PRUNE_ACTION) {
        const throughSeq = event.metadata.prunedThroughSeq
        const throughHash = event.metadata.prunedThroughHash
        if (typeof throughSeq === 'number' && typeof throughHash === 'string') {
          pruneRecords.set(throughSeq, throughHash)
        }
      }
      prev = { seq: event.seq, hash: event.hash }
      return true
    },

    result(): AuditChainVerification {
      // A chain whose oldest events were removed by retention must carry a
      // prune record (inside the chain) naming exactly the removed tail.
      if (!failure && firstSeq !== null && firstSeq > 1) {
        if (pruneRecords.get(firstSeq - 1) !== firstPrevHash) {
          fail(firstSeq, 'missing_prune_record')
        }
      }
      return {
        valid: !failure,
        checked,
        firstSeq,
        headSeq: prev?.seq ?? null,
        headHash: prev?.hash ?? null,
        ...(failure ? { failure } : {}),
      }
    },
  }
}

export async function verifyAuditChain(
  scope: string,
  events: AuditChainEvent[]
): Promise<AuditChainVerification> {
  const verifier = createAuditChainVerifier(scope)
  for (const event of events) {
    if (!(await verifier.push(event))) break
  }
  return verifier.result()
}
