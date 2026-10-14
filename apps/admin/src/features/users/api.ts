import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { edenGet } from '@/lib/eden-client'
import { userListSchema } from './data/schema'

const usersQuerySchema = z.object({
  users: userListSchema,
})

export const usersKeys = {
  all: ['users'] as const,
  byTenant: (tenantSlug?: string) => ['users', tenantSlug ?? 'global'] as const,
}

export function useUsers(tenantSlug?: string) {
  return useQuery({
    queryKey: usersKeys.byTenant(tenantSlug),
    queryFn: async () => {
      // NOTE: the backend currently returns the full user list without
      // server-side tenant filtering; tenantSlug only scopes the cache key
      // (client-side filtering happens at the call site). The query param
      // below future-proofs server filtering without breaking current behavior.
      const suffix = tenantSlug ? `?tenant=${encodeURIComponent(tenantSlug)}` : ''
      const users = await edenGet<unknown>(`/admin/users${suffix}`)
      return usersQuerySchema.parse({ users }).users
    },
    staleTime: 5 * 60 * 1000,
  })
}
