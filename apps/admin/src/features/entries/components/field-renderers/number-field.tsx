import { Input } from '@/components/ui/input'
import type { FieldTypeProps } from './types'

export function NumberField({
  fieldId,
  name,
  currentValue,
  onChange,
  error,
  errorId,
  disabled,
}: FieldTypeProps) {
  return (
    <Input
      id={fieldId}
      type='number'
      value={(currentValue as number) || ''}
      onChange={(e) =>
        onChange(e.target.value ? Number(e.target.value) : null)
      }
      placeholder={`Enter ${name}`}
      disabled={disabled}
      aria-invalid={!!error}
      aria-describedby={error ? errorId : undefined}
    />
  )
}
