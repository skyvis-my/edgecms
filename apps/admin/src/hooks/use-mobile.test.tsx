import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { act, renderHook } from '@testing-library/react'
import { useIsMobile } from './use-mobile'

type Listener = () => void

describe('useIsMobile', () => {
  let listeners: Listener[] = []
  let isMobile = false
  const originalMatchMedia = window.matchMedia

  beforeEach(() => {
    listeners = []
    isMobile = false

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: () => {
        return {
          matches: isMobile,
          media: '(max-width: 767px)',
          onchange: null,
          addEventListener: (_event: string, cb: Listener) => {
            listeners.push(cb)
          },
          removeEventListener: (_event: string, cb: Listener) => {
            listeners = listeners.filter((listener) => listener !== cb)
          },
          addListener: vi.fn(),
          removeListener: vi.fn(),
          dispatchEvent: vi.fn(),
        } as unknown as MediaQueryList
      },
    })
  })

  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: originalMatchMedia,
    })
  })

  it('returns initial desktop value', () => {
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)
  })

  it('updates when media query changes', () => {
    const { result } = renderHook(() => useIsMobile())

    act(() => {
      isMobile = true
      for (const listener of listeners) {
        listener()
      }
    })

    expect(result.current).toBe(true)
  })
})
