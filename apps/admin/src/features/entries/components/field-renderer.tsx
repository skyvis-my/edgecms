import { useCallback } from 'react'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import type { FieldDefinition } from '@/features/collections/api/collections-api'
import {
  getLocaleValue,
  type ArrayItemSubfield,
} from './field-renderer-utils'
import { FIELD_RENDERERS } from './field-renderers'

type FieldRendererProps = {
  field: FieldDefinition
  value: unknown
  onChange: (value: unknown) => void
  error?: string
  disabled?: boolean
  entryId?: string
  collectionId?: string
  activeLocale?: string
}

export function FieldRenderer({
  field,
  value,
  onChange,
  error,
  disabled,
  entryId,
  collectionId,
  activeLocale,
}: FieldRendererProps) {
  const { type, name, required, localizable } = field
  const fieldId = `entry-field-${name}`
  const errorId = `${fieldId}-error`

  const currentValue = getLocaleValue(
    value,
    !!localizable,
    activeLocale,
  )

  const handleLocaleChange = useCallback(
    (newValue: unknown) => {
      if (!localizable || !activeLocale) {
        onChange(newValue)
        return
      }
      const currentLocaleMap =
        (value as Record<string, unknown>) || {}
      onChange({ ...currentLocaleMap, [activeLocale]: newValue })
    },
    [localizable, activeLocale, onChange, value],
  )

  const itemSubfields =
    (field.options?.itemFields as ArrayItemSubfield[] | undefined) ??
    []

  const Renderer =
    FIELD_RENDERERS[type] ?? FIELD_RENDERERS.default

  return (
    <div className='space-y-2'>
      <Label htmlFor={fieldId} className='flex items-center gap-2'>
        <span>
          {name}
          {required && (
            <>
              <span
                className='ml-1 text-red-500'
                aria-hidden='true'
              >
                *
              </span>
              <span className='sr-only'>required</span>
            </>
          )}
        </span>
        {localizable && activeLocale && (
          <Badge
            variant='outline'
            className='text-[10px] px-1.5 py-0'
          >
            {activeLocale.toUpperCase()}
          </Badge>
        )}
      </Label>
      <Renderer
        fieldId={fieldId}
        name={name}
        currentValue={currentValue}
        onChange={handleLocaleChange}
        error={error}
        errorId={errorId}
        disabled={disabled}
        field={field}
        entryId={entryId}
        collectionId={collectionId}
        itemSubfields={itemSubfields}
      />
      {error && (
        <p
          id={errorId}
          className='text-sm text-red-600'
          role='alert'
          aria-live='polite'
        >
          {error}
        </p>
      )}
    </div>
  )
}
