import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import type { FieldTypeProps } from './types'

export function BooleanField({
  fieldId,
  currentValue,
  onChange,
  error,
  errorId,
  disabled,
}: FieldTypeProps) {
  return (
    <div className='flex items-center space-x-2'>
      <Switch
        id={fieldId}
        checked={(currentValue as boolean) || false}
        onCheckedChange={onChange}
        disabled={disabled}
        aria-invalid={!!error}
        aria-describedby={error ? errorId : undefined}
      />
      <Label htmlFor={fieldId} className='font-normal cursor-pointer'>
        {currentValue ? 'Yes' : 'No'}
      </Label>
    </div>
  )
}
