import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  buildLinkRelationCommand,
  buildUnlinkRelationCommand,
} from '@/features/commands/command-builder'
import { useExecuteCommand } from '@/features/commands/use-execute-command'
import { edenGet } from '@/lib/eden-client'
import { entriesKeys } from './entries-api'

/**
 * Query key factory for relations
 */
export const relationsKeys = {
  all: ['relations'] as const,
  byEntry: (entryId: string) => [...relationsKeys.all, entryId] as const,
  byEntryAndField: (entryId: string, fieldName: string) =>
    [...relationsKeys.all, entryId, fieldName] as const,
}

/**
 * Type definitions for relations
 */
export type RelationType = 'one-to-one' | 'one-to-many' | 'many-to-many'

export type Relation = {
  id: string
  sourceEntryId: string
  targetEntryId: string
  sourceCollectionId: string
  targetCollectionId: string
  relationType: RelationType
  fieldName: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export type LinkRelationInput = {
  sourceEntryId: string
  targetEntryId: string
  sourceCollectionId: string
  targetCollectionId: string
  relationType: RelationType
  fieldName: string
  sortOrder?: number
}

export type UnlinkRelationInput = {
  sourceEntryId: string
  targetEntryId: string
  fieldName: string
}

/**
 * Hook to fetch relations for a specific entry
 */
export function useEntryRelations(entryId: string, fieldName?: string) {
  return useQuery({
    queryKey: fieldName
      ? relationsKeys.byEntryAndField(entryId, fieldName)
      : relationsKeys.byEntry(entryId),
    queryFn: async () => {
      const queryParams = new URLSearchParams()
      if (fieldName) queryParams.set('fieldName', fieldName)

      return edenGet<Relation[]>(`/admin/relations/${entryId}?${queryParams.toString()}`)
    },
    enabled: !!entryId,
  })
}

/**
 * Hook to link two entries via a relation using the command system
 */
export function useLinkRelation() {
  const queryClient = useQueryClient()
  const executeCommand = useExecuteCommand()

  return useMutation({
    mutationFn: async (input: LinkRelationInput) => {
      const command = buildLinkRelationCommand({
        sourceEntryId: input.sourceEntryId,
        targetEntryId: input.targetEntryId,
        sourceCollectionId: input.sourceCollectionId,
        targetCollectionId: input.targetCollectionId,
        relationType: input.relationType,
        fieldName: input.fieldName,
        sortOrder: input.sortOrder,
      })

      const result = await executeCommand.mutateAsync(command)
      return result.data as Relation
    },
    onSuccess: (data) => {
      // Invalidate relations queries for the source entry
      queryClient.invalidateQueries({ queryKey: relationsKeys.byEntry(data.sourceEntryId) })
      // Also invalidate the entry details in case it has populated relations
      queryClient.invalidateQueries({ queryKey: entriesKeys.detail(data.sourceEntryId) })
    },
  })
}

/**
 * Hook to unlink two entries by removing a relation using the command system
 */
export function useUnlinkRelation() {
  const queryClient = useQueryClient()
  const executeCommand = useExecuteCommand()

  return useMutation({
    mutationFn: async (input: UnlinkRelationInput) => {
      const command = buildUnlinkRelationCommand(
        input.sourceEntryId,
        input.targetEntryId,
        input.fieldName
      )

      await executeCommand.mutateAsync(command)
      return input
    },
    onSuccess: (data) => {
      // Invalidate relations queries for the source entry
      queryClient.invalidateQueries({ queryKey: relationsKeys.byEntry(data.sourceEntryId) })
      // Also invalidate the entry details
      queryClient.invalidateQueries({ queryKey: entriesKeys.detail(data.sourceEntryId) })
    },
  })
}
