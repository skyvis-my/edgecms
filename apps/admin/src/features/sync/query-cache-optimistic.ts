import type { QueryClient, QueryKey } from '@tanstack/react-query'

export async function snapshotListQuery<T>(
  queryClient: QueryClient,
  queryKey: QueryKey
): Promise<T[]> {
  await queryClient.cancelQueries({ queryKey })
  return queryClient.getQueryData<T[]>(queryKey) ?? []
}

export async function snapshotDetailQuery<T>(
  queryClient: QueryClient,
  queryKey: QueryKey
): Promise<T | null> {
  await queryClient.cancelQueries({ queryKey })
  return queryClient.getQueryData<T>(queryKey) ?? null
}

export function restoreQuerySnapshot<T>(
  queryClient: QueryClient,
  queryKey: QueryKey,
  value: T
): void {
  queryClient.setQueryData(queryKey, value)
}

export function appendListItem<T>(queryClient: QueryClient, queryKey: QueryKey, item: T): void {
  queryClient.setQueryData<T[]>(queryKey, (current = []) => [...current, item])
}

export function mapListItems<T>(
  queryClient: QueryClient,
  queryKey: QueryKey,
  mapper: (item: T) => T
): void {
  queryClient.setQueryData<T[]>(queryKey, (current = []) => current.map(mapper))
}

export function filterListItems<T>(
  queryClient: QueryClient,
  queryKey: QueryKey,
  predicate: (item: T) => boolean
): void {
  queryClient.setQueryData<T[]>(queryKey, (current = []) => current.filter(predicate))
}

export function patchDetail<T>(
  queryClient: QueryClient,
  queryKey: QueryKey,
  patcher: (current: T) => T
): void {
  const current = queryClient.getQueryData<T>(queryKey)
  if (!current) return
  queryClient.setQueryData(queryKey, patcher(current))
}
