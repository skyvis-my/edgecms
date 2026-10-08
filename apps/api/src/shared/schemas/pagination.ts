import { type } from 'arktype'

/**
 * Pagination schemas for EdgeCMS API.
 *
 * Supports both cursor-based and offset-based pagination strategies.
 * Cursor-based is preferred for performance with D1/SQLite, but
 * offset-based is provided for simpler use cases.
 */

/**
 * Cursor-based pagination parameters (request).
 * - cursor: opaque string pointing to the last item of the previous page
 * - limit: maximum number of items to return (1..100, default handled at runtime)
 */
export const cursorPaginationParams = type({
  'cursor?': 'string',
  'limit?': '1 <= number.integer <= 100',
})

export type CursorPaginationParams = typeof cursorPaginationParams.infer

/**
 * Offset-based pagination parameters (request).
 * - page: 1-indexed page number
 * - perPage: items per page (1..100)
 */
export const offsetPaginationParams = type({
  'page?': 'number.integer >= 1',
  'perPage?': '1 <= number.integer <= 100',
})

export type OffsetPaginationParams = typeof offsetPaginationParams.infer

/**
 * Pagination metadata included in API responses.
 * Covers both cursor-based and offset-based result sets.
 */
export const paginationMeta = type({
  total: 'number.integer >= 0',
  'page?': 'number.integer >= 1',
  'perPage?': 'number.integer >= 1',
  'cursor?': 'string',
  hasMore: 'boolean',
})

export type PaginationMeta = typeof paginationMeta.infer
