import { describe, expect, it, vi } from 'bun:test'
import { enableNavigationViewTransitions } from './navigation-transitions'

type MockRouter = {
  navigate: (...args: [{ to: string; viewTransition?: boolean }]) => Promise<void> | void
}

describe('enableNavigationViewTransitions', () => {
  it('wraps router navigation with startViewTransition when available', async () => {
    const navigate = vi.fn(async () => {})
    const startViewTransition = vi.fn((update: () => void | Promise<void>) => ({
      finished: Promise.resolve(update()),
    }))

    const router: MockRouter = { navigate }
    const documentWithTransitions = { startViewTransition } as Document

    const enabled = enableNavigationViewTransitions(router, documentWithTransitions)
    await router.navigate({ to: '/users' })

    expect(enabled).toBeTrue()
    expect(startViewTransition).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith({ to: '/users' })
  })

  it('does not wrap when startViewTransition is unavailable', () => {
    const navigate = vi.fn(async () => {})
    const router: MockRouter = { navigate }
    const enabled = enableNavigationViewTransitions(router, {} as Document)

    router.navigate({ to: '/users' })

    expect(enabled).toBeFalse()
    expect(navigate).toHaveBeenCalledTimes(1)
  })

  it('supports per-navigation opt out', async () => {
    const navigate = vi.fn(async () => {})
    const startViewTransition = vi.fn((update: () => void | Promise<void>) => ({
      finished: Promise.resolve(update()),
    }))

    const router: MockRouter = { navigate }
    const documentWithTransitions = { startViewTransition } as Document

    enableNavigationViewTransitions(router, documentWithTransitions)
    await router.navigate({ to: '/users', viewTransition: false })

    expect(startViewTransition).not.toHaveBeenCalled()
    expect(navigate).toHaveBeenCalledWith({ to: '/users', viewTransition: false })
  })
})
