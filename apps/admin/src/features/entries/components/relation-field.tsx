import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import type { FieldDefinition } from '@/features/collections/api/collections-api'
import { logger } from '@/lib/logger'
import {
  type RelationType,
  useEntryRelations,
  useLinkRelation,
  useUnlinkRelation,
} from '../api/relations-api'
import { RelatedEntriesDisplay } from './related-entries-display'
import { RelationPicker } from './relation-picker'

type RelationFieldProps = {
  field: FieldDefinition
  entryId?: string // undefined for new entries
  sourceCollectionId: string
  value: string | string[] // entry IDs
  onChange: (value: string | string[]) => void
}

/**
 * Relation field component combining picker and display
 */
export function RelationField({
  field,
  entryId,
  sourceCollectionId,
  value,
  onChange,
}: RelationFieldProps) {
  // Extract targetCollectionId and relationType from field.options
  const targetCollectionId = field.options?.targetCollectionId as string | undefined
  const relationType = (field.options?.relationType as RelationType) || 'one-to-many'

  // State for locally tracking relations before entry is saved
  const [localEntryIds, setLocalEntryIds] = useState<string[]>(() => {
    if (!value) return []
    return Array.isArray(value) ? value : [value]
  })

  // Fetch existing relations if editing an existing entry
  const { data: existingRelations = [] } = useEntryRelations(
    entryId || '',
    entryId ? field.name : undefined
  )

  // Mutations
  const linkMutation = useLinkRelation()
  const unlinkMutation = useUnlinkRelation()

  // Sync local state with form value on mount/change
  useEffect(() => {
    if (value !== undefined) {
      const ids = Array.isArray(value) ? value : value ? [value] : []
      setLocalEntryIds(ids)
    }
  }, [value])

  // Validate field configuration
  if (!targetCollectionId) {
    return (
      <Alert variant='destructive'>
        <AlertDescription>
          Relation field "{field.name}" is missing targetCollectionId in options.
        </AlertDescription>
      </Alert>
    )
  }

  // Handle selecting an entry
  const handleSelect = async (targetEntryId: string) => {
    // For one-to-one, replace the current selection
    if (relationType === 'one-to-one') {
      const newIds = [targetEntryId]
      setLocalEntryIds(newIds)
      onChange(targetEntryId)

      // If editing existing entry, update the relation
      if (entryId) {
        // Unlink existing relations first
        for (const relation of existingRelations) {
          await unlinkMutation.mutateAsync({
            sourceEntryId: entryId,
            targetEntryId: relation.targetEntryId,
            fieldName: field.name,
          })
        }
        // Link new relation
        try {
          await linkMutation.mutateAsync({
            sourceEntryId: entryId,
            targetEntryId,
            sourceCollectionId,
            targetCollectionId,
            relationType,
            fieldName: field.name,
            sortOrder: 0,
          })
          toast.success('Relation updated')
        } catch (error) {
          logger.error('Failed to link relation:', error)
          toast.error('Failed to update relation')
        }
      }
    } else {
      // For one-to-many / many-to-many, add to the list if not already present
      if (localEntryIds.includes(targetEntryId)) {
        toast.info('Entry already linked')
        return
      }

      const newIds = [...localEntryIds, targetEntryId]
      setLocalEntryIds(newIds)
      onChange(newIds)

      // If editing existing entry, create the relation
      if (entryId) {
        try {
          await linkMutation.mutateAsync({
            sourceEntryId: entryId,
            targetEntryId,
            sourceCollectionId,
            targetCollectionId,
            relationType,
            fieldName: field.name,
            sortOrder: localEntryIds.length,
          })
          toast.success('Relation added')
        } catch (error) {
          logger.error('Failed to link relation:', error)
          toast.error('Failed to add relation')
        }
      }
    }
  }

  // Handle unlinking an entry
  const handleUnlink = async (targetEntryId: string) => {
    const newIds = localEntryIds.filter((id) => id !== targetEntryId)
    setLocalEntryIds(newIds)
    onChange(relationType === 'one-to-one' ? '' : newIds)

    // If editing existing entry, remove the relation
    if (entryId) {
      try {
        await unlinkMutation.mutateAsync({
          sourceEntryId: entryId,
          targetEntryId,
          fieldName: field.name,
        })
        toast.success('Relation removed')
      } catch (error) {
        logger.error('Failed to unlink relation:', error)
        toast.error('Failed to remove relation')
      }
    }
  }

  // Handle reordering (for existing entries with saved relations)
  const handleReorder = async (entryIds: string[]) => {
    if (!entryId) return

    setLocalEntryIds(entryIds)
    onChange(entryIds)

    // Update sortOrder for each relation
    try {
      // Unlink all existing relations
      for (const relation of existingRelations) {
        await unlinkMutation.mutateAsync({
          sourceEntryId: entryId,
          targetEntryId: relation.targetEntryId,
          fieldName: field.name,
        })
      }

      // Re-link with new sort order
      for (let i = 0; i < entryIds.length; i++) {
        await linkMutation.mutateAsync({
          sourceEntryId: entryId,
          targetEntryId: entryIds[i],
          sourceCollectionId,
          targetCollectionId,
          relationType,
          fieldName: field.name,
          sortOrder: i,
        })
      }
      toast.success('Order updated')
    } catch (error) {
      logger.error('Failed to reorder relations:', error)
      toast.error('Failed to update order')
    }
  }

  return (
    <div className='space-y-3'>
      <RelationPicker
        targetCollectionId={targetCollectionId}
        relationType={relationType}
        selectedEntryIds={localEntryIds}
        onSelect={handleSelect}
      />

      {entryId ? (
        // For existing entries, show saved relations
        <RelatedEntriesDisplay
          relations={existingRelations}
          onUnlink={handleUnlink}
          onReorder={relationType !== 'one-to-one' ? handleReorder : undefined}
        />
      ) : (
        // For new entries, show local state as simple list
        localEntryIds.length > 0 && (
          <div className='space-y-2'>
            {localEntryIds.map((entryId) => (
              <div
                key={entryId}
                className='flex items-center justify-between bg-muted/50 rounded-md px-3 py-2'
              >
                <span className='text-sm truncate'>{entryId}</span>
                <button
                  type='button'
                  onClick={() => handleUnlink(entryId)}
                  className='text-destructive hover:text-destructive/80 text-sm'
                >
                  Remove
                </button>
              </div>
            ))}
            <p className='text-xs text-muted-foreground'>
              Relations will be created after saving the entry.
            </p>
          </div>
        )
      )}
    </div>
  )
}
