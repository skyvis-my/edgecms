import type { Env } from '@/env'
import { logger } from '@/observability/logger'

const CF_API_BASE = 'https://api.cloudflare.com/client/v4'

export interface CdnPurgeResult {
  success: boolean
  tagsPurged: string[]
  error?: string
}

export interface RevalidationDispatchResult {
  success: boolean
  url?: string
  status?: number
  error?: string
}

async function generateHmacSha256(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Service for triggering on-demand CDN cache invalidation and frontend revalidation.
 */
export const cdnPurgeService = {
  /**
   * Purge Cloudflare CDN edge cache by Cache-Tags using Cloudflare API v4.
   *
   * @param env - Cloudflare Worker environment bindings
   * @param tags - Array of Cache-Tags to purge (e.g. ['collection:posts', 'entry:post-1'])
   * @param fetchImpl - Optional fetch implementation for testing
   */
  async purgeCloudflareCacheTags(
    env: Partial<Env> | undefined,
    tags: string[],
    fetchImpl: typeof fetch = fetch
  ): Promise<CdnPurgeResult> {
    if (!tags || tags.length === 0) {
      return { success: true, tagsPurged: [] }
    }

    const apiToken = env?.CF_API_TOKEN
    const zoneId = env?.CLOUDFLARE_ZONE_ID

    if (!apiToken || !zoneId) {
      logger.debug('cloudflare_cdn_purge_skipped', {
        reason: 'Missing CF_API_TOKEN or CLOUDFLARE_ZONE_ID',
        tagsCount: tags.length,
      })
      return {
        success: true,
        tagsPurged: tags,
      }
    }

    try {
      const response = await fetchImpl(`${CF_API_BASE}/zones/${zoneId}/purge_cache`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tags }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        logger.error('cloudflare_cdn_purge_failed', {
          status: response.status,
          error: errorText,
          tags,
        })
        return {
          success: false,
          tagsPurged: [],
          error: `Cloudflare API returned status ${response.status}: ${errorText}`,
        }
      }

      logger.info('cloudflare_cdn_purge_success', {
        tagsCount: tags.length,
        tags,
      })

      return {
        success: true,
        tagsPurged: tags,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error('cloudflare_cdn_purge_exception', { error: message, tags })
      return {
        success: false,
        tagsPurged: [],
        error: message,
      }
    }
  },

  /**
   * Dispatch an on-demand revalidation webhook directly to a frontend framework
   * (Next.js / Astro ISR endpoint).
   *
   * @param revalidateUrl - Target revalidation webhook URL
   * @param payload - Payload containing tags, paths, and event info
   * @param secret - Optional revalidation secret token (sent via Bearer, header token, and HMAC SHA-256)
   * @param fetchImpl - Optional fetch implementation for testing
   */
  async dispatchFrontendRevalidation(
    revalidateUrl: string | undefined,
    payload: {
      event: string
      tags: string[]
      paths?: string[]
      entryId?: string
      collectionSlug?: string
    },
    secret?: string,
    fetchImpl: typeof fetch = fetch
  ): Promise<RevalidationDispatchResult> {
    if (!revalidateUrl) {
      return { success: true }
    }

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'EdgeCMS-Revalidate/1.0',
      }

      const bodyString = JSON.stringify(payload)

      if (secret) {
        headers['Authorization'] = `Bearer ${secret}`
        headers['x-revalidate-token'] = secret
        const hexSig = await generateHmacSha256(bodyString, secret)
        headers['x-edgecms-signature'] = `sha256=${hexSig}`
        headers['x-hub-signature-256'] = `sha256=${hexSig}`
      }

      const response = await fetchImpl(revalidateUrl, {
        method: 'POST',
        headers,
        body: bodyString,
      })

      if (!response.ok) {
        const errorText = await response.text()
        logger.warn('frontend_revalidation_webhook_failed', {
          url: revalidateUrl,
          status: response.status,
          error: errorText,
        })
        return {
          success: false,
          url: revalidateUrl,
          status: response.status,
          error: errorText,
        }
      }

      logger.info('frontend_revalidation_webhook_success', {
        url: revalidateUrl,
        status: response.status,
      })

      return {
        success: true,
        url: revalidateUrl,
        status: response.status,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error('frontend_revalidation_webhook_error', {
        url: revalidateUrl,
        error: message,
      })
      return {
        success: false,
        url: revalidateUrl,
        error: message,
      }
    }
  },
}
