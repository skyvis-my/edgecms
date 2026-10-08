import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { FieldTypeProps } from './types'

type Choice = { value: string; label: string }

export function SelectField({
  fieldId,
  currentValue,
  onChange,
  disabled,
  field,
}: FieldTypeProps) {
  const choices = (field.options?.choices as Choice[]) ?? []
  const multiple = field.options?.multiple as boolean | undefined

  if (multiple) {
    // For multiple select, render checkboxes
    const selectedValues = ((currentValue as string[]) ?? []) as string[]

    const toggleValue = (value: string) => {
      if (selectedValues.includes(value)) {
        onChange(selectedValues.filter((v) => v !== value))
      } else {
        onChange([...selectedValues, value])
      }
    }

    return (
      <div className='space-y-2'>
        {choices.map((choice) => (
          <label
            key={choice.value}
            className='flex items-center gap-2 text-sm cursor-pointer'
          >
            <input
              type='checkbox'
              checked={selectedValues.includes(choice.value)}
              onChange={() => toggleValue(choice.value)}
              disabled={disabled}
              className='h-4 w-4 rounded border-gray-300'
            />
            <span>{choice.label}</span>
          </label>
        ))}
      </div>
    )
  }

  return (
    <Select
      value={(currentValue as string) || ''}
      onValueChange={onChange}
      disabled={disabled}
    >
      <SelectTrigger id={fieldId}>
        <SelectValue placeholder={field.options?.placeholder as string} />
      </SelectTrigger>
      <SelectContent>
        {choices.map((choice) => (
          <SelectItem key={choice.value} value={choice.value}>
            {choice.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
