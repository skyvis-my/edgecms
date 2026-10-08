import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { RichTextEditor, type JSONContent } from './rich-text-editor'
import type { FieldTypeProps } from './types'

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
  )
}
