import { expect, test } from '@playwright/test'
import { installSmokeGuards } from './smoke-guards'

installSmokeGuards()

test.skip(process.env.E2E_LIVE_PERSISTED !== '1', 'Requires E2E_LIVE_PERSISTED=1')

function getEnvOrDefault(name: string, fallback: string) {
  return process.env[name] || fallback
}

test('live persisted smoke: first publish, public API read, and media upload work', async ({ page }) => {
  const email = getEnvOrDefault('E2E_ADMIN_EMAIL', 'smoke.admin@example.com')
  const password = getEnvOrDefault('E2E_ADMIN_PASSWORD', 'SmokePassw0rd!')
  const tenantSlug = getEnvOrDefault('E2E_TENANT_SLUG', 'smoke')
  const collectionSlug = getEnvOrDefault('E2E_COLLECTION_SLUG', 'smoke-posts')
  const runId = `smoke-${Date.now()}`
  const title = `Smoke ${runId}`

  await page.goto('/sign-in')
  await page.getByRole('textbox', { name: 'Email' }).fill(email)
  const passwordInput = page.getByRole('textbox', { name: 'Password' })
  await passwordInput.fill(password)
  await passwordInput.press('Enter')
  await expect(page).not.toHaveURL(/\/sign-in/)

  const result = await page.evaluate(
    async ({ collectionSlug, runId, tenantSlug, title }) => {
      const getCsrfToken = async () => {
        const response = await fetch('/api/csrf', { credentials: 'include' })
        const payload = (await response.json()) as { success?: boolean; data?: { csrfToken?: string } }
        return payload.data?.csrfToken
      }

      const csrfToken = await getCsrfToken()
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        'x-tenant': tenantSlug,
      }
      if (csrfToken) headers['x-csrf-token'] = csrfToken

      const api = async <T>(path: string, init: RequestInit = {}) => {
        const response = await fetch(`/api/tenants/${tenantSlug}${path}`, {
          credentials: 'include',
          ...init,
          headers: {
            ...headers,
            ...(init.headers as Record<string, string> | undefined),
          },
        })
        const body = (await response.json().catch(() => null)) as T
        if (!response.ok) {
          throw new Error(`${init.method ?? 'GET'} ${path} failed ${response.status}: ${JSON.stringify(body)}`)
        }
        return body
      }

      const collectionResponse = await api<{ data?: { id?: string; slug?: string }; id?: string; slug?: string }>(
        `/admin/collections/${collectionSlug}`
      )
      const collection = collectionResponse.data ?? collectionResponse
      if (!collection.id || !collection.slug) {
        throw new Error(`Collection lookup did not return id/slug: ${JSON.stringify(collectionResponse)}`)
      }
      const createResponse = await api<{
        data?: { data?: { id?: string; slug?: string }; id?: string; slug?: string }
        id?: string
        slug?: string
      }>(
        '/admin/commands',
        {
          method: 'POST',
          body: JSON.stringify({
            type: 'createEntry',
            payload: {
              collectionId: collection.id,
              slug: runId,
              data: { title },
              status: 'draft',
            },
            actor: { source: 'admin', userId: 'smoke-live' },
            timestamp: new Date().toISOString(),
          }),
        }
      )
      const entryId = createResponse.data?.data?.id ?? createResponse.data?.id ?? createResponse.id
      if (!entryId) throw new Error(`Create entry did not return an entry id: ${JSON.stringify(createResponse)}`)

      await api('/admin/commands', {
        method: 'POST',
        body: JSON.stringify({
          type: 'publishNow',
          payload: { entryId },
          actor: { source: 'admin', userId: 'smoke-live' },
          timestamp: new Date().toISOString(),
        }),
      })

      const publicResponse = await fetch(`/api/tenants/${tenantSlug}/api/public/${collection.slug}/${runId}`, {
        credentials: 'include',
      })
      const publicBody = (await publicResponse.json().catch(() => null)) as unknown
      if (!publicResponse.ok) {
        throw new Error(`Public API read failed ${publicResponse.status}: ${JSON.stringify(publicBody)}`)
      }

      const form = new FormData()
      form.set('file', new File(['edgecms smoke'], `${runId}.txt`, { type: 'text/plain' }))
      const mediaHeaders: Record<string, string> = { 'x-tenant': tenantSlug }
      if (csrfToken) mediaHeaders['x-csrf-token'] = csrfToken
      const mediaResponse = await fetch(`/api/tenants/${tenantSlug}/admin/assets/upload`, {
        method: 'POST',
        credentials: 'include',
        headers: mediaHeaders,
        body: form,
      })
      const mediaBody = (await mediaResponse.json().catch(() => null)) as unknown
      if (!mediaResponse.ok) {
        throw new Error(`Media upload failed ${mediaResponse.status}: ${JSON.stringify(mediaBody)}`)
      }

      return {
        entryId,
        publicBody,
        mediaBody,
      }
    },
    { collectionSlug, runId, tenantSlug, title }
  )

  expect(result.entryId).toBeTruthy()
  expect(JSON.stringify(result.publicBody)).toContain(title)
  expect(JSON.stringify(result.mediaBody)).toContain(runId)
})
