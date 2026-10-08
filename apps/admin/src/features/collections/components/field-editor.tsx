import { ArrowDown, ArrowUp, Eye, Plus, Trash } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import {
  type Control,
  Controller,
  type UseFormSetValue,
  useFieldArray,
  useWatch,
} from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  FIELD_TYPES as COLLECTION_FIELD_TYPES,
  type FieldType,
} from '../api/collections-api'
import type { CollectionFormValues } from './collection-form'

type FieldEditorProps = {
  control: Control<CollectionFormValues>
  setValue: UseFormSetValue<CollectionFormValues>
}

const FIELD_TYPE_LABELS = {
  text: 'Text',
  richtext: 'Rich Text',
  markdown: 'Markdown',
  number: 'Number',
  boolean: 'Boolean',
  date: 'Date',
  media: 'Media',
  relation: 'Relation',
  json: 'JSON',
  array: 'Array',
  select: 'Select',
  email: 'Email',
  url: 'URL',
  slug: 'Slug',
  color: 'Color',
} satisfies Record<FieldType, string>

const FIELD_TYPE_OPTIONS = COLLECTION_FIELD_TYPES.map((value) => ({
  value,
  label: FIELD_TYPE_LABELS[value],
}))

const ARRAY_ITEM_FIELD_TYPES = FIELD_TYPE_OPTIONS.filter(
  (item) => item.value !== 'relation' && item.value !== 'array'
)

const CONDITIONAL_ALWAYS_VALUE = '__always__'

export function FieldEditor({ control, setValue }: FieldEditorProps) {
  const { fields, append, remove, move } = useFieldArray({
    control,
    name: 'fields',
  })
  const watchedFields = useWatch({ control, name: 'fields' }) ?? []

  const handleAddField = () => {
    append({
      name: '',
      type: 'text',
      required: false,
      localizable: false,
      options: { component: 'input' },
    })
  }

  const handleMoveUp = (index: number) => {
    if (index > 0) {
      move(index, index - 1)
    }
  }

  const handleMoveDown = (index: number) => {
    if (index < fields.length - 1) {
      move(index, index + 1)
    }
  }

  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-between'>
        <Label className='text-base font-semibold'>Fields</Label>
        <Button type='button' onClick={handleAddField} size='sm' variant='outline'>
          <Plus className='mr-2 size-4' />
          Add Field
        </Button>
      </div>

      {fields.length === 0 && (
        <div className='rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground'>
          No fields yet. Click "Add Field" to create your first field.
        </div>
      )}

      <div className='space-y-3'>
        {fields.map((field, index) => (
          <FieldEditorRow
            key={field.id}
            index={index}
            control={control}
            total={fields.length}
            allFields={watchedFields.map((field, fieldIndex) => ({
              id: fields[fieldIndex]?.id ?? `field-${fieldIndex}`,
              name: field?.name,
              type: field?.type,
            }))}
            onMoveUp={handleMoveUp}
            onMoveDown={handleMoveDown}
            onRemove={remove}
            setValue={setValue}
          />
        ))}
      </div>

      {fields.length > 0 && (
        <Button type='button' onClick={handleAddField} variant='outline' className='w-full'>
          <Plus className='mr-2 size-4' />
          Add Another Field
        </Button>
      )}
    </div>
  )
}

type FieldEditorRowProps = {
  index: number
  control: Control<CollectionFormValues>
  total: number
  allFields: { id: string; name?: string; type?: string }[]
  onMoveUp: (index: number) => void
  onMoveDown: (index: number) => void
  onRemove: (index: number) => void
  setValue: UseFormSetValue<CollectionFormValues>
}

function FieldEditorRow({
  index,
  control,
  total,
  allFields,
  onMoveUp,
  onMoveDown,
  onRemove,
  setValue,
}: FieldEditorRowProps) {
  const fieldName = useWatch({
    control,
    name: `fields.${index}.name`,
  })
  const selectedType = useWatch({
    control,
    name: `fields.${index}.type`,
  })
  const widthValue = useWatch({
    control,
    name: `fields.${index}.options.width`,
  })
  const dependsOnValue = useWatch({
    control,
    name: `fields.${index}.options.dependsOn`,
  })
  const showWhenOperator = useWatch({
    control,
    name: `fields.${index}.options.showWhen.operator`,
  })
  const arrayItemFields =
    (useWatch({
      control,
      name: `fields.${index}.options.itemFields`,
    }) as Array<{ name?: string; type?: string; required?: boolean }> | undefined) ?? []
  const conditionalFieldOptions = useMemo(
    () =>
      allFields
        .filter((_, i) => i !== index)
        .filter((f) => f.name?.trim())
        .map((field) => ({
          id: field.id,
          name: field.name as string,
        })),
    [allFields, index]
  )

  useEffect(() => {
    if (
      dependsOnValue &&
      !conditionalFieldOptions.some((field) => field.name === dependsOnValue)
    ) {
      setValue(`fields.${index}.options.dependsOn`, undefined, { shouldDirty: true })
      setValue(`fields.${index}.options.showWhen`, undefined, { shouldDirty: true })
    }
  }, [conditionalFieldOptions, dependsOnValue, index, setValue])

  const updateArrayItemField = (
    itemIndex: number,
    patch: Partial<{ name: string; type: string; required: boolean }>
  ) => {
    const next = [...arrayItemFields]
    const current = next[itemIndex] ?? { name: '', type: 'text', required: false }
    next[itemIndex] = { ...current, ...patch }
    setValue(`fields.${index}.options.itemFields`, next, { shouldDirty: true })
  }

  const addArrayItemField = () => {
    const next = [...arrayItemFields, { name: '', type: 'text', required: false }]
    setValue(`fields.${index}.options.itemFields`, next, { shouldDirty: true })
  }

  const removeArrayItemField = (itemIndex: number) => {
    const next = arrayItemFields.filter((_, idx) => idx !== itemIndex)
    setValue(`fields.${index}.options.itemFields`, next, { shouldDirty: true })
  }

  return (
    <div className='space-y-4 rounded-lg border border-border/80 bg-card/20 p-4 md:p-5'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='space-y-1'>
          <div className='inline-flex items-center rounded-md border border-border/70 bg-muted/40 px-2 py-1 text-[11px] font-medium text-muted-foreground'>
            Field {index + 1}
          </div>
          <p className='text-sm font-semibold leading-none'>
            {(fieldName as string)?.trim() || 'Untitled field'}
          </p>
        </div>

        <div className='inline-flex items-center rounded-md border border-border/70 bg-background/70 p-1'>
          <Button
            type='button'
            variant='ghost'
            size='icon'
            onClick={() => onMoveUp(index)}
            disabled={index === 0}
            className='size-8'
          >
            <ArrowUp className='size-4' />
            <span className='sr-only'>Move up</span>
          </Button>
          <Button
            type='button'
            variant='ghost'
            size='icon'
            onClick={() => onMoveDown(index)}
            disabled={index === total - 1}
            className='size-8'
          >
            <ArrowDown className='size-4' />
            <span className='sr-only'>Move down</span>
          </Button>
          <Button
            type='button'
            variant='ghost'
            size='icon'
            onClick={() => onRemove(index)}
            className='size-8 text-red-600 hover:bg-red-500/10 hover:text-red-500'
          >
            <Trash className='size-4' />
            <span className='sr-only'>Remove field</span>
          </Button>
        </div>
      </div>

      <div className='grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]'>
        <div className='space-y-4'>
          <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
            <div className='space-y-2'>
              <Label htmlFor={`fields.${index}.name`}>Field Name</Label>
              <Controller
                control={control}
                name={`fields.${index}.name`}
                render={({ field, fieldState }) => (
                  <div>
                    <Input
                      {...field}
                      id={`fields.${index}.name`}
                      placeholder='e.g., title, description'
                    />
                    {fieldState.error && (
                      <p className='mt-1 text-xs text-red-600' role='alert' aria-live='polite'>{fieldState.error.message}</p>
                    )}
                  </div>
                )}
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor={`fields.${index}.type`}>Field Type</Label>
              <Controller
                control={control}
                name={`fields.${index}.type`}
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={(nextType) => {
                      field.onChange(nextType)
                      if (nextType === 'text') {
                        setValue(
                          `fields.${index}.options`,
                          { component: 'input' },
                          { shouldDirty: true }
                        )
                        return
                      }
                      if (nextType === 'relation') {
                        setValue(
                          `fields.${index}.options`,
                          { relationType: 'one-to-many', targetCollectionId: '' },
                          { shouldDirty: true }
                        )
                        return
                      }
                      if (nextType === 'array') {
                        setValue(
                          `fields.${index}.options`,
                          { itemFields: [{ name: '', type: 'text', required: false }] },
                          { shouldDirty: true }
                        )
                        return
                      }
                      setValue(
                        `fields.${index}.options`,
                        nextType === 'media' ? {} : undefined,
                        { shouldDirty: true }
                      )
                    }}
                  >
                    <SelectTrigger id={`fields.${index}.type`}>
                      <SelectValue placeholder='Select type' />
                    </SelectTrigger>
                    <SelectContent>
                      {FIELD_TYPE_OPTIONS.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>

          {selectedType === 'text' && (
            <div className='space-y-2'>
              <Label htmlFor={`fields.${index}.options.component`}>Component</Label>
              <Controller
                control={control}
                name={`fields.${index}.options.component`}
                render={({ field }) => (
                  <Select
                    value={(field.value as string | undefined) ?? 'input'}
                    onValueChange={field.onChange}
                  >
                    <SelectTrigger id={`fields.${index}.options.component`}>
                      <SelectValue placeholder='Select component' />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='input'>Input</SelectItem>
                      <SelectItem value='textarea'>Textarea</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          )}

          {selectedType === 'relation' && (
            <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
              <div className='space-y-2'>
                <Label htmlFor={`fields.${index}.options.relationType`}>Relation Type</Label>
                <Controller
                  control={control}
                  name={`fields.${index}.options.relationType`}
                  render={({ field }) => (
                    <Select
                      value={(field.value as string | undefined) ?? 'one-to-many'}
                      onValueChange={field.onChange}
                    >
                      <SelectTrigger id={`fields.${index}.options.relationType`}>
                        <SelectValue placeholder='Select relation type' />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value='one-to-one'>One to one</SelectItem>
                        <SelectItem value='one-to-many'>One to many</SelectItem>
                        <SelectItem value='many-to-many'>Many to many</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>

              <div className='space-y-2'>
                <Label htmlFor={`fields.${index}.options.targetCollectionId`}>
                  Target Collection ID
                </Label>
                <Controller
                  control={control}
                  name={`fields.${index}.options.targetCollectionId`}
                  render={({ field }) => (
                    <Input
                      id={`fields.${index}.options.targetCollectionId`}
                      value={(field.value as string | undefined) ?? ''}
                      onChange={field.onChange}
                      placeholder='e.g., products, categories'
                    />
                  )}
                />
              </div>
            </div>
          )}

          {selectedType === 'media' && (
            <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
              <div className='space-y-2'>
                <Label htmlFor={`fields.${index}.options.accept`}>Accepted MIME Types</Label>
                <Controller
                  control={control}
                  name={`fields.${index}.options.accept`}
                  render={({ field }) => (
                    <Input
                      id={`fields.${index}.options.accept`}
                      value={Array.isArray(field.value) ? field.value.join(', ') : ''}
                      onChange={(event) => {
                        const accept = event.target.value
                          .split(',')
                          .map((item) => item.trim())
                          .filter(Boolean)
                        field.onChange(accept.length > 0 ? accept : undefined)
                      }}
                      placeholder='image/*, application/pdf'
                    />
                  )}
                />
              </div>

              <div className='space-y-2'>
                <Label htmlFor={`fields.${index}.options.maxSizeBytes`}>
                  Max Size (bytes)
                </Label>
                <Controller
                  control={control}
                  name={`fields.${index}.options.maxSizeBytes`}
                  render={({ field }) => (
                    <Input
                      id={`fields.${index}.options.maxSizeBytes`}
                      type='number'
                      min={1}
                      value={typeof field.value === 'number' ? field.value : ''}
                      onChange={(event) => {
                        const rawValue = event.target.value
                        field.onChange(rawValue ? Number(rawValue) : undefined)
                      }}
                      placeholder='5242880'
                    />
                  )}
                />
              </div>
            </div>
          )}

          {selectedType === 'array' && (
            <div className='space-y-3 rounded-md border p-3'>
              <div>
                <p className='text-sm font-medium'>Array Item Subfields</p>
                <p className='text-xs text-muted-foreground'>
                  Define object shape for each array item ({arrayItemFields.length} subfield
                  {arrayItemFields.length === 1 ? '' : 's'}).
                </p>
              </div>

              {arrayItemFields.map((itemField, itemIndex) => (
                <div
                  key={`array-item-field-${itemField.name ?? ''}-${itemField.type ?? ''}-${itemField.required ? 'required' : 'optional'}`}
                  className='grid grid-cols-1 gap-2 rounded-md border p-3 md:grid-cols-8'
                >
                  <div className='space-y-1 md:col-span-3'>
                    <Label htmlFor={`fields.${index}.options.itemFields.${itemIndex}.name`}>
                      Name
                    </Label>
                    <Input
                      id={`fields.${index}.options.itemFields.${itemIndex}.name`}
                      value={itemField.name ?? ''}
                      onChange={(event) =>
                        updateArrayItemField(itemIndex, { name: event.target.value })
                      }
                      placeholder='e.g., label'
                    />
                  </div>
                  <div className='space-y-1 md:col-span-2'>
                    <Label htmlFor={`fields.${index}.options.itemFields.${itemIndex}.type`}>
                      Type
                    </Label>
                    <Select
                      value={itemField.type ?? 'text'}
                      onValueChange={(value) => updateArrayItemField(itemIndex, { type: value })}
                    >
                      <SelectTrigger id={`fields.${index}.options.itemFields.${itemIndex}.type`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ARRAY_ITEM_FIELD_TYPES.map((item) => (
                          <SelectItem key={`array-subfield-type-${item.value}`} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className='flex items-end md:col-span-2'>
                    <div className='flex items-center gap-2 text-sm'>
                      <Checkbox
                        id={`fields.${index}.options.itemFields.${itemIndex}.required`}
                        checked={Boolean(itemField.required)}
                        onCheckedChange={(checked) =>
                          updateArrayItemField(itemIndex, { required: checked === true })
                        }
                      />
                      <Label
                        htmlFor={`fields.${index}.options.itemFields.${itemIndex}.required`}
                        className='cursor-pointer text-sm font-normal'
                      >
                        Required
                      </Label>
                    </div>
                  </div>
                  <div className='flex items-end justify-end md:col-span-1'>
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon'
                      onClick={() => removeArrayItemField(itemIndex)}
                      className='text-red-600 hover:bg-red-500/10 hover:text-red-500'
                    >
                      <Trash className='size-4' />
                      <span className='sr-only'>Remove subfield</span>
                    </Button>
                  </div>
                </div>
              ))}

              <Button type='button' variant='outline' onClick={addArrayItemField}>
                <Plus className='mr-2 size-4' />
                Add Subfield
              </Button>
            </div>
          )}
        </div>

        <div className='space-y-4 rounded-md border border-border/80 bg-muted/20 p-3'>
          <p className='text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground'>
            Settings
          </p>

          <div className='space-y-3'>
            <div className='flex items-center space-x-2'>
              <Controller
                control={control}
                name={`fields.${index}.required`}
                render={({ field }) => (
                  <Checkbox
                    id={`fields.${index}.required`}
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                )}
              />
              <Label
                htmlFor={`fields.${index}.required`}
                className='cursor-pointer text-sm font-normal'
              >
                Required
              </Label>
            </div>

            <div className='flex items-center space-x-2'>
              <Controller
                control={control}
                name={`fields.${index}.localizable`}
                render={({ field }) => (
                  <Checkbox
                    id={`fields.${index}.localizable`}
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                )}
              />
              <Label
                htmlFor={`fields.${index}.localizable`}
                className='cursor-pointer text-sm font-normal'
              >
                Localizable
              </Label>
            </div>
          </div>

          <div className='space-y-2'>
            <Label htmlFor={`fields.${index}.options.width`}>Field Width</Label>
            <Controller
              control={control}
              name={`fields.${index}.options.width`}
              render={({ field }) => (
                <Select
                  value={
                    (field.value as string | undefined) ??
                    (widthValue as string | undefined) ??
                    'half'
                  }
                  onValueChange={field.onChange}
                >
                  <SelectTrigger id={`fields.${index}.options.width`}>
                    <SelectValue placeholder='Select width' />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='half'>Half</SelectItem>
                    <SelectItem value='full'>Full</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          {/* Conditional Display */}
          <div className='space-y-3 border-t border-border/50 pt-3'>
            <p className='flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground'>
              <Eye className='size-3' />
              Conditional Display
            </p>

            <div className='space-y-2'>
              <Label htmlFor={`fields.${index}.options.dependsOn`}>Show When Field</Label>
              <Controller
                control={control}
                name={`fields.${index}.options.dependsOn`}
                render={({ field }) => (
                  <Select
                    value={(field.value as string | undefined) ?? CONDITIONAL_ALWAYS_VALUE}
                    onValueChange={(value) => {
                      if (value === CONDITIONAL_ALWAYS_VALUE) {
                        field.onChange(undefined)
                        setValue(`fields.${index}.options.showWhen`, undefined, { shouldDirty: true })
                        return
                      }
                      field.onChange(value)
                    }}
                  >
                    <SelectTrigger id={`fields.${index}.options.dependsOn`}>
                      <SelectValue placeholder='Select field...' />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={CONDITIONAL_ALWAYS_VALUE}>Always show</SelectItem>
                      {conditionalFieldOptions
                        .map((f) => (
                          <SelectItem key={f.id} value={f.name}>
                            {f.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            {dependsOnValue ? (
              <div className='space-y-3'>
                <div className='space-y-2'>
                  <Label htmlFor={`fields.${index}.options.showWhen.operator`}>Operator</Label>
                  <Controller
                    control={control}
                    name={`fields.${index}.options.showWhen.operator`}
                    render={({ field }) => (
                      <Select
                        value={(field.value as string | undefined) ?? 'eq'}
                        onValueChange={field.onChange}
                      >
                        <SelectTrigger id={`fields.${index}.options.showWhen.operator`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value='eq'>Equals</SelectItem>
                          <SelectItem value='neq'>Not equals</SelectItem>
                          <SelectItem value='in'>Is one of</SelectItem>
                          <SelectItem value='not_in'>Is not one of</SelectItem>
                          <SelectItem value='exists'>Has any value</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>

                {showWhenOperator !== 'exists' && (
                  <div className='space-y-2'>
                    <Label htmlFor={`fields.${index}.options.showWhen.value`}>Value</Label>
                    <Controller
                      control={control}
                      name={`fields.${index}.options.showWhen.value`}
                      render={({ field }) => (
                        <Input
                          id={`fields.${index}.options.showWhen.value`}
                          value={
                            Array.isArray(field.value)
                              ? (field.value as string[]).join(', ')
                              : ((field.value as string | undefined) ?? '')
                          }
                          onChange={(e) => {
                            const val = e.target.value
                            if (showWhenOperator === 'in' || showWhenOperator === 'not_in') {
                              // For in/not_in, store as array
                              field.onChange(
                                val.split(',').map((v) => v.trim()).filter(Boolean)
                              )
                            } else {
                              field.onChange(val || undefined)
                            }
                          }}
                          placeholder={
                            showWhenOperator === 'in' || showWhenOperator === 'not_in'
                              ? 'value1, value2, value3'
                              : 'Enter value...'
                          }
                        />
                      )}
                    />
                    {(showWhenOperator === 'in' || showWhenOperator === 'not_in') && (
                      <p className='text-xs text-muted-foreground'>
                        Enter multiple values separated by commas
                      </p>
                    )}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
