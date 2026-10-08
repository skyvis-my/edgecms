import { create } from 'zustand'
import { getCurrentTenantSlug, setCurrentTenantSlug } from '@/lib/tenant-storage'

type TenantStoreState = {
  tenantSlug: string | null
  setTenantSlug: (tenantSlug: string | null) => void
}

export const useTenantStore = create<TenantStoreState>((set) => ({
  tenantSlug: getCurrentTenantSlug(),
  setTenantSlug: (tenantSlug) => {
    setCurrentTenantSlug(tenantSlug)
    set({ tenantSlug })
  },
}))
