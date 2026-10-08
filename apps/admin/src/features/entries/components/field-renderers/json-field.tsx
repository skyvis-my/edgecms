import { Textarea } from '@/components/ui/textarea'
import type { FieldTypeProps } from './types'

export function JsonField({
  fieldId,
  currentValue,
  onChange,
  error,
  errorId,
  disabled,
}: FieldTypeProps) {
  return (
    <Textarea
      id={fieldId}
      value={
        currentValue === null || currentValue === undefined
          ? ''
          : typeof currentValue === 'string'
            ? currentValue
            : JSON.stringify(currentValue, null, 2)
      }
      onChange={(e) => onChange(e.target.value)}
      placeholder='Enter valid JSON'
      rows={6}
      disabled={disabled}
      className='font-mono text-sm'
      aria-invalid={!!error}
      aria-describedby={error ? errorId : undefined}
    />
  )
}
