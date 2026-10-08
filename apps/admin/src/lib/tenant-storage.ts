const ACTIVE_TENANT_STORAGE_KEY = 'edgecms:active-tenant'
const TENANT_SWITCH_EVENT = 'edgecms:tenant-switch'

function getStorage(): Storage | null {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage
    }
  } catch {
    // Access denied or not available
  }
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage
    }
  } catch {
    // Access denied or not available
  }
  return null
}

export function getCurrentTenantSlug(): string | null {
  const storage = getStorage()
  if (!storage) return null
  try {
    return storage.getItem(ACTIVE_TENANT_STORAGE_KEY)
  } catch {
    return null
  }
}

export function setCurrentTenantSlug(slug: string | null) {
  const storage = getStorage()
  if (storage) {
    try {
      if (slug) {
        storage.setItem(ACTIVE_TENANT_STORAGE_KEY, slug)
      } else {
        storage.removeItem(ACTIVE_TENANT_STORAGE_KEY)
      }
    } catch {
      // Storage write failed
    }
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(TENANT_SWITCH_EVENT, { detail: { slug } }))
  }
}

export { ACTIVE_TENANT_STORAGE_KEY, TENANT_SWITCH_EVENT }
