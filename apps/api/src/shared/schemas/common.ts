import { id as sharedId } from '@edgecms/schemas/commands'
import { Type, createSchema } from './typebox'

/**
 * Common reusable TypeBox schemas for EdgeCMS.
 *
 * These provide foundational types used across the entire API:
 * IDs, timestamps, slugs, and other shared primitives.
 */

/**
 * ID type — accepts CUID2 or UUID v4 format strings.
 *
 * CUID2: starts with a lowercase letter, followed by 23+ lowercase alphanumeric chars.
 * UUID v4: standard 8-4-4-4-12 hex format.
 */
export const id = sharedId

export type Id = typeof id.infer

/**
 * ISO 8601 timestamp string (e.g. "2026-01-15T10:30:00.000Z").
 */
export const timestamp = createSchema(
  Type.RegExp(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/)
)

export type Timestamp = typeof timestamp.infer

/**
 * Slug pattern — lowercase alphanumeric with hyphens, no leading/trailing hyphens.
 * Examples: "blog-posts", "my-collection", "page1"
 */
export const slug = createSchema(Type.RegExp(/^[a-z0-9]+(?:-[a-z0-9]+)*$/))

export type Slug = typeof slug.infer
