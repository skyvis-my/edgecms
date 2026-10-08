import { type } from 'arktype'

export const fieldType = type(
  "'text' | 'richtext' | 'number' | 'boolean' | 'date' | 'media' | 'relation' | 'json' | 'array'"
)

export const collectionField = type({
  name: 'string > 0',
  type: fieldType,
  required: 'boolean',
  localizable: 'boolean',
  'options?': 'Record<string, unknown>',
})

export const supportedCollectionFieldTypes = [
  'text',
  'richtext',
  'number',
  'boolean',
  'date',
  'media',
  'relation',
  'json',
  'array',
] as const

export const relationFieldOptions = type({
  targetCollectionId: 'string > 0',
  relationType: "'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many'",
})

export const repeatableBlockOptions = type({
  itemFields: collectionField.array(),
  'minItems?': 'number >= 0',
  'maxItems?': 'number >= 1',
})

export const collectionConfig = type({
  name: 'string > 0',
  slug: 'string > 0',
  singleton: 'boolean',
  fields: collectionField.array(),
  'defaultLocale?': 'string > 0',
  'supportedLocales?': type('string > 0').array(),
})

export const collectionConfigSchema = collectionConfig

export type FieldType = typeof fieldType.infer
export type CollectionField = typeof collectionField.infer
export type CollectionConfig = typeof collectionConfig.infer
export type RelationFieldOptions = typeof relationFieldOptions.infer
export type RepeatableBlockOptions = typeof repeatableBlockOptions.infer
