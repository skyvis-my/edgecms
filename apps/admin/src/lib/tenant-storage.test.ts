import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import {
  ACTIVE_TENANT_STORAGE_KEY,
  TENANT_SWITCH_EVENT,
  getCurrentTenantSlug,
  setCurrentTenantSlug,
} from './tenant-storage'

describe('tenant-storage', () => {
  let dispatchedEvents: CustomEvent[] = []
  const originalDispatchEvent = globalThis.window?.dispatchEvent

  beforeEach(() => {
    // Ensure localStorage is available (bun:test has it)
    localStorage.clear()
    dispatchedEvents = []

    // Spy on window.dispatchEvent
    if (typeof window !== 'undefined') {
      window.dispatchEvent = ((event: Event) => {
        if (event instanceof CustomEvent) {
          dispatchedEvents.push(event)
        }
        return true
      }) as typeof window.dispatchEvent
    }
  })

  afterEach(() => {
    localStorage.clear()
    if (typeof window !== 'undefined' && originalDispatchEvent) {
      window.dispatchEvent = originalDispatchEvent
    }
  })

  describe('exported constants', () => {
    it('exports the correct storage key', () => {
      expect(ACTIVE_TENANT_STORAGE_KEY).toBe('edgecms:active-tenant')
    })

    it('exports the correct event name', () => {
      expect(TENANT_SWITCH_EVENT).toBe('edgecms:tenant-switch')
    })
  })

  describe('getCurrentTenantSlug', () => {
    it('returns null when no tenant is stored', () => {
      expect(getCurrentTenantSlug()).toBeNull()
    })

    it('returns the stored tenant slug', () => {
      localStorage.setItem(ACTIVE_TENANT_STORAGE_KEY, 'my-tenant')
      expect(getCurrentTenantSlug()).toBe('my-tenant')
    })

    it('returns the exact value from localStorage', () => {
      localStorage.setItem(ACTIVE_TENANT_STORAGE_KEY, 'tenant-with-special-chars-123')
      expect(getCurrentTenantSlug()).toBe('tenant-with-special-chars-123')
    })
  })

  describe('setCurrentTenantSlug', () => {
    it('stores a tenant slug in localStorage', () => {
      setCurrentTenantSlug('new-tenant')
      expect(localStorage.getItem(ACTIVE_TENANT_STORAGE_KEY)).toBe('new-tenant')
    })

    it('removes the tenant slug from localStorage when set to null', () => {
      localStorage.setItem(ACTIVE_TENANT_STORAGE_KEY, 'old-tenant')
      setCurrentTenantSlug(null)
      expect(localStorage.getItem(ACTIVE_TENANT_STORAGE_KEY)).toBeNull()
    })

    it('overwrites the existing tenant slug', () => {
      setCurrentTenantSlug('first-tenant')
      setCurrentTenantSlug('second-tenant')
      expect(localStorage.getItem(ACTIVE_TENANT_STORAGE_KEY)).toBe('second-tenant')
    })

    it('dispatches a custom event with the slug detail', () => {
      setCurrentTenantSlug('event-tenant')
      expect(dispatchedEvents.length).toBe(1)
      expect(dispatchedEvents[0].type).toBe(TENANT_SWITCH_EVENT)
      expect(dispatchedEvents[0].detail).toEqual({ slug: 'event-tenant' })
    })

    it('dispatches an event with null slug when clearing', () => {
      setCurrentTenantSlug(null)
      expect(dispatchedEvents.length).toBe(1)
      expect(dispatchedEvents[0].detail).toEqual({ slug: null })
    })

    it('dispatches an event each time it is called', () => {
      setCurrentTenantSlug('tenant-a')
      setCurrentTenantSlug('tenant-b')
      setCurrentTenantSlug(null)
      expect(dispatchedEvents.length).toBe(3)
    })
  })

  describe('getCurrentTenantSlug and setCurrentTenantSlug integration', () => {
    it('returns the slug that was just set', () => {
      setCurrentTenantSlug('round-trip')
      expect(getCurrentTenantSlug()).toBe('round-trip')
    })

    it('returns null after clearing the slug', () => {
      setCurrentTenantSlug('temporary')
      setCurrentTenantSlug(null)
      expect(getCurrentTenantSlug()).toBeNull()
    })
  })
})
