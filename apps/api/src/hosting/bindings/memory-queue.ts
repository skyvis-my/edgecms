import type { WebhookQueueMessage } from '@/webhooks/queue-producer'
import { handleQueue } from '@/webhooks/queue-consumer'
import type { Env } from '@/env'

type QueueMessage<T> = {
  id: string
  body: T
  attempts: number
  ack: () => void
  retry: () => void
}

/**
 * In-process Cloudflare Queue stand-in. Delivers asynchronously via queueMicrotask.
 */
export function createMemoryWebhookQueue(getEnv: () => Env): Queue<WebhookQueueMessage> {
  let seq = 0
  const pending: WebhookQueueMessage[] = []
  let draining = false

  async function drain() {
    if (draining) return
    draining = true
    try {
      while (pending.length > 0) {
        const batchBody = pending.splice(0, 10)
        const messages: QueueMessage<WebhookQueueMessage>[] = batchBody.map((body) => {
          const id = `mem-${++seq}`
          return {
            id,
            body,
            attempts: 1,
            ack: () => undefined,
            retry: () => {
              pending.push(body)
            },
          }
        })
        const batch = {
          queue: 'edgecms-webhook-queue-local',
          messages,
          retryAll: () => {
            for (const m of batchBody) pending.push(m)
          },
          ackAll: () => undefined,
        } as unknown as MessageBatch<WebhookQueueMessage>
        await handleQueue(batch, getEnv())
      }
    } finally {
      draining = false
      if (pending.length > 0) queueMicrotask(() => void drain())
    }
  }

  return {
    send: async (body: WebhookQueueMessage) => {
      pending.push(body)
      queueMicrotask(() => void drain())
    },
    sendBatch: async (messages: Array<{ body: WebhookQueueMessage }>) => {
      for (const m of messages) pending.push(m.body)
      queueMicrotask(() => void drain())
    },
  } as unknown as Queue<WebhookQueueMessage>
}
