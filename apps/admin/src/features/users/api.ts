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
      const users = await edenGet<unknown>('/admin/users')
      return usersQuerySchema.parse({ users }).users
    },
  })
}
