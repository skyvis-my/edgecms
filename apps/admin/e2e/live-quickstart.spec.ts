import { expect, test } from '@playwright/test'

// Quickstart proof: the smoke-seeded admin signs in and opens the seeded collection's entry list.
test.skip(process.env.E2E_LIVE_PERSISTED !== '1', 'Requires E2E_LIVE_PERSISTED=1')

function getEnvOrDefault(name: string, fallback: string) {
  return process.env[name] || fallback
}

test('live quickstart: smoke admin signs in and opens the entry list by slug', async ({ page }) => {
  const email = getEnvOrDefault('E2E_ADMIN_EMAIL', 'smoke.admin@example.com')
  const password = getEnvOrDefault('E2E_ADMIN_PASSWORD', 'SmokePassw0rd!')
  const tenantSlug = getEnvOrDefault('E2E_TENANT_SLUG', 'smoke')
  const collectionSlug = getEnvOrDefault('E2E_COLLECTION_SLUG', 'smoke-posts')

  await page.goto('/sign-in')
  await page.getByRole('textbox', { name: 'Email' }).fill(email)
  const passwordInput = page.getByRole('textbox', { name: 'Password' })
  await passwordInput.fill(password)
  const signIn = page.waitForResponse((response) =>
    response.url().includes('/api/auth/sign-in/email')
  )
  await passwordInput.press('Enter')
  expect((await signIn).status()).toBe(200)
  await expect(page).not.toHaveURL(/\/sign-in/)

  const entriesList = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/tenants/${tenantSlug}/admin/entries?`) &&
      response.request().method() === 'GET'
  )
  await page.goto(`/tenants/${tenantSlug}/collections/${collectionSlug}/entries`)
  expect((await entriesList).status()).toBe(200)
  await expect(page.getByRole('table')).toBeVisible()
})
