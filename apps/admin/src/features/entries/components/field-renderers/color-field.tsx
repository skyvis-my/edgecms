import { Input } from '@/components/ui/input'
import type { FieldTypeProps } from './types'

export function ColorField({
  fieldId,
  currentValue,
  onChange,
  disabled,
}: FieldTypeProps) {
  const colorValue = (currentValue as string) || '#000000'

  return (
    <div className='flex items-center gap-3'>
      <input
        id={fieldId}
        type='color'
        value={colorValue}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className='h-10 w-10 cursor-pointer rounded border border-input bg-transparent p-1'
      />
      <Input
        type='text'
        value={colorValue}
        onChange={(e) => onChange(e.target.value)}
        placeholder='#000000'
        disabled={disabled}
        className='w-32 font-mono uppercase'
      />
    </div>
  )
}
