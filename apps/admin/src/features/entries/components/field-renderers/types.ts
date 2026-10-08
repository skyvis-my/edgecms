import type { FieldDefinition } from '@/features/collections/api/collections-api'

export type FieldTypeProps = {
  fieldId: string
  name: string
  currentValue: unknown
  onChange: (value: unknown) => void
  error?: string
  errorId: string
  disabled?: boolean
  field: FieldDefinition
  entryId?: string
  collectionId?: string
}
