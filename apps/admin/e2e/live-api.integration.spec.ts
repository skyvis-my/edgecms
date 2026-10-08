import { expect, test } from '@playwright/test'
import { installSmokeGuards } from './smoke-guards'

installSmokeGuards()

test.skip(process.env.E2E_LIVE_API !== '1', 'Requires E2E_LIVE_API=1')

test('live api health is reachable via frontend proxy', async ({ page }) => {
  await page.goto('/')

  const health = await page.evaluate(async () => {
    const response = await fetch('/api/health')
    const body = (await response.json()) as { status?: string }

    return {
      ok: response.ok,
      statusCode: response.status,
      status: body.status,
    }
  })

  expect(health.ok).toBe(true)
  expect(health.statusCode).toBe(200)
  expect(health.status === 'ok' || health.status === 'degraded').toBe(true)
})
