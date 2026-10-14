import { Type, createSchema } from './typebox'

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

export const FIELD_TYPES = [
  'text',
  'richtext',
  'markdown',
  'number',
  'boolean',
  'date',
  'media',
  'relation',
  'json',
  'array',
  'select',
  'email',
  'url',
  'slug',
  'color',
] as const

export type AllFieldType = (typeof FIELD_TYPES)[number]

export const fieldType = createSchema(
  Type.Union([
    Type.Literal('text'),
    Type.Literal('richtext'),
    Type.Literal('number'),
    Type.Literal('boolean'),
    Type.Literal('date'),
    Type.Literal('media'),
    Type.Literal('relation'),
    Type.Literal('json'),
    Type.Literal('array'),
  ])
)

export const collectionField = createSchema(
  Type.Object({
    name: Type.String({ minLength: 1 }),
    type: fieldType,
    required: Type.Boolean(),
    localizable: Type.Boolean(),
    options: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  })
)

export const relationFieldOptions = createSchema(
  Type.Object({
    targetCollectionId: Type.String({ minLength: 1 }),
    relationType: Type.Union([
      Type.Literal('one-to-one'),
      Type.Literal('one-to-many'),
      Type.Literal('many-to-one'),
      Type.Literal('many-to-many'),
    ]),
  })
)

export const repeatableBlockOptions = createSchema(
  Type.Object({
    itemFields: Type.Array(collectionField),
    minItems: Type.Optional(Type.Integer({ minimum: 0 })),
    maxItems: Type.Optional(Type.Integer({ minimum: 1 })),
  })
)

export const collectionConfig = createSchema(
  Type.Object({
    name: Type.String({ minLength: 1 }),
    slug: Type.String({ minLength: 1 }),
    singleton: Type.Boolean(),
    fields: Type.Array(collectionField),
    defaultLocale: Type.Optional(Type.String({ minLength: 1 })),
    supportedLocales: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  })
)

export const collectionConfigSchema = collectionConfig

export type FieldType = typeof fieldType.infer
export type CollectionField = typeof collectionField.infer
export type CollectionConfig = typeof collectionConfig.infer
export type RelationFieldOptions = typeof relationFieldOptions.infer
export type RepeatableBlockOptions = typeof repeatableBlockOptions.infer
