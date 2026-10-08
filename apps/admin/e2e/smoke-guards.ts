import { expect, type Page, test } from '@playwright/test'

const ignoredConsoleFragments = [
  'Download the React DevTools',
  'Failed to load resource: net::ERR_INTERNET_DISCONNECTED',
  'Failed to load resource: net::ERR_CONNECTION_CLOSED',
  'ResizeObserver loop completed with undelivered notifications',
]

const pageFailures = new WeakMap<Page, string[]>()

export const installSmokeGuards = () => {
  test.beforeEach(async ({ page }) => {
    const failures: string[] = []
    pageFailures.set(page, failures)

    page.on('pageerror', (error) => {
      failures.push(`pageerror: ${error.message}`)
    })

    page.on('console', (message) => {
      if (message.type() !== 'error') return

      const text = message.text()
      if (ignoredConsoleFragments.some((fragment) => text.includes(fragment))) return

      failures.push(`console error: ${text}`)
    })
  })

  test.afterEach(async ({ page }) => {
    const visibleError = page.getByText(/Oops! Something went wrong|(?:^|\b)(500|503)(?:\b|$)/i).first()
    await expect(visibleError).toBeHidden({ timeout: 500 })

    const failures = pageFailures.get(page) ?? []
    expect(failures, failures.join('\n')).toEqual([])
  })
}
