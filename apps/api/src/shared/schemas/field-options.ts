import { Type, createSchema } from './typebox'

/**
 * Field options schemas for structured field configuration.
 *
 * These schemas define the type-specific options that can be applied
 * to different field types in collection definitions.
 */

/** Show when condition for conditional field display */
export const showWhenCondition = createSchema(
  Type.Object({
    operator: Type.Union([
      Type.Literal('eq'),
      Type.Literal('neq'),
      Type.Literal('in'),
      Type.Literal('not_in'),
      Type.Literal('exists'),
    ]),
    value: Type.Optional(
      Type.Union([
        Type.String(),
        Type.Number(),
        Type.Boolean(),
        Type.Array(Type.String()),
      ])
    ),
  })
)

const baseFieldProperties = {
  placeholder: Type.Optional(Type.String()),
  helpText: Type.Optional(Type.String()),
  default: Type.Optional(Type.Union([Type.String(), Type.Number(), Type.Boolean()])),
  dependsOn: Type.Optional(Type.String()),
  showWhen: Type.Optional(showWhenCondition),
}

export const baseFieldOptions = createSchema(Type.Object(baseFieldProperties))

export const textFieldOptions = createSchema(
  Type.Object({
    ...baseFieldProperties,
    minLength: Type.Optional(Type.Integer({ minimum: 0 })),
    maxLength: Type.Optional(Type.Integer({ minimum: 1 })),
    pattern: Type.Optional(Type.String()),
    component: Type.Optional(Type.Union([Type.Literal('input'), Type.Literal('textarea')])),
  })
)

export const numberFieldOptions = createSchema(
  Type.Object({
    ...baseFieldProperties,
    min: Type.Optional(Type.Number()),
    max: Type.Optional(Type.Number()),
    step: Type.Optional(Type.Number()),
  })
)

export const selectFieldOptions = createSchema(
  Type.Object({
    ...baseFieldProperties,
    choices: Type.Array(
      Type.Object({
        value: Type.String(),
        label: Type.String(),
      })
    ),
    multiple: Type.Optional(Type.Boolean()),
  })
)

export const referenceFieldOptions = createSchema(
  Type.Object({
    ...baseFieldProperties,
    relationType: Type.Optional(
      Type.Union([
        Type.Literal('one-to-one'),
        Type.Literal('one-to-many'),
        Type.Literal('many-to-many'),
      ])
    ),
    targetCollectionId: Type.Optional(Type.String()),
    targetCollectionSlug: Type.Optional(Type.String()),
    referencedCollections: Type.Optional(Type.Array(Type.String())),
  })
)

export const markdownFieldOptions = createSchema(Type.Object(baseFieldProperties))

export const emailFieldOptions = createSchema(Type.Object(baseFieldProperties))

export const urlFieldOptions = createSchema(Type.Object(baseFieldProperties))

export const slugFieldOptions = createSchema(
  Type.Object({
    ...baseFieldProperties,
    generateFrom: Type.Optional(Type.String()),
  })
)

export const colorFieldOptions = createSchema(
  Type.Object({
    ...baseFieldProperties,
    format: Type.Optional(
      Type.Union([
        Type.Literal('hex'),
        Type.Literal('rgb'),
        Type.Literal('rgba'),
        Type.Literal('hsl'),
      ])
    ),
  })
)

export const mediaFieldOptions = createSchema(
  Type.Object({
    ...baseFieldProperties,
    accept: Type.Optional(Type.Array(Type.String())),
    maxSizeBytes: Type.Optional(Type.Integer({ minimum: 1 })),
  })
)

const allowedArrayItemTypes = [
  Type.Literal('text'),
  Type.Literal('richtext'),
  Type.Literal('markdown'),
  Type.Literal('number'),
  Type.Literal('boolean'),
  Type.Literal('date'),
  Type.Literal('media'),
  Type.Literal('json'),
  Type.Literal('select'),
  Type.Literal('email'),
  Type.Literal('url'),
  Type.Literal('slug'),
  Type.Literal('color'),
]

const arrayItemFieldSchema = Type.Object({
  name: Type.String(),
  type: Type.Union(allowedArrayItemTypes),
  required: Type.Optional(Type.Boolean()),
})

export const arrayFieldOptions = createSchema(
  Type.Object({
    ...baseFieldProperties,
    itemFields: Type.Optional(Type.Array(arrayItemFieldSchema)),
    minItems: Type.Optional(Type.Integer({ minimum: 0 })),
    maxItems: Type.Optional(Type.Integer({ minimum: 1 })),
  })
)

export type TextFieldOptions = typeof textFieldOptions.infer
export type NumberFieldOptions = typeof numberFieldOptions.infer
export type SelectFieldOptions = typeof selectFieldOptions.infer
export type MarkdownFieldOptions = typeof markdownFieldOptions.infer
export type EmailFieldOptions = typeof emailFieldOptions.infer
export type UrlFieldOptions = typeof urlFieldOptions.infer
export type SlugFieldOptions = typeof slugFieldOptions.infer
export type ColorFieldOptions = typeof colorFieldOptions.infer
export type ReferenceFieldOptions = typeof referenceFieldOptions.infer
export type MediaFieldOptions = typeof mediaFieldOptions.infer
export type ArrayFieldOptions = typeof arrayFieldOptions.infer
export type ShowWhenCondition = typeof showWhenCondition.infer
