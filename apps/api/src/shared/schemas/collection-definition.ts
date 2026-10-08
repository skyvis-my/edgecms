import { type } from 'arktype'
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
export const fieldDefinition = type({
  name: 'string',
  type: fieldType,
  required: 'boolean',
  localizable: 'boolean',
  'options?': 'Record<string, unknown>',
})

export type FieldDefinition = typeof fieldDefinition.infer

/**
 * A collection definition — the top-level content type configuration.
 *
 * - singleton: if true, the collection holds exactly one entry (e.g. site settings)
 * - fields: ordered list of field definitions
 * - defaultLocale: BCP 47 locale tag used as the primary language
 * - supportedLocales: all locale tags this collection supports
 */
export const collectionDefinition = type({
  id,
  name: 'string',
  slug,
  singleton: 'boolean',
  fields: fieldDefinition.array(),
  defaultLocale: 'string',
  supportedLocales: 'string[]',
  'displayName?': 'string',
  'description?': 'string',
  'icon?': 'string',
  'color?': 'string',
  'listFields?': 'string[]',
  'searchFields?': 'string[]',
  'defaultSort?': 'string',
  'defaultSortOrder?': "'asc' | 'desc'",
  createdAt: timestamp,
  updatedAt: timestamp,
})

export type CollectionDefinition = typeof collectionDefinition.infer
