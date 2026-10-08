import { RelationField } from '@/features/entries/components/relation-field'
import type { FieldTypeProps } from './types'

export function RelationFieldWrapper({
  currentValue,
  onChange,
  field,
  entryId,
  collectionId,
}: FieldTypeProps) {
  if (!collectionId) {
    return (
      <div className='text-sm text-destructive'>
        Relation field requires collectionId context
      </div>
    )
  }
  return (
    <RelationField
      field={field}
      entryId={entryId}
      sourceCollectionId={collectionId}
      value={currentValue as string | string[]}
      onChange={onChange}
    />
  )
}
