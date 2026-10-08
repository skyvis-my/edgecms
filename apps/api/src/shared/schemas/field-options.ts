import { type } from 'arktype'

/**
 * Field options schemas for structured field configuration.
 *
 * These schemas define the type-specific options that can be applied
 * to different field types in collection definitions.
 */

/** Show when condition for conditional field display */
export const showWhenCondition = type({
  operator: "'eq' | 'neq' | 'in' | 'not_in' | 'exists'",
  'value?': 'string | number | boolean | string[]',
})

export const baseFieldOptions = type({
  'placeholder?': 'string',
  'helpText?': 'string',
  'default?': 'string | number | boolean',
  'dependsOn?': 'string',
  'showWhen?': showWhenCondition,
})

export const textFieldOptions = type({
  '...': baseFieldOptions,
  'minLength?': 'number.integer >= 0',
  'maxLength?': 'number.integer >= 1',
  'pattern?': 'string',
  'component?': "'input' | 'textarea'",
})

export const numberFieldOptions = type({
  '...': baseFieldOptions,
  'min?': 'number',
  'max?': 'number',
  'step?': 'number',
})

export const selectFieldOptions = type({
  '...': baseFieldOptions,
  choices: type({
    value: 'string',
    label: 'string',
  }).array(),
  'multiple?': 'boolean',
})

export const referenceFieldOptions = type({
  '...': baseFieldOptions,
  'relationType?': "'one-to-one' | 'one-to-many' | 'many-to-many'",
  'targetCollectionId?': 'string',
  'targetCollectionSlug?': 'string',
  'referencedCollections?': 'string[]',
})

export const markdownFieldOptions = type({
  '...': baseFieldOptions,
})

export const emailFieldOptions = type({
  '...': baseFieldOptions,
})

export const urlFieldOptions = type({
  '...': baseFieldOptions,
})

export const slugFieldOptions = type({
  '...': baseFieldOptions,
  'generateFrom?': 'string',
})

export const colorFieldOptions = type({
  '...': baseFieldOptions,
  'format?': "'hex' | 'rgb' | 'rgba' | 'hsl'",
})

export const mediaFieldOptions = type({
  '...': baseFieldOptions,
  'accept?': 'string[]',
  'maxSizeBytes?': 'number.integer >= 1',
})

const allowedArrayItemTypesExpression =
  "'text' | 'richtext' | 'markdown' | 'number' | 'boolean' | 'date' | 'media' | 'json' | 'select' | 'email' | 'url' | 'slug' | 'color'"

const arrayItemFieldSchema = type({
  name: 'string',
  type: allowedArrayItemTypesExpression,
  'required?': 'boolean',
})

export const arrayFieldOptions = type({
  '...': baseFieldOptions,
  'itemFields?': arrayItemFieldSchema.array(),
  'minItems?': 'number.integer >= 0',
  'maxItems?': 'number.integer >= 1',
})

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
