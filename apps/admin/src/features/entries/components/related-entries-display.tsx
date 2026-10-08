import { useMemo } from 'react'
import { ArrowDown, ArrowUp, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useCollections } from '@/features/collections/api/collections-api'
import { useEntriesByIds } from '../api/entries-api'
import type { Entry } from '../api/entries-api'
import type { Relation } from '../api/relations-api'

type RelatedEntriesDisplayProps = {
  relations: Relation[]
  onUnlink: (targetEntryId: string) => void
  onReorder?: (entryIds: string[]) => void
}

function RelatedEntryChip({
  relation,
  entry,
  collectionName,
  onUnlink,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  showReorder,
}: {
  relation: Relation
  entry?: Entry
  collectionName?: string
  onUnlink: () => void
  onMoveUp?: () => void
  onMoveDown?: () => void
  canMoveUp: boolean
  canMoveDown: boolean
  showReorder: boolean
}) {
  const displayText = entry
    ? (() => {
        const textField = Object.values(entry.data).find(
          (val) => typeof val === 'string'
        )
        if (textField && typeof textField === 'string') {
          return textField.length > 40
            ? `${textField.slice(0, 40)}...`
            : textField
        }
        return entry.slug
      })()
    : relation.targetEntryId

  return (
    <div className='flex items-center gap-2 bg-muted/50 rounded-md px-3 py-2'>
      <div className='flex-1 min-w-0 flex items-center gap-2'>
        <span className='truncate text-sm'>{displayText}</span>
        {collectionName && (
          <Badge variant='secondary' className='shrink-0 text-xs'>
            {collectionName}
          </Badge>
        )}
      </div>

      <div className='flex items-center gap-1 shrink-0'>
        {showReorder && (
          <>
            <Button
              type='button'
              size='icon'
              variant='ghost'
              className='h-6 w-6'
              onClick={onMoveUp}
              disabled={!canMoveUp}
              title='Move up'
            >
              <ArrowUp className='h-3 w-3' />
            </Button>
            <Button
              type='button'
              size='icon'
              variant='ghost'
              className='h-6 w-6'
              onClick={onMoveDown}
              disabled={!canMoveDown}
              title='Move down'
            >
              <ArrowDown className='h-3 w-3' />
            </Button>
          </>
        )}
        <Button
          type='button'
          size='icon'
          variant='ghost'
          className='h-6 w-6 text-destructive hover:text-destructive'
          onClick={onUnlink}
          title='Remove relation'
        >
          <X className='h-3 w-3' />
        </Button>
      </div>
    </div>
  )
}

export function RelatedEntriesDisplay({
  relations,
  onUnlink,
  onReorder,
}: RelatedEntriesDisplayProps) {
  const sortedRelations = [...relations].sort(
    (a, b) => a.sortOrder - b.sortOrder
  )

  const entryIds = useMemo(
    () => [...new Set(relations.map((r) => r.targetEntryId))],
    [relations]
  )

  const { data: entries } = useEntriesByIds(entryIds)
  const { data: allCollections } = useCollections()

  const entriesMap = useMemo(() => {
    const map = new Map<string, Entry>()
    if (entries) {
      for (const entry of entries) {
        map.set(entry.id, entry)
      }
    }
    return map
  }, [entries])

  const collectionsMap = useMemo(() => {
    const map = new Map<string, string>()
    if (allCollections) {
      for (const col of allCollections) {
        map.set(col.id, col.name)
      }
    }
    return map
  }, [allCollections])

  const handleMoveUp = (index: number) => {
    if (index === 0 || !onReorder) return
    const newOrder = [...sortedRelations]
    ;[newOrder[index - 1], newOrder[index]] = [
      newOrder[index],
      newOrder[index - 1],
    ]
    onReorder(newOrder.map((r) => r.targetEntryId))
  }

  const handleMoveDown = (index: number) => {
    if (index === sortedRelations.length - 1 || !onReorder) return
    const newOrder = [...sortedRelations]
    ;[newOrder[index], newOrder[index + 1]] = [
      newOrder[index + 1],
      newOrder[index],
    ]
    onReorder(newOrder.map((r) => r.targetEntryId))
  }

  if (relations.length === 0) {
    return (
      <div className='text-sm text-muted-foreground py-4 text-center border border-dashed rounded-md'>
        No related entries
      </div>
    )
  }

  const showReorder = !!onReorder && relations.length > 1

  return (
    <div className='space-y-2'>
      {sortedRelations.map((relation, index) => (
        <RelatedEntryChip
          key={relation.id}
          relation={relation}
          entry={entriesMap.get(relation.targetEntryId)}
          collectionName={collectionsMap.get(
            relation.targetCollectionId
          )}
          onUnlink={() => onUnlink(relation.targetEntryId)}
          onMoveUp={() => handleMoveUp(index)}
          onMoveDown={() => handleMoveDown(index)}
          canMoveUp={index > 0}
          canMoveDown={index < sortedRelations.length - 1}
          showReorder={showReorder}
        />
      ))}
    </div>
  )
}
