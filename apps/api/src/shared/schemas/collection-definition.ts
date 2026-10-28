import { Type, createSchema } from './typebox'
import { id, slug, timestamp } from './common'
import { fieldType } from './field-types'

/**
 * Collection and field definition schemas for EdgeCMS.
 *
 * A "collection" is the CMS equivalent of a database table or content type.
 * Each collection has a set of field definitions that describe the shape
 * of its entries, plus locale configuration for i18n support.
 */

/**
 * A single field definition within a collection.
 *
 * - name: machine-readable field identifier
 * - type: one of the supported FieldType values
 * - required: whether the field must have a value on every entry
 * - localizable: whether the field stores per-locale variants
 * - options: type-specific configuration (e.g. min/max for numbers,
 *   allowed formats for media, target collection for relations)
 */
export const fieldDefinition = createSchema(
  Type.Object({
    name: Type.String(),
    type: fieldType,
    required: Type.Boolean(),
    localizable: Type.Boolean(),
    options: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    renamedFrom: Type.Optional(Type.String()),
    defaultValue: Type.Optional(Type.Unknown()),
  })
)

export type FieldDefinition = typeof fieldDefinition.infer

/**
 * A collection definition — the top-level content type configuration.
 *
 * - singleton: if true, the collection holds exactly one entry (e.g. site settings)
 * - fields: ordered list of field definitions
 * - defaultLocale: BCP 47 locale tag used as the primary language
 * - supportedLocales: all locale tags this collection supports
 */
export const collectionDefinition = createSchema(
  Type.Object({
    id,
    name: Type.String(),
    slug,
    singleton: Type.Boolean(),
    fields: Type.Array(fieldDefinition),
    defaultLocale: Type.String(),
    supportedLocales: Type.Array(Type.String()),
    displayName: Type.Optional(Type.String()),
    description: Type.Optional(Type.String()),
    icon: Type.Optional(Type.String()),
    color: Type.Optional(Type.String()),
    listFields: Type.Optional(Type.Array(Type.String())),
    searchFields: Type.Optional(Type.Array(Type.String())),
    defaultSort: Type.Optional(Type.String()),
    defaultSortOrder: Type.Optional(Type.Union([Type.Literal('asc'), Type.Literal('desc')])),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
)

export type CollectionDefinition = typeof collectionDefinition.infer
