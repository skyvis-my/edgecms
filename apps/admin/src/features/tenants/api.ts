import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { DEFAULT_ASSET_ALLOWED_MIME_TYPES } from '@/features/assets/file-policy'
import {
  appendListItem,
  filterListItems,
  mapListItems,
  patchDetail,
  restoreQuerySnapshot,
  snapshotDetailQuery,
  snapshotListQuery,
} from '@/features/sync/query-cache-optimistic'
import { type OfflineMutationDescriptor, useOfflineMutation } from '@/features/sync/use-offline-mutation'
import { edenDelete, edenGet, edenPost, edenPut } from '@/lib/eden-client'
import {
  getCurrentTenantSlug as getCurrentTenantSlugFromStorage,
  setCurrentTenantSlug as setCurrentTenantSlugInStorage,
} from '@/lib/tenant-storage'

/**
 * Query key factory for tenants
 */
export const tenantsKeys = {
  all: ['tenants'] as const,
  detail: (slug: string) => ['tenants', slug] as const,
  current: ['tenant-current'] as const,
}

/** @deprecated Use tenantsKeys */
export const tenantKeys = tenantsKeys

/**
 * Type definitions for tenant entities
 */
export type TenantStatus = 'active' | 'suspended'
export const TENANT_USER_ROLES = ['owner', 'admin', 'member'] as const
export type TenantUserRole = (typeof TENANT_USER_ROLES)[number]
const tenantUserRoleSchema = z.enum(TENANT_USER_ROLES)

export type TenantUser = {
  id: string
  email: string
  name: string
  role: TenantUserRole
}

export type Tenant = {
  id: string
  name: string
  slug: string
  status: TenantStatus
  localeCatalog: string[]
  targetUrl?: string | null
  corsOrigin?: string | null
  mediaUploadMaxBytes: number
  mediaUploadMaxDimension: number
  mediaAllowedMimeTypes: string[]
  createdAt: string
  updatedAt: string
  userCount?: number
}

export type TenantDetail = Tenant & {
  users: TenantUser[]
}

export type CreateTenantInput = {
  name: string
  slug: string
  localeCatalog?: string[]
  targetUrl?: string
  corsOrigin?: string
  mediaUploadMaxBytes?: number
  mediaUploadMaxDimension?: number
  mediaAllowedMimeTypes?: string[]
}

export type UpdateTenantInput = Partial<CreateTenantInput> & {
  status?: TenantStatus
}

export type AddTenantUserInput = {
  userId: string
  role: TenantUserRole
}

function parseTenantUserRole(role: string): TenantUserRole {
  const parsed = tenantUserRoleSchema.safeParse(role)
  if (!parsed.success) {
    throw new Error('Invalid tenant role')
  }
  return parsed.data
}

function buildOptimisticTenant(input: CreateTenantInput): Tenant {
  const now = new Date().toISOString()
  return {
    id: `offline-${crypto.randomUUID()}`,
    name: input.name,
    slug: input.slug,
    status: 'active',
    localeCatalog: input.localeCatalog ?? ['en'],
    targetUrl: input.targetUrl ?? null,
    corsOrigin: input.corsOrigin ?? null,
    mediaUploadMaxBytes: input.mediaUploadMaxBytes ?? 5 * 1024 * 1024,
    mediaUploadMaxDimension: input.mediaUploadMaxDimension ?? 2048,
    mediaAllowedMimeTypes: input.mediaAllowedMimeTypes ?? [...DEFAULT_ASSET_ALLOWED_MIME_TYPES],
    createdAt: now,
    updatedAt: now,
    userCount: 0,
  }
}

const createTenantDescriptor: OfflineMutationDescriptor<CreateTenantInput> = {
  method: 'POST',
  path: () => '/admin/tenants',
  body: (input) => input,
}

const updateTenantDescriptor: OfflineMutationDescriptor<{
  slug: string
  input: UpdateTenantInput
}> = {
  method: 'PUT',
  path: ({ slug }) => `/admin/tenants/${slug}`,
  body: ({ input }) => input,
}

const deleteTenantDescriptor: OfflineMutationDescriptor<string> = {
  method: 'DELETE',
  path: (slug) => `/admin/tenants/${slug}`,
}

const addTenantUserDescriptor: OfflineMutationDescriptor<{
  slug: string
  input: AddTenantUserInput
}> = {
  method: 'POST',
  path: ({ slug }) => `/admin/tenants/${slug}/users`,
  body: ({ input }) => ({
    ...input,
    role: parseTenantUserRole(input.role),
  }),
}

const removeTenantUserDescriptor: OfflineMutationDescriptor<{ slug: string; userId: string }> = {
  method: 'DELETE',
  path: ({ slug, userId }) => `/admin/tenants/${slug}/users/${userId}`,
}

const updateTenantUserRoleDescriptor: OfflineMutationDescriptor<{
  slug: string
  userId: string
  role: TenantUserRole
}> = {
  method: 'PUT',
  path: ({ slug, userId }) => `/admin/tenants/${slug}/users/${userId}`,
  body: ({ role }) => ({ role }),
}

/**
 * Get the current active tenant slug from localStorage
 */
export function getCurrentTenantSlug(): string | null {
  return getCurrentTenantSlugFromStorage()
}

/**
 * Set the current active tenant slug in localStorage
 */
export function setCurrentTenantSlug(slug: string | null) {
  setCurrentTenantSlugInStorage(slug)
}

/**
 * Hook to get the current tenant slug from localStorage
 */
export function useCurrentTenantSlug() {
  return useQuery({
    queryKey: tenantKeys.current,
    queryFn: () => getCurrentTenantSlug(),
    staleTime: Number.POSITIVE_INFINITY,
  })
}

/**
 * Hook to fetch all tenants (super-admin only)
 */
export function useTenants() {
  return useQuery({
    queryKey: tenantKeys.all,
    queryFn: async () => edenGet<Tenant[]>('/admin/tenants'),
    staleTime: 10 * 60 * 1000,
  })
}

/**
 * Hook to fetch a single tenant by slug
 */
export function useTenant(slug: string) {
  return useQuery({
    queryKey: tenantKeys.detail(slug),
    queryFn: async () => edenGet<TenantDetail>(`/admin/tenants/${slug}`),
    enabled: !!slug,
    staleTime: 10 * 60 * 1000,
  })
}

/**
 * Hook to create a new tenant
 */
export function useCreateTenant() {
  return useOfflineMutation<Tenant, CreateTenantInput, { previousTenants: Tenant[] }>({
    descriptor: createTenantDescriptor,
    runOnline: (input) => edenPost<Tenant>('/admin/tenants', input),
    buildOfflineResult: (_queryClient, input) => buildOptimisticTenant(input),
    onMutateOptimistic: async (queryClient, input) => {
      const previousTenants = await snapshotListQuery<Tenant>(queryClient, tenantKeys.all)
      appendListItem(queryClient, tenantKeys.all, buildOptimisticTenant(input))
      return { previousTenants }
    },
    onRollbackOptimistic: (queryClient, context) => {
      if (context?.previousTenants) {
        restoreQuerySnapshot(queryClient, tenantKeys.all, context.previousTenants)
      }
    },
    onMutationSuccess: (queryClient) => {
      queryClient.invalidateQueries({ queryKey: tenantKeys.all })
    },
  })
}

/**
 * Hook to update an existing tenant
 */
export function useUpdateTenant() {
  return useOfflineMutation<
    Tenant,
    { slug: string; input: UpdateTenantInput },
    { previousTenants: Tenant[]; previousDetail: TenantDetail | null; slug: string }
  >({
    descriptor: updateTenantDescriptor,
    runOnline: ({ slug, input }) => edenPut<Tenant>(`/admin/tenants/${slug}`, input),
    buildOfflineResult: (queryClient, { slug, input }) => {
      const cached = queryClient.getQueryData<TenantDetail>(tenantKeys.detail(slug))
      return {
        ...(cached ?? buildOptimisticTenant({ name: slug, slug })),
        ...input,
        slug,
        updatedAt: new Date().toISOString(),
      } as Tenant
    },
    onMutateOptimistic: async (queryClient, { slug, input }) => {
      const previousTenants = await snapshotListQuery<Tenant>(queryClient, tenantKeys.all)
      const previousDetail = await snapshotDetailQuery<TenantDetail>(
        queryClient,
        tenantKeys.detail(slug)
      )

      mapListItems(queryClient, tenantKeys.all, (tenant: Tenant) =>
        tenant.slug === slug ? { ...tenant, ...input, updatedAt: new Date().toISOString() } : tenant
      )
      patchDetail(queryClient, tenantKeys.detail(slug), (detail: TenantDetail) => ({
        ...detail,
        ...input,
        updatedAt: new Date().toISOString(),
      }))

      return { previousTenants, previousDetail, slug }
    },
    onRollbackOptimistic: (queryClient, context) => {
      if (context?.previousTenants) {
        restoreQuerySnapshot(queryClient, tenantKeys.all, context.previousTenants)
      }
      if (context?.slug && context.previousDetail) {
        restoreQuerySnapshot(queryClient, tenantKeys.detail(context.slug), context.previousDetail)
      }
    },
    onMutationSuccess: (queryClient, data) => {
      queryClient.invalidateQueries({ queryKey: tenantKeys.all })
      queryClient.invalidateQueries({ queryKey: tenantKeys.detail(data.slug) })
    },
  })
}

/**
 * Hook to delete a tenant
 */
export function useDeleteTenant() {
  return useOfflineMutation<void, string, { previousTenants: Tenant[] }>({
    descriptor: deleteTenantDescriptor,
    runOnline: (slug) => edenDelete(`/admin/tenants/${slug}`),
    buildOfflineResult: () => undefined,
    onMutateOptimistic: async (queryClient, slug) => {
      const previousTenants = await snapshotListQuery<Tenant>(queryClient, tenantKeys.all)
      filterListItems(queryClient, tenantKeys.all, (tenant: Tenant) => tenant.slug !== slug)
      return { previousTenants }
    },
    onRollbackOptimistic: (queryClient, context) => {
      if (context?.previousTenants) {
        restoreQuerySnapshot(queryClient, tenantKeys.all, context.previousTenants)
      }
    },
    onMutationSuccess: (queryClient) => {
      queryClient.invalidateQueries({ queryKey: tenantKeys.all })
    },
  })
}

/**
 * Hook to add a user to a tenant
 */
export function useAddTenantUser() {
  return useOfflineMutation<
    TenantUser,
    { slug: string; input: AddTenantUserInput },
    { previousDetail: TenantDetail | null; slug: string }
  >({
    descriptor: addTenantUserDescriptor,
    runOnline: ({ slug, input }) =>
      edenPost<TenantUser>(`/admin/tenants/${slug}/users`, {
        ...input,
        role: parseTenantUserRole(input.role),
      }),
    buildOfflineResult: (_queryClient, { input }) => ({
      id: input.userId,
      email: '',
      name: '',
      role: parseTenantUserRole(input.role),
    }),
    onMutateOptimistic: async (queryClient, { slug, input }) => {
      const role = parseTenantUserRole(input.role)
      const previousDetail = await snapshotDetailQuery<TenantDetail>(
        queryClient,
        tenantKeys.detail(slug)
      )
      patchDetail(queryClient, tenantKeys.detail(slug), (detail: TenantDetail) => ({
        ...detail,
        users: [...detail.users, { id: input.userId, email: '', name: '', role }],
      }))
      return { previousDetail, slug }
    },
    onRollbackOptimistic: (queryClient, context) => {
      if (context?.slug && context.previousDetail) {
        restoreQuerySnapshot(queryClient, tenantKeys.detail(context.slug), context.previousDetail)
      }
    },
    onMutationSuccess: (queryClient, _data, variables) => {
      queryClient.invalidateQueries({ queryKey: tenantKeys.detail(variables.slug) })
    },
  })
}

/**
 * Hook to remove a user from a tenant
 */
export function useRemoveTenantUser() {
  return useOfflineMutation<
    void,
    { slug: string; userId: string },
    { previousDetail: TenantDetail | null; slug: string }
  >({
    descriptor: removeTenantUserDescriptor,
    runOnline: ({ slug, userId }) => edenDelete(`/admin/tenants/${slug}/users/${userId}`),
    buildOfflineResult: () => undefined,
    onMutateOptimistic: async (queryClient, { slug, userId }) => {
      const previousDetail = await snapshotDetailQuery<TenantDetail>(
        queryClient,
        tenantKeys.detail(slug)
      )
      patchDetail(queryClient, tenantKeys.detail(slug), (detail: TenantDetail) => ({
        ...detail,
        users: detail.users.filter((user) => user.id !== userId),
      }))
      return { previousDetail, slug }
    },
    onRollbackOptimistic: (queryClient, context) => {
      if (context?.slug && context.previousDetail) {
        restoreQuerySnapshot(queryClient, tenantKeys.detail(context.slug), context.previousDetail)
      }
    },
    onMutationSuccess: (queryClient, _data, variables) => {
      queryClient.invalidateQueries({ queryKey: tenantKeys.detail(variables.slug) })
    },
  })
}

/**
 * Hook to update a tenant user's role
 */
export function useUpdateTenantUserRole() {
  return useOfflineMutation<
    TenantUser,
    { slug: string; userId: string; role: TenantUserRole },
    { previousDetail: TenantDetail | null; slug: string }
  >({
    descriptor: updateTenantUserRoleDescriptor,
    runOnline: ({ slug, userId, role }) =>
      edenPut<TenantUser>(`/admin/tenants/${slug}/users/${userId}`, { role }),
    buildOfflineResult: (_queryClient, { userId, role }) => ({
      id: userId,
      email: '',
      name: '',
      role,
    }),
    onMutateOptimistic: async (queryClient, { slug, userId, role }) => {
      const previousDetail = await snapshotDetailQuery<TenantDetail>(
        queryClient,
        tenantKeys.detail(slug)
      )
      patchDetail(queryClient, tenantKeys.detail(slug), (detail: TenantDetail) => ({
        ...detail,
        users: detail.users.map((u) => (u.id === userId ? { ...u, role } : u)),
      }))
      return { previousDetail, slug }
    },
    onRollbackOptimistic: (queryClient, context) => {
      if (context?.slug && context.previousDetail) {
        restoreQuerySnapshot(queryClient, tenantKeys.detail(context.slug), context.previousDetail)
      }
    },
    onMutationSuccess: (queryClient, _data, variables) => {
      queryClient.invalidateQueries({ queryKey: tenantKeys.detail(variables.slug) })
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
  })
}
