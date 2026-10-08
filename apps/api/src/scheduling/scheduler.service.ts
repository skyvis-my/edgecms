/**
 * Scheduler Service
 *
 * Service wrapper for the CMS Worker to interact with the PublishScheduler
 * Durable Object. Provides high-level methods to schedule and cancel
 * publish/unpublish transitions.
 */

import type { Env } from '@/env'

/**
 * Notify the scheduler of a pending publish/unpublish transition.
 *
 * Adds the transition to the DO's queue, which will fire an alarm
 * at the scheduled time to execute the transition.
 *
 * @param env - Cloudflare Worker environment bindings
 * @param entryId - The entry ID to transition
 * @param transitionType - 'publish' or 'unpublish'
 * @param scheduledAt - ISO 8601 timestamp when transition should occur
 */
export async function notifySchedule(
  env: Env,
  entryId: string,
  transitionType: 'publish' | 'unpublish',
  scheduledAt: string,
  metadata?: {
    collectionSlug?: string
    locales?: string[]
    tenantScope?: string
  }
): Promise<void> {
  // Get the DO stub (singleton instance named 'default')
  const id = env.PUBLISH_SCHEDULER.idFromName('default')
  const stub = env.PUBLISH_SCHEDULER.get(id)

  // Call the DO's add endpoint
  await stub.fetch('http://internal/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      entryId,
      transitionType,
      scheduledAt,
      collectionSlug: metadata?.collectionSlug,
      locales: metadata?.locales,
      tenantScope: metadata?.tenantScope,
    }),
  })
}

/**
 * Cancel a scheduled publish/unpublish transition.
 *
 * Removes the transition from the DO's queue.
 *
 * @param env - Cloudflare Worker environment bindings
 * @param entryId - The entry ID
 * @param transitionType - 'publish' or 'unpublish'
 */
export async function cancelSchedule(
  env: Env,
  entryId: string,
  transitionType: 'publish' | 'unpublish'
): Promise<void> {
  // Get the DO stub (singleton instance named 'default')
  const id = env.PUBLISH_SCHEDULER.idFromName('default')
  const stub = env.PUBLISH_SCHEDULER.get(id)

  // Call the DO's remove endpoint
  await stub.fetch('http://internal/remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      entryId,
      transitionType,
    }),
  })
}

/**
 * Get the current pending transitions queue (for debugging/monitoring).
 *
 * @param env - Cloudflare Worker environment bindings
 * @returns Array of pending transitions
 */
export async function getQueue(env: Env): Promise<
  {
    entryId: string
    transitionType: 'publish' | 'unpublish'
    scheduledAt: string
  }[]
> {
  // Get the DO stub (singleton instance named 'default')
  const id = env.PUBLISH_SCHEDULER.idFromName('default')
  const stub = env.PUBLISH_SCHEDULER.get(id)

  // Call the DO's queue endpoint
  const response = await stub.fetch('http://internal/queue', {
    method: 'GET',
  })

  const data = (await response.json()) as {
    queue: {
      entryId: string
      transitionType: 'publish' | 'unpublish'
      scheduledAt: string
    }[]
  }

  return data.queue
}
