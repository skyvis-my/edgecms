import { Input } from '@/components/ui/input'
import type { FieldTypeProps } from './types'

export function DefaultField({
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
      value={String(currentValue || '')}
      onChange={(e) => onChange(e.target.value)}
      placeholder={`Enter ${name}`}
      disabled={disabled}
      aria-invalid={!!error}
      aria-describedby={error ? errorId : undefined}
    />
  )
}
