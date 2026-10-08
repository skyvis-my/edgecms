import { describe, expect, it, vi } from 'bun:test'
import { getBootstrapStatus } from './bootstrap'

describe('getBootstrapStatus', () => {
  it('returns onboarding required when API reports zero users', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ needsOnboarding: true, userCount: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    )

    await expect(getBootstrapStatus(fetchMock as typeof fetch)).resolves.toEqual({
      needsOnboarding: true,
      userCount: 0,
    })
  })

  it('falls back to onboarding required when request fails', async () => {
    const fetchMock = vi.fn(async () => new Response('boom', { status: 500 }))

    await expect(getBootstrapStatus(fetchMock as typeof fetch)).resolves.toEqual({
      needsOnboarding: true,
      userCount: 0,
    })
  })
})
