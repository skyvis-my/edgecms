import { type } from 'arktype'

/**
 * Supported CMS field type identifiers.
 *
 * Each field type is a string literal that determines how a field's value
 * is stored, validated, and rendered in the admin UI.
 *
 * - text:      Plain text or short string content
 * - richtext:  HTML or structured rich text content
 * - markdown:  Markdown text content
 * - number:    Integer or floating-point numeric values
 * - boolean:   True/false toggle values
 * - date:      ISO 8601 date or datetime strings
 * - media:     Reference to an uploaded media asset (image, file, etc.)
 * - relation:  Reference to another entry (one-to-one or one-to-many)
 * - json:      Arbitrary JSON data for flexible/unstructured content
 * - select:    Single or multiple choice from predefined options
 * - email:     Email address with validation
 * - url:       URL with validation
 * - slug:      URL-friendly string identifier
 * - color:     Color value (hex, rgb, etc.)
 */
export const fieldType = type(
  "'text' | 'richtext' | 'markdown' | 'number' | 'boolean' | 'date' | 'media' | 'relation' | 'json' | 'array' | 'select' | 'email' | 'url' | 'slug' | 'color'"
)

export type FieldType = typeof fieldType.infer

/**
 * Array of all supported field type values, useful for iteration and validation.
 */
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
] as const satisfies readonly FieldType[]
