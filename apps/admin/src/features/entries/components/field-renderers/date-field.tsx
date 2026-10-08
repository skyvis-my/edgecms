import { Input } from '@/components/ui/input'
import type { FieldTypeProps } from './types'

export function DateField({
  fieldId,
  currentValue,
  onChange,
  error,
  errorId,
  disabled,
}: FieldTypeProps) {
  return (
    <Input
      id={fieldId}
      type='datetime-local'
      value={
        currentValue
          ? new Date(currentValue as string).toISOString().slice(0, 16)
          : ''
      }
      onChange={(e) =>
        onChange(
          e.target.value
            ? new Date(e.target.value).toISOString()
            : null,
        )
      }
      disabled={disabled}
      aria-invalid={!!error}
      aria-describedby={error ? errorId : undefined}
    />
  )
}
