import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import type { ArrayItemSubfield } from '@/features/entries/components/field-renderer-utils'
import {
  arrayValueAsText,
  buildArrayItemDefault,
  parseArrayValue,
} from '@/features/entries/components/field-renderer-utils'
import type { FieldTypeProps } from './types'

type ArrayFieldProps = FieldTypeProps & {
  itemSubfields: ArrayItemSubfield[]
}

function updateItem(
  currentValue: unknown,
  index: number,
  key: string,
  next: unknown,
  onChange: (value: unknown) => void,
) {
  const current = Array.isArray(currentValue)
    ? [...currentValue]
    : []
  const previous = current[index]
  const nextObject =
    previous &&
    typeof previous === 'object' &&
    !Array.isArray(previous)
      ? { ...(previous as Record<string, unknown>), [key]: next }
      : { [key]: next }
  current[index] = nextObject
  onChange(current)
}

function ArrayObjectField({
  fieldId,
  name,
  currentValue,
  onChange,
  disabled,
  itemSubfields,
}: ArrayFieldProps) {
  const items = Array.isArray(currentValue) ? currentValue : []

  return (
    <div className='space-y-3'>
      {items.map((item, itemIndex) => {
        const objectValue =
          item && typeof item === 'object' && !Array.isArray(item)
            ? (item as Record<string, unknown>)
            : {}
        return (
          <div
            key={`${name}-array-object-item-${itemIndex}`}
            className='rounded-md border p-3 space-y-3'
          >
            <div className='flex items-center justify-between'>
              <p className='text-sm font-medium'>
                Item {itemIndex + 1}
              </p>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                className='text-red-600 hover:text-red-600 hover:bg-red-50'
                onClick={() => {
                  const next = [...items]
                  next.splice(itemIndex, 1)
                  onChange(next)
                }}
                disabled={disabled}
              >
                Remove
              </Button>
            </div>

            <div className='grid grid-cols-1 md:grid-cols-2 gap-3'>
              {itemSubfields.map((itemField) => (
                <ArrayObjectSubfield
                  key={`${name}-${itemIndex}-${itemField.name}`}
                  fieldId={fieldId}
                  itemIndex={itemIndex}
                  itemField={itemField}
                  objectValue={objectValue}
                  currentValue={currentValue}
                  onChange={onChange}
                  disabled={disabled}
                />
              ))}
            </div>
          </div>
        )
      })}

      <Button
        type='button'
        variant='outline'
        onClick={() =>
          onChange([
            ...(Array.isArray(currentValue) ? currentValue : []),
            buildArrayItemDefault(itemSubfields),
          ])
        }
        disabled={disabled}
      >
        Add Item
      </Button>
    </div>
  )
}

function ArrayObjectSubfield({
  fieldId,
  itemIndex,
  itemField,
  objectValue,
  currentValue,
  onChange,
  disabled,
}: {
  fieldId: string
  itemIndex: number
  itemField: ArrayItemSubfield
  objectValue: Record<string, unknown>
  currentValue: unknown
  onChange: (value: unknown) => void
  disabled?: boolean
}) {
  const subfieldId = `${fieldId}-${itemIndex}-${itemField.name}`

  return (
    <div className='space-y-1'>
      <Label
        className='text-xs'
        htmlFor={subfieldId}
      >
        {itemField.name}
        {itemField.required ? (
          <>
            <span
              className='ml-1 text-red-500'
              aria-hidden='true'
            >
              *
            </span>
            <span className='sr-only'>required</span>
          </>
        ) : null}
      </Label>
      {itemField.type === 'boolean' ? (
        <Switch
          checked={Boolean(objectValue[itemField.name])}
          onCheckedChange={(next) =>
            updateItem(
              currentValue,
              itemIndex,
              itemField.name,
              next,
              onChange,
            )
          }
          disabled={disabled}
        />
      ) : itemField.type === 'number' ? (
        <Input
          id={subfieldId}
          type='number'
          value={
            typeof objectValue[itemField.name] === 'number'
              ? String(objectValue[itemField.name])
              : ''
          }
          onChange={(event) =>
            updateItem(
              currentValue,
              itemIndex,
              itemField.name,
              event.target.value
                ? Number(event.target.value)
                : null,
              onChange,
            )
          }
          disabled={disabled}
        />
      ) : itemField.type === 'date' ? (
        <Input
          id={subfieldId}
          type='datetime-local'
          value={
            typeof objectValue[itemField.name] === 'string'
              ? new Date(
                  objectValue[itemField.name] as string,
                )
                  .toISOString()
                  .slice(0, 16)
              : ''
          }
          onChange={(event) =>
            updateItem(
              currentValue,
              itemIndex,
              itemField.name,
              event.target.value
                ? new Date(event.target.value).toISOString()
                : null,
              onChange,
            )
          }
          disabled={disabled}
        />
      ) : itemField.type === 'json' ? (
        <Textarea
          id={subfieldId}
          value={
            objectValue[itemField.name] === null ||
            objectValue[itemField.name] === undefined
              ? ''
              : typeof objectValue[itemField.name] === 'string'
                ? (objectValue[itemField.name] as string)
                : JSON.stringify(
                    objectValue[itemField.name],
                    null,
                    2,
                  )
          }
          onChange={(event) =>
            updateItem(
              currentValue,
              itemIndex,
              itemField.name,
              event.target.value,
              onChange,
            )
          }
          rows={4}
          disabled={disabled}
        />
      ) : (
        <Input
          id={subfieldId}
          value={
            typeof objectValue[itemField.name] === 'string'
              ? (objectValue[itemField.name] as string)
              : ''
          }
          onChange={(event) =>
            updateItem(
              currentValue,
              itemIndex,
              itemField.name,
              event.target.value,
              onChange,
            )
          }
          disabled={disabled}
        />
      )}
    </div>
  )
}

function SimpleArrayField({
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
      value={arrayValueAsText(currentValue)}
      onChange={(event) =>
        onChange(parseArrayValue(event.target.value, 'text'))
      }
      placeholder={`Enter one ${name} value per line`}
      rows={6}
      disabled={disabled}
      aria-invalid={!!error}
      aria-describedby={error ? errorId : undefined}
    />
  )
}

export function ArrayField(props: ArrayFieldProps) {
  if (props.itemSubfields.length > 0) {
    return <ArrayObjectField {...props} />
  }
  return <SimpleArrayField {...props} />
}
