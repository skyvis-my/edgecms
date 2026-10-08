import { logger } from '@/observability/logger'

export type SyncEvent = {
  type: 'change'
  timestamp: string
}

const DEFAULT_SYNC_CHANNEL = 'global'
const WILDCARD_SYNC_CHANNEL = '*'

type SyncEventListener = (event: SyncEvent) => void

const channelListeners = new Map<string, Set<SyncEventListener>>()

function getChannelListeners(channel: string): Set<SyncEventListener> {
  const listeners = channelListeners.get(channel)
  if (listeners) return listeners

  const next = new Set<SyncEventListener>()
  channelListeners.set(channel, next)
  return next
}

export function subscribeSyncEvents(
  listener: SyncEventListener,
  channel: string = DEFAULT_SYNC_CHANNEL
): () => void {
  const listeners = getChannelListeners(channel)
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      channelListeners.delete(channel)
    }
  }
}

export function publishSyncEvent(event: SyncEvent, channel: string = DEFAULT_SYNC_CHANNEL): void {
  const targets = new Set<SyncEventListener>()
  const scopedListeners = channelListeners.get(channel)
  const wildcardListeners = channelListeners.get(WILDCARD_SYNC_CHANNEL)

  if (scopedListeners) {
    for (const listener of scopedListeners) targets.add(listener)
  }
  if (wildcardListeners && channel !== WILDCARD_SYNC_CHANNEL) {
    for (const listener of wildcardListeners) targets.add(listener)
  }
  if (targets.size === 0) return

  for (const listener of targets) {
    try {
      listener(event)
    } catch (err) {
      logger.error('sync_event_listener_failed', { error: err instanceof Error ? err.message : String(err) })
    }
  }
}
