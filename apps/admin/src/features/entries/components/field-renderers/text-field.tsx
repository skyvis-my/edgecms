import * as React from 'react'
import { Suspense } from 'react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import type { JSONContent } from './rich-text-editor'
import type { FieldTypeProps } from './types'

const RichTextEditor = React.lazy(() => import('./rich-text-editor'))

export function TextField({
  fieldId,
  name,
  currentValue,
  onChange,
  error,
  errorId,
  disabled,
  field,
}: FieldTypeProps) {
  const textComponent = field.options?.component as string | undefined

  if (textComponent === 'textarea') {
    return (
      <Textarea
        id={fieldId}
        value={(currentValue as string) || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`Enter ${name}`}
        rows={4}
        disabled={disabled}
        aria-invalid={!!error}
        aria-describedby={error ? errorId : undefined}
      />
    )
  }

  return (
    <Input
      id={fieldId}
      value={(currentValue as string) || ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={`Enter ${name}`}
      disabled={disabled}
      aria-invalid={!!error}
      aria-describedby={error ? errorId : undefined}
    />
  )
}

export function RichTextField({
  fieldId,
  name,
  currentValue,
  onChange,
  error,
  errorId,
  disabled,
}: FieldTypeProps) {
  const isJsonObject = typeof currentValue === 'object' && currentValue !== null
  return (
    <Suspense
      fallback={
        <div className="space-y-2">
          <Skeleton className="h-9 w-full rounded-md border" />
          <Skeleton className="h-32 w-full rounded-md border" />
        </div>
      }
    >
      <RichTextEditor
        id={fieldId}
        value={(currentValue as string | JSONContent) ?? ''}
        outputFormat={isJsonObject ? 'json' : undefined}
        onChange={(val, json) => {
          if (isJsonObject) {
            onChange(json ?? val)
          } else {
            onChange(val)
          }
        }}
        placeholder={`Enter ${name}`}
        disabled={disabled}
        aria-invalid={!!error}
        aria-describedby={error ? errorId : undefined}
      />
    </Suspense>
  )
}

