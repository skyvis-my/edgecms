import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { edenGet, edenPut } from '@/lib/eden-client'
import { userListSchema } from './data/schema'

const usersQuerySchema = z.object({
  users: userListSchema,
})

export const usersKeys = {
  all: ['users'] as const,
  byTenant: (tenantSlug?: string) => ['users', tenantSlug ?? 'global'] as const,
  roles: (tenantSlug: string) => ['users', tenantSlug, 'roles'] as const,
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

const tenantRoleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  permissionCount: z.number().optional(),
})
export type TenantRoleDefinition = z.infer<typeof tenantRoleSchema>

/** Role rows of the current tenant (built-in and custom), from `GET .../admin/roles`. */
export function useTenantRoles(tenantSlug: string | undefined) {
  return useQuery({
    queryKey: usersKeys.roles(tenantSlug ?? ''),
    queryFn: async () => z.array(tenantRoleSchema).parse(await edenGet<unknown>('/admin/roles')),
    enabled: Boolean(tenantSlug),
    staleTime: 60 * 1000,
  })
}

export type MemberRoleChange = {
  userId: string
  role: string
  previousRole?: string
  changed: boolean
}

/** PL-03: set a member's tenant role (built-in or custom) via the tenant route. */
export function useAssignMemberRole(tenantSlug: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      edenPut<MemberRoleChange>(`/admin/users/${encodeURIComponent(userId)}/role`, { role }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: usersKeys.byTenant(tenantSlug) })
    },
  })
}
