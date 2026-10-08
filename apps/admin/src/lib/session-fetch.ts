type SessionShape = {
  expiresAt?: string | number | Date | null
} & Record<string, unknown>

export type SessionDataShape = {
  user: Record<string, unknown>
  session: SessionShape
}

type SessionResult = {
  data: SessionDataShape | null
  error: unknown
}

let inMemorySessionCache: SessionDataShape | null = null

function isSessionDataShape(value: unknown): value is SessionDataShape {
  if (!value || typeof value !== 'object') return false
  if (!('session' in value) || !('user' in value)) return false

  const candidate = value as { session?: unknown; user?: unknown }
  return (
    candidate.session !== null &&
    typeof candidate.session === 'object' &&
    candidate.user !== null &&
    typeof candidate.user === 'object'
  )
}

function toEpochMs(value: SessionShape['expiresAt']): number | null {
  if (!value) return null

  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.getTime() : null
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

function isExpired(session: SessionDataShape, now = Date.now()) {
  const expiresAtMs = toEpochMs(session.session.expiresAt)
  if (expiresAtMs === null) {
    return true
  }
  return expiresAtMs <= now
}

export function readCachedSession(): SessionDataShape | null {
  return inMemorySessionCache
}

export function writeCachedSession(session: SessionDataShape) {
  inMemorySessionCache = session
}

export function clearCachedSession() {
  inMemorySessionCache = null
}

export async function getSessionWithLocalCache(
  fetchSession: () => Promise<SessionResult>,
  options?: { forceRefresh?: boolean }
): Promise<SessionResult> {
  const forceRefresh = options?.forceRefresh ?? false

  if (!forceRefresh) {
    const cached = readCachedSession()
    if (cached && !isExpired(cached)) {
      return { data: cached, error: null }
    }
  }

  const result = await fetchSession()
  const normalizedSession = isSessionDataShape(result.data) ? result.data : null

  if (normalizedSession && !isExpired(normalizedSession)) {
    writeCachedSession(normalizedSession)
  } else {
    clearCachedSession()
  }

  return { ...result, data: normalizedSession }
}
