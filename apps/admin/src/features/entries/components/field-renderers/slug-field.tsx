import { Input } from '@/components/ui/input'
import type { FieldTypeProps } from './types'

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

export function SlugField({
  fieldId,
  name,
  currentValue,
  onChange,
  error,
  errorId,
  disabled,
  field,
}: FieldTypeProps) {
  const generateFrom = field.options?.generateFrom as string | undefined

  return (
    <div className='space-y-2'>
      <Input
        id={fieldId}
        type='text'
        value={(currentValue as string) || ''}
        onChange={(e) => onChange(slugify(e.target.value))}
        placeholder={`Enter ${name}`}
        disabled={disabled}
        aria-invalid={!!error}
        aria-describedby={error ? errorId : undefined}
        className='font-mono'
      />
      {generateFrom && (
        <p className='text-xs text-muted-foreground'>
          Auto-generated from {generateFrom}
        </p>
      )}
    </div>
  )
}
