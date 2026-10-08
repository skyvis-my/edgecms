import { z } from 'zod'
import { FIELD_TYPES } from '@/features/collections/api/collections-api'
import type {
  CollectionDefinition,
  FieldDefinition,
} from '@/features/collections/api/collections-api'

const ALLOWED_ARRAY_ITEM_TYPES = FIELD_TYPES.filter(
  (type) => type !== 'relation' && type !== 'array'
)

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function hasOwn(object: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key)
}

function normalizeRelationType(field: FieldDefinition): string {
  return (field.options?.relationType as string | undefined) ?? 'one-to-many'
}

function isArrayField(field: FieldDefinition): boolean {
  return field.type === 'array'
}

function isSelectMultiple(field: FieldDefinition): boolean {
  return field.options?.multiple === true
}

function isAllowedArrayItemType(value: unknown): value is FieldDefinition['type'] {
  return (
    typeof value === 'string' &&
    (ALLOWED_ARRAY_ITEM_TYPES as readonly string[]).includes(value)
  )
}

type ArrayItemField = {
  name: string
  type: FieldDefinition['type']
  required: boolean
}

function getArrayItemFields(field: FieldDefinition): ArrayItemField[] {
  const raw = field.options?.itemFields
  if (!Array.isArray(raw)) return []

  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const candidate = item as Record<string, unknown>
      const name = typeof candidate.name === 'string' ? candidate.name.trim() : ''
      const type = typeof candidate.type === 'string' ? candidate.type : 'text'
      const required = candidate.required === true
      if (!name || !isAllowedArrayItemType(type)) return null
      return { name, type: type as FieldDefinition['type'], required }
    })
    .filter((item): item is ArrayItemField => Boolean(item))
}

function parseJsonString(raw: string): unknown {
  const trimmed = raw.trim()
  if (!trimmed) return null
  return JSON.parse(trimmed)
}

function isMeaningfulScalarValue(field: FieldDefinition, value: unknown): boolean {
  if (value === undefined || value === null) return false

  if (field.type === 'boolean') return typeof value === 'boolean'
  if (field.type === 'number') return isFiniteNumber(value)
  if (field.type === 'json') return true
  if (field.type === 'array') {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  }

  if (field.type === 'relation') {
    const relationType = normalizeRelationType(field)
    if (relationType === 'one-to-one') {
      return typeof value === 'string' && value.trim().length > 0
    }
    return (
      Array.isArray(value) &&
      value.length > 0 &&
      value.every((item) => typeof item === 'string' && item.trim().length > 0)
    )
  }

  if (field.type === 'media') {
    if (typeof value === 'string') return value.trim().length > 0
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const assetId = (value as Record<string, unknown>).assetId
    return typeof assetId === 'string' && assetId.trim().length > 0
  }

  if (field.type === 'select') {
    const values = isSelectMultiple(field)
      ? Array.isArray(value)
        ? value
        : []
      : [value]
    return (
      values.length > 0 &&
      values.every((item) => typeof item === 'string' && item.trim().length > 0)
    )
  }

  return typeof value === 'string' && value.trim().length > 0
}

function isMeaningfulValue(field: FieldDefinition, value: unknown): boolean {
  if (isArrayField(field)) {
    return (
      Array.isArray(value) &&
      value.length > 0 &&
      value.every((item) => isMeaningfulScalarValue(field, item))
    )
  }
  return isMeaningfulScalarValue(field, value)
}

function buildScalarFieldSchema(field: FieldDefinition): z.ZodTypeAny {
  switch (field.type) {
    case 'text':
    case 'richtext':
    case 'markdown':
    case 'email':
    case 'url':
    case 'slug':
    case 'color':
      return z.string()
    case 'select':
      if (isSelectMultiple(field)) {
        return z.array(z.string())
      }
      return z.string()
    case 'media':
      return z.union([
        z.string(),
        z.object({
          assetId: z.string().min(1),
          variant: z.string().optional(),
        }),
      ])
    case 'relation': {
      const relationType = normalizeRelationType(field)
      if (relationType === 'one-to-one') {
        return z.string()
      }
      return z.array(z.string())
    }
    case 'number':
      return z.number().finite()
    case 'boolean':
      return z.boolean()
    case 'date':
      return z
        .string()
        .min(1, `${field.name} is required`)
        .refine((value) => !Number.isNaN(Date.parse(value)), {
          message: `${field.name} is invalid`,
        })
    case 'json':
      return z.union([
        z.string().transform((value, ctx) => {
          try {
            return parseJsonString(value)
          } catch {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `${field.name} must be valid JSON`,
            })
            return z.NEVER
          }
        }),
        z.array(z.unknown()),
        z.record(z.string(), z.unknown()),
        z.number().finite(),
        z.boolean(),
        z.null(),
      ])
    case 'array':
      return z.array(z.unknown())
    default:
      return z.string()
  }
}

function buildFieldSchema(field: FieldDefinition): z.ZodTypeAny {
  let schema = buildScalarFieldSchema(field)

  if (isArrayField(field)) {
    const itemFields = getArrayItemFields(field)
    if (itemFields.length > 0) {
      const objectShape: Record<string, z.ZodTypeAny> = {}
      for (const itemField of itemFields) {
        const scalar = buildScalarFieldSchema({
          ...field,
          name: itemField.name,
          type: itemField.type,
          required: itemField.required,
          localizable: false,
          options: {},
        })
        objectShape[itemField.name] = itemField.required ? scalar : scalar.optional().nullable()
      }
      schema = z.array(z.object(objectShape))
    } else {
      schema = z.array(schema)
    }
  }

  if (field.localizable) {
    schema = z.record(z.string(), schema).refine((value) => Object.keys(value).length > 0, {
      message: `${field.name} requires at least one locale`,
    })
  }

  if (field.required) {
    if (field.localizable) {
      schema = schema.refine((value) => {
        const localeMap = value as Record<string, unknown>
        return Object.values(localeMap).some((localeValue) => isMeaningfulValue(field, localeValue))
      }, `${field.name} is required`)
    } else {
      schema = schema.refine(
        (value) => isMeaningfulValue(field, value),
        `${field.name} is required`
      )
    }
    return schema
  }

  return schema.optional().nullable()
}

export function buildEntryFormSchema(fields: CollectionDefinition['fields']) {
  const dataShape: Record<string, z.ZodTypeAny> = {}

  for (const field of fields) {
    dataShape[field.name] = buildFieldSchema(field)
  }

  return z.object({
    slug: z.string().min(1, 'Slug is required'),
    status: z.enum(['draft', 'scheduled', 'published', 'archived']),
    data: z.object(dataShape),
  })
}

function getDefaultScalarValue(field: FieldDefinition): unknown {
  if (isArrayField(field)) return []
  if (field.type === 'boolean') return false
  if (field.type === 'relation') {
    return normalizeRelationType(field) === 'one-to-one' ? '' : []
  }
  if (field.type === 'select' && isSelectMultiple(field)) return []
  if (field.type === 'json') return null
  return ''
}

export function buildInitialEntryData(collection: CollectionDefinition): Record<string, unknown> {
  const defaults: Record<string, unknown> = {}

  for (const field of collection.fields) {
    const baseValue = getDefaultScalarValue(field)
    if (field.localizable) {
      defaults[field.name] = { [collection.defaultLocale]: baseValue }
      continue
    }

    if (isArrayField(field)) {
      defaults[field.name] = []
      continue
    }

    defaults[field.name] =
      field.type === 'boolean'
        ? false
        : field.type === 'relation' || (field.type === 'select' && isSelectMultiple(field))
          ? baseValue
          : null
  }

  return defaults
}

export function getFieldErrorMessage(
  errors: Record<string, unknown> | undefined,
  fieldName: string,
  activeLocale?: string
): string | undefined {
  if (!errors || !hasOwn(errors, fieldName)) return undefined
  const fieldError = errors[fieldName]

  if (fieldError && typeof fieldError === 'object') {
    const directMessage = (fieldError as { message?: unknown }).message
    if (typeof directMessage === 'string' && directMessage.length > 0) return directMessage

    if (activeLocale && hasOwn(fieldError as Record<string, unknown>, activeLocale)) {
      const localeError = (fieldError as Record<string, unknown>)[activeLocale]
      if (localeError && typeof localeError === 'object') {
        const localeMessage = (localeError as { message?: unknown }).message
        if (typeof localeMessage === 'string' && localeMessage.length > 0) return localeMessage
      }
    }
  }

  return undefined
}

export function getAutosaveConflictWarning(args: {
  localVersion: number
  remoteVersion: number
}): string | undefined {
  if (args.remoteVersion <= args.localVersion) return undefined
  return 'Newer draft changes exist. Review the latest version before saving to avoid overwriting editor work.'
}
