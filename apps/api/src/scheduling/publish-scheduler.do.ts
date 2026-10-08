/**
 * Publish Scheduler Durable Object
 *
 * Implements alarm-based exact-time publish/unpublish transitions.
 * Maintains a sorted queue of pending transitions and uses Durable Object alarms
 * to fire at precise timestamps rather than polling with cron.
 */

import { drizzle } from 'drizzle-orm/d1'
import { executeCommand } from '@/commands/engine'
import type { Env } from '@/env'
import { kvService } from '@/cache/kv.service'
import { logger } from '@/observability/logger'

/**
 * A single pending transition in the queue.
 */
export type PendingTransition = {
  entryId: string
  transitionType: 'publish' | 'unpublish'
  scheduledAt: string // ISO 8601 timestamp
  collectionSlug?: string
  locales?: string[]
  tenantScope?: string
}

/**
 * Storage key for the pending transitions queue in DO storage.
 */
const QUEUE_STORAGE_KEY = 'pending_transitions'

/**
 * PublishScheduler Durable Object
 *
 * Manages a sorted queue of pending publish/unpublish transitions.
 * Uses DO alarms to process transitions at their exact scheduled time.
 */
export class PublishScheduler {
  constructor(
    private state: DurableObjectState,
    private env: Env
  ) {}

  /**
   * Get the current pending transitions queue from storage.
   */
  private async getQueue(): Promise<PendingTransition[]> {
    const queue = await this.state.storage.get<PendingTransition[]>(QUEUE_STORAGE_KEY)
    return queue || []
  }

  /**
   * Save the pending transitions queue to storage.
   */
  private async saveQueue(queue: PendingTransition[]): Promise<void> {
    await this.state.storage.put(QUEUE_STORAGE_KEY, queue)
  }

  /**
   * Sort the queue by scheduledAt timestamp (earliest first).
   */
  private sortQueue(queue: PendingTransition[]): PendingTransition[] {
    return queue.sort((a, b) => {
      const timeA = new Date(a.scheduledAt).getTime()
      const timeB = new Date(b.scheduledAt).getTime()
      return timeA - timeB
    })
  }

  /**
   * Schedule the next alarm for the earliest pending transition.
   * If the queue is empty, deletes any existing alarm.
   */
  private async scheduleNextAlarm(queue: PendingTransition[]): Promise<void> {
    if (queue.length === 0) {
      // No pending transitions, delete alarm
      await this.state.storage.deleteAlarm()
      return
    }

    // Get the earliest pending transition
    const earliest = queue[0]
    if (!earliest) {
      return
    }

    const scheduledTime = new Date(earliest.scheduledAt).getTime()

    // Set alarm for the scheduled time
    await this.state.storage.setAlarm(scheduledTime)
  }

  /**
   * Add a pending transition to the queue.
   * Re-schedules the alarm if this transition is the new earliest.
   *
   * @param entryId - The entry ID to transition
   * @param transitionType - 'publish' or 'unpublish'
   * @param scheduledAt - ISO 8601 timestamp when transition should occur
   */
  async addPendingTransition(
    entryId: string,
    transitionType: 'publish' | 'unpublish',
    scheduledAt: string,
    metadata?: { collectionSlug?: string; locales?: string[]; tenantScope?: string }
  ): Promise<void> {
    const queue = await this.getQueue()

    // Remove any existing transition for this entry+type (replace behavior)
    const filteredQueue = queue.filter(
      (t) => !(t.entryId === entryId && t.transitionType === transitionType)
    )

    // Add the new transition
    filteredQueue.push({
      entryId,
      transitionType,
      scheduledAt,
      collectionSlug: metadata?.collectionSlug,
      locales: metadata?.locales,
      tenantScope: metadata?.tenantScope,
    })

    // Sort by scheduled time
    const sortedQueue = this.sortQueue(filteredQueue)

    // Save the updated queue
    await this.saveQueue(sortedQueue)

    // Re-schedule alarm for the earliest pending transition
    await this.scheduleNextAlarm(sortedQueue)
  }

  /**
   * Remove a pending transition from the queue.
   * Used when a scheduled transition is cancelled.
   *
   * @param entryId - The entry ID
   * @param transitionType - 'publish' or 'unpublish'
   */
  async removePendingTransition(
    entryId: string,
    transitionType: 'publish' | 'unpublish'
  ): Promise<void> {
    const queue = await this.getQueue()

    // Filter out the matching transition
    const filteredQueue = queue.filter(
      (t) => !(t.entryId === entryId && t.transitionType === transitionType)
    )

    // Save the updated queue
    await this.saveQueue(filteredQueue)

    // Re-schedule alarm for the new earliest pending transition
    await this.scheduleNextAlarm(filteredQueue)
  }

  /**
   * Alarm handler - fires when a scheduled transition is due.
   *
   * Processes all due transitions (where scheduledAt <= now),
   * then chains the alarm for the next pending transition.
   */
  async alarm(): Promise<void> {
    const now = new Date()
    const queue = await this.getQueue()

    // Find all due transitions (scheduledAt <= now)
    const dueTransitions: PendingTransition[] = []
    const remainingTransitions: PendingTransition[] = []

    for (const transition of queue) {
      const scheduledTime = new Date(transition.scheduledAt)
      if (scheduledTime <= now) {
        dueTransitions.push(transition)
      } else {
        remainingTransitions.push(transition)
      }
    }

    // Process each due transition
    for (const transition of dueTransitions) {
      try {
        await this.executeTransition(transition)
      } catch (err) {
        // Log error but continue processing other transitions
        logger.error('scheduler_transition_failed', {
          transitionType: transition.transitionType,
          entryId: transition.entryId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    // Save the remaining queue (without processed transitions)
    await this.saveQueue(remainingTransitions)

    // Chain alarm for the next pending transition
    await this.scheduleNextAlarm(remainingTransitions)
  }

  /**
   * Execute a single transition via the command engine.
   */
  private async executeTransition(transition: PendingTransition): Promise<void> {
    const db = drizzle(this.env.DB)

    // Build the command based on transition type
    const commandType = transition.transitionType === 'publish' ? 'publishNow' : 'unpublishNow'

    // Execute the command via the command engine
    await executeCommand(
      {
        db,
        actor: {
          userId: 'system',
          source: 'scheduler' as const,
        },
        kv: this.env.CACHE,
      },
      {
        type: commandType,
        payload: {
          entryId: transition.entryId,
        },
        actor: {
          userId: 'system',
          source: 'scheduler',
        },
        timestamp: new Date().toISOString(),
      }
    )

    if (transition.collectionSlug) {
      const locales = transition.locales && transition.locales.length > 0 ? transition.locales : ['en']
      for (const locale of locales) {
        await kvService.incrementVersion(
          this.env.CACHE,
          transition.collectionSlug,
          locale,
          transition.tenantScope
        )
      }
    }
  }

  /**
   * Fetch handler for HTTP requests to the DO.
   * Used by the scheduler service to add/remove transitions.
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/add' && request.method === 'POST') {
      const body = (await request.json()) as {
        entryId: string
        transitionType: 'publish' | 'unpublish'
        scheduledAt: string
        collectionSlug?: string
        locales?: string[]
        tenantScope?: string
      }

      await this.addPendingTransition(body.entryId, body.transitionType, body.scheduledAt, {
        collectionSlug: body.collectionSlug,
        locales: body.locales,
        tenantScope: body.tenantScope,
      })

      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname === '/remove' && request.method === 'POST') {
      const body = (await request.json()) as {
        entryId: string
        transitionType: 'publish' | 'unpublish'
      }

      await this.removePendingTransition(body.entryId, body.transitionType)

      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname === '/queue' && request.method === 'GET') {
      const queue = await this.getQueue()

      return new Response(JSON.stringify({ queue }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response('Not Found', { status: 404 })
  }
}
