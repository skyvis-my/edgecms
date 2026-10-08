import { Textarea } from '@/components/ui/textarea'
import type { FieldTypeProps } from './types'

export function MarkdownField({
  fieldId,
  name,
  currentValue,
  onChange,
  error,
  errorId,
  disabled,
}: FieldTypeProps) {
  return (
    <Textarea
      id={fieldId}
      value={(currentValue as string) || ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={`Enter ${name}`}
      rows={8}
      disabled={disabled}
      aria-invalid={!!error}
      aria-describedby={error ? errorId : undefined}
      className='font-mono text-sm'
    />
  )
}
