import { FIELD_TYPES, type AllFieldType } from '@edgecms/schemas'
import { Type, createSchema } from './typebox'

/**
 * Supported CMS field type identifiers.
 */
export const fieldType = createSchema(
  Type.Union([
    Type.Literal('text'),
    Type.Literal('richtext'),
    Type.Literal('markdown'),
    Type.Literal('number'),
    Type.Literal('boolean'),
    Type.Literal('date'),
    Type.Literal('media'),
    Type.Literal('relation'),
    Type.Literal('json'),
    Type.Literal('array'),
    Type.Literal('select'),
    Type.Literal('email'),
    Type.Literal('url'),
    Type.Literal('slug'),
    Type.Literal('color'),
  ])
)

export type FieldType = AllFieldType
export { FIELD_TYPES }
