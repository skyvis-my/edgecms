import { PublishScheduler, type PendingTransition } from '@/scheduling/publish-scheduler.do'
import type { Env } from '@/env'

type StorageValue = PendingTransition[] | unknown

/**
 * Minimal DurableObjectState for running PublishScheduler outside workerd.
 * Alarms are mapped to setTimeout; storage is in-memory (lost on restart —
 * schedule intents in D1/Postgres remain the source of truth for sweeps).
 */
function createMemoryDurableObjectState(): DurableObjectState {
  const map = new Map<string, StorageValue>()
  let alarmTimer: ReturnType<typeof setTimeout> | undefined
  let alarmHandler: (() => void | Promise<void>) | undefined

  const storage = {
    get: async <T>(key: string) => map.get(key) as T | undefined,
    put: async (key: string, value: StorageValue) => {
      map.set(key, value)
    },
    delete: async (key: string) => map.delete(key),
    list: async () => map,
    deleteAll: async () => map.clear(),
    setAlarm: async (scheduledTime: number | Date) => {
      const at = typeof scheduledTime === 'number' ? scheduledTime : scheduledTime.getTime()
      if (alarmTimer) clearTimeout(alarmTimer)
      const delay = Math.max(0, at - Date.now())
      alarmTimer = setTimeout(() => {
        void alarmHandler?.()
      }, delay)
    },
    deleteAlarm: async () => {
      if (alarmTimer) clearTimeout(alarmTimer)
      alarmTimer = undefined
    },
    getAlarm: async () => null,
    sync: async () => undefined,
    transaction: async (fn: (txn: unknown) => Promise<void>) => fn(storage),
  }

  const state = {
    id: { toString: () => 'default', equals: () => true, name: 'default' },
    storage,
    waitUntil: (promise: Promise<unknown>) => {
      void promise.catch(() => undefined)
    },
    blockConcurrencyWhile: async <T>(fn: () => Promise<T>) => fn(),
    acceptWebSocket: () => {
      throw new Error('WebSocket not supported on in-process scheduler')
    },
    getWebSockets: () => [],
    setWebSocketAutoResponse: () => undefined,
    getTags: () => [],
  } as unknown as DurableObjectState & {
    __setAlarmHandler: (fn: () => void | Promise<void>) => void
  }

  ;(state as { __setAlarmHandler: (fn: () => void | Promise<void>) => void }).__setAlarmHandler = (
    fn
  ) => {
    alarmHandler = fn
  }

  return state
}

/**
 * In-process DurableObjectNamespace wrapping the real PublishScheduler class.
 */
export function createInProcessPublishScheduler(getEnv: () => Env): DurableObjectNamespace {
  let scheduler: PublishScheduler | null = null
  let state: ReturnType<typeof createMemoryDurableObjectState> | null = null

  const ensure = () => {
    if (!scheduler) {
      state = createMemoryDurableObjectState()
      scheduler = new PublishScheduler(state, getEnv())
      ;(
        state as unknown as { __setAlarmHandler: (fn: () => void | Promise<void>) => void }
      ).__setAlarmHandler(() => scheduler!.alarm())
    }
    return scheduler
  }

  const id = {
    toString: () => 'default',
    equals: () => true,
    name: 'default',
  }

  return {
    idFromName: () => id,
    idFromString: () => id,
    newUniqueId: () => id,
    get: () => ({
      id,
      fetch: (input: RequestInfo | URL, init?: RequestInit) => {
        const request =
          input instanceof Request ? input : new Request(String(input), init)
        return ensure().fetch(request)
      },
    }),
    jurisdiction: () => {
      throw new Error('jurisdiction() is not available on the in-process scheduler')
    },
  } as unknown as DurableObjectNamespace
}
