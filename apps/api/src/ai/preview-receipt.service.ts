import type { CommandEnvelope, PreviewReceiptRecord } from '@edgecms/schemas/commands'
import type { Database } from '@/database/db'
import { previewReceiptRedemptions } from '@/database/schema/preview-receipts.schema'

const DEFAULT_RECEIPT_TTL_SECONDS = 900 // 15 minutes
const RECEIPT_KEY_PREFIX = 'preview_receipt:'

const MAX_MEMORY_RECEIPTS = 500
// In-memory fallback for local execution / tests without KV
const memoryReceiptStore = new Map<string, { receipt: PreviewReceiptRecord; expiresAtMs: number }>()

function pruneMemoryReceiptStoreIfNeeded(): void {
  const now = Date.now()
  if (memoryReceiptStore.size >= MAX_MEMORY_RECEIPTS) {
    for (const [key, entry] of memoryReceiptStore) {
      if (entry.expiresAtMs <= now) {
        memoryReceiptStore.delete(key)
      }
    }
  }
  while (memoryReceiptStore.size >= MAX_MEMORY_RECEIPTS) {
    const oldestKey = memoryReceiptStore.keys().next().value
    if (!oldestKey) break
    memoryReceiptStore.delete(oldestKey)
  }
}

// Receipt ids redeemed in this isolate: closes same-isolate races before the
// durable claim, and is the only claim when no SQL database is available.
const claimedReceiptIds = new Set<string>()

export function __resetPreviewReceiptStoreForTests(): void {
  memoryReceiptStore.clear()
  claimedReceiptIds.clear()
}

/**
 * Computes SHA-256 hex digest for a string or buffer.
 */
export async function sha256Hex(input: string | ArrayBuffer): Promise<string> {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Canonical JSON serialization with recursively sorted object keys.
 */
function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(',')}]`
  }
  const keys = Object.keys(value as Record<string, unknown>).sort()
  const entries: string[] = []
  for (const key of keys) {
    const val = (value as Record<string, unknown>)[key]
    if (val !== undefined) {
      entries.push(`${JSON.stringify(key)}:${canonicalStringify(val)}`)
    }
  }
  return `{${entries.join(',')}}`
}

/**
 * Normalizes commands into a canonical representation for cryptographic hashing.
 * Ignores ephemeral non-semantic fields (like top-level timestamp) while preserving
 * command type, payload, actor identity, and optimistic concurrency version.
 */
export function canonicalizeCommandEnvelopes(commands: CommandEnvelope[]): string {
  const normalized = commands.map((cmd) => ({
    type: cmd.type,
    payload: cmd.payload,
    actor: {
      userId: cmd.actor.userId,
      source: cmd.actor.source,
    },
    optimisticVersion: cmd.optimisticVersion,
  }))
  return canonicalStringify(normalized)
}

/**
 * Computes the SHA-256 digest of a set of command envelopes.
 */
export async function computeCommandsHash(commands: CommandEnvelope[]): Promise<string> {
  const canonical = canonicalizeCommandEnvelopes(commands)
  return sha256Hex(canonical)
}

export interface CreatePreviewReceiptOptions {
  commands: CommandEnvelope[]
  userId: string
  tenantId?: string
  explanation?: string
  ttlSeconds?: number
  kv?: KVNamespace
}

/**
 * Generates an immutable preview receipt for staged commands.
 */
export async function createPreviewReceipt(
  options: CreatePreviewReceiptOptions
): Promise<PreviewReceiptRecord> {
  const { commands, userId, tenantId, ttlSeconds = DEFAULT_RECEIPT_TTL_SECONDS, kv } = options
  const hash = await computeCommandsHash(commands)
  const receiptId = `rcpt_${crypto.randomUUID()}`
  const now = new Date()
  const createdAt = now.toISOString()
  const expiresAtMs = now.getTime() + ttlSeconds * 1000
  const expiresAt = new Date(expiresAtMs).toISOString()

  // Deep-clone and embed receiptId into command envelopes for tracking
  const stagedCommands: CommandEnvelope[] = commands.map((cmd) => ({
    ...cmd,
    previewReceipt: receiptId,
  }))

  const record: PreviewReceiptRecord = {
    receiptId,
    hash,
    commands: stagedCommands,
    userId,
    ...(tenantId ? { tenantId } : {}),
    ...(options.explanation ? { explanation: options.explanation } : {}),
    createdAt,
    expiresAt,
  }

  // Store in memory
  pruneMemoryReceiptStoreIfNeeded()
  memoryReceiptStore.set(receiptId, { receipt: record, expiresAtMs })

  // Store in KV if available
  if (kv && typeof kv.put === 'function') {
    try {
      const kvKey = tenantId
        ? `${tenantId}:${RECEIPT_KEY_PREFIX}${receiptId}`
        : `${RECEIPT_KEY_PREFIX}${receiptId}`
      await kv.put(kvKey, JSON.stringify(record), { expirationTtl: ttlSeconds })
    } catch {
      // Non-fatal if KV fails, memory fallback is present
    }
  }

  return record
}

export type PreviewReceiptErrorCode =
  | 'RECEIPT_NOT_FOUND'
  | 'RECEIPT_EXPIRED'
  | 'RECEIPT_ALREADY_USED'
  | 'ACTOR_MISMATCH'
  | 'TENANT_MISMATCH'
  | 'HASH_MISMATCH'
  | 'RECEIPT_CLAIM_FAILED'

export interface VerifyReceiptResult {
  valid: boolean
  error?: PreviewReceiptErrorCode
  message?: string
  receipt?: PreviewReceiptRecord
}

/** Typed rejection thrown by flows that redeem a receipt outside the engine. */
export class PreviewReceiptError extends Error {
  readonly code: PreviewReceiptErrorCode

  constructor(code: PreviewReceiptErrorCode, message: string) {
    super(message)
    this.name = 'PreviewReceiptError'
    this.code = code
  }
}

/** HTTP status for a receipt rejection on REST routes. */
export function previewReceiptErrorStatus(code: PreviewReceiptErrorCode): number {
  switch (code) {
    case 'RECEIPT_ALREADY_USED':
      return 409
    case 'ACTOR_MISMATCH':
    case 'TENANT_MISMATCH':
      return 403
    case 'RECEIPT_CLAIM_FAILED':
      return 503
    default:
      return 400
  }
}

/**
 * Marks a preview receipt as consumed to prevent replay attacks.
 */
export async function markPreviewReceiptConsumed(
  receiptId: string,
  kv?: KVNamespace,
  tenantId?: string
): Promise<boolean> {
  const now = new Date().toISOString()
  const memoryEntry = memoryReceiptStore.get(receiptId)
  if (memoryEntry) {
    memoryEntry.receipt.consumedAt = now
  }

  if (kv && typeof kv.get === 'function' && typeof kv.put === 'function') {
    try {
      const kvKey = tenantId
        ? `${tenantId}:${RECEIPT_KEY_PREFIX}${receiptId}`
        : `${RECEIPT_KEY_PREFIX}${receiptId}`
      const raw = await kv.get(kvKey)
      if (raw) {
        const record = JSON.parse(raw) as PreviewReceiptRecord
        record.consumedAt = now
        await kv.put(kvKey, JSON.stringify(record), { expirationTtl: 300 })
      }
    } catch {
      // ignore
    }
  }

  return true
}

/**
 * Retrieves a preview receipt from memory or KV.
 */
export async function getPreviewReceipt(
  receiptId: string,
  kv?: KVNamespace,
  tenantId?: string
): Promise<PreviewReceiptRecord | null> {
  // Check memory first
  const memoryEntry = memoryReceiptStore.get(receiptId)
  if (memoryEntry) {
    return memoryEntry.receipt
  }

  // Check KV
  if (kv && typeof kv.get === 'function') {
    try {
      const kvKey = tenantId
        ? `${tenantId}:${RECEIPT_KEY_PREFIX}${receiptId}`
        : `${RECEIPT_KEY_PREFIX}${receiptId}`
      const raw = await kv.get(kvKey)
      if (raw) {
        const parsed = JSON.parse(raw) as PreviewReceiptRecord
        return parsed
      }
    } catch {
      return null
    }
  }

  return null
}

/**
 * Verifies that a preview receipt is valid, unexpired, matches the actor/tenant,
 * has not already been executed (replay check), and possesses an uncorrupted cryptographic SHA-256 hash.
 */
export async function verifyPreviewReceipt(options: {
  receiptId: string
  userId: string
  tenantId?: string
  kv?: KVNamespace
  commandsToVerify?: CommandEnvelope[]
}): Promise<VerifyReceiptResult> {
  const { receiptId, userId, tenantId, kv, commandsToVerify } = options
  const receipt = await getPreviewReceipt(receiptId, kv, tenantId)

  if (!receipt) {
    return {
      valid: false,
      error: 'RECEIPT_NOT_FOUND',
      message: `Preview receipt '${receiptId}' was not found or has expired`,
    }
  }

  // Expiration check
  if (new Date(receipt.expiresAt).getTime() <= Date.now()) {
    return {
      valid: false,
      error: 'RECEIPT_EXPIRED',
      message: `Preview receipt '${receiptId}' has expired`,
    }
  }

  // Replay protection check
  if (receipt.consumedAt) {
    return {
      valid: false,
      error: 'RECEIPT_ALREADY_USED',
      message: `Preview receipt '${receiptId}' has already been executed (replay prevented)`,
    }
  }

  // Actor boundary check
  if (receipt.userId !== userId) {
    return {
      valid: false,
      error: 'ACTOR_MISMATCH',
      message: `Preview receipt '${receiptId}' belongs to a different actor`,
    }
  }

  // Tenant boundary check
  const receiptTenant = receipt.tenantId ?? null
  const expectedTenant = tenantId ?? null
  if (receiptTenant !== expectedTenant) {
    return {
      valid: false,
      error: 'TENANT_MISMATCH',
      message: `Preview receipt '${receiptId}' belongs to a different tenant scope`,
    }
  }

  // Integrity hash verification against stored commands
  const computedHash = await computeCommandsHash(receipt.commands)
  if (computedHash !== receipt.hash) {
    return {
      valid: false,
      error: 'HASH_MISMATCH',
      message: 'Preview receipt integrity verification failed (stored commands hash corrupted)',
    }
  }

  // Caller-supplied commands must be exactly the reviewed set: same commands,
  // same order, same count. Subsets, repeats and reorders are rejected.
  if (commandsToVerify && commandsToVerify.length > 0) {
    const callerHash = await computeCommandsHash(commandsToVerify)
    if (callerHash !== receipt.hash) {
      return {
        valid: false,
        error: 'HASH_MISMATCH',
        message: 'Supplied commands do not match the reviewed preview (divergence detected)',
      }
    }
  }

  return {
    valid: true,
    receipt,
  }
}

function hasSqlInsert(db: Database | undefined): db is Database {
  return typeof (db as { insert?: unknown } | undefined)?.insert === 'function'
}

/**
 * Atomically claims a receipt for execution. Returns false when it was
 * already claimed (replay or concurrent execution). Throws when the durable
 * claim cannot be recorded, so callers fail closed.
 */
async function claimPreviewReceipt(
  receipt: PreviewReceiptRecord,
  tenantId: string | undefined,
  db: Database | undefined
): Promise<boolean> {
  if (claimedReceiptIds.has(receipt.receiptId)) return false
  if (claimedReceiptIds.size >= MAX_MEMORY_RECEIPTS * 4) {
    // Bounded per isolate; the durable ledger below stays authoritative.
    const oldest = claimedReceiptIds.values().next().value
    if (oldest) claimedReceiptIds.delete(oldest)
  }
  claimedReceiptIds.add(receipt.receiptId)

  if (!hasSqlInsert(db)) return true

  try {
    const inserted = await db
      .insert(previewReceiptRedemptions)
      .values({
        receiptId: receipt.receiptId,
        tenantScope: tenantId ?? null,
        userId: receipt.userId,
        commandsHash: receipt.hash,
        redeemedAt: new Date().toISOString(),
      })
      .onConflictDoNothing()
      .returning({ receiptId: previewReceiptRedemptions.receiptId })
    return inserted.length === 1
  } catch (err) {
    // Not recorded durably: leave the receipt unclaimed so a retry can succeed.
    claimedReceiptIds.delete(receipt.receiptId)
    throw err
  }
}

/**
 * Verifies a receipt (see verifyPreviewReceipt) and claims it for a single
 * execution before anything runs. A receipt that passes is spent even if the
 * execution later fails; the caller must preview again.
 */
export async function redeemPreviewReceipt(options: {
  receiptId: string
  userId: string
  tenantId?: string
  kv?: KVNamespace
  db?: Database
  commandsToVerify?: CommandEnvelope[]
}): Promise<VerifyReceiptResult> {
  const verification = await verifyPreviewReceipt(options)
  if (!verification.valid || !verification.receipt) return verification

  let claimed: boolean
  try {
    claimed = await claimPreviewReceipt(verification.receipt, options.tenantId, options.db)
  } catch {
    return {
      valid: false,
      error: 'RECEIPT_CLAIM_FAILED',
      message: `Preview receipt '${options.receiptId}' could not be claimed; nothing was executed`,
    }
  }
  if (!claimed) {
    return {
      valid: false,
      error: 'RECEIPT_ALREADY_USED',
      message: `Preview receipt '${options.receiptId}' has already been executed (replay prevented)`,
    }
  }

  await markPreviewReceiptConsumed(options.receiptId, options.kv, options.tenantId)
  return verification
}
