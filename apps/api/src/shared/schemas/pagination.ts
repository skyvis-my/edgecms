import { Type, createSchema } from './typebox'

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
export const cursorPaginationParams = createSchema(
  Type.Object({
    cursor: Type.Optional(Type.String()),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  })
)

export type CursorPaginationParams = typeof cursorPaginationParams.infer

/**
 * Offset-based pagination parameters (request).
 * - page: 1-indexed page number
 * - perPage: items per page (1..100)
 */
export const offsetPaginationParams = createSchema(
  Type.Object({
    page: Type.Optional(Type.Integer({ minimum: 1 })),
    perPage: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  })
)

export type OffsetPaginationParams = typeof offsetPaginationParams.infer

/**
 * Pagination metadata included in API responses.
 * Covers both cursor-based and offset-based result sets.
 */
export const paginationMeta = createSchema(
  Type.Object({
    total: Type.Integer({ minimum: 0 }),
    page: Type.Optional(Type.Integer({ minimum: 1 })),
    perPage: Type.Optional(Type.Integer({ minimum: 1 })),
    cursor: Type.Optional(Type.String()),
    hasMore: Type.Boolean(),
  })
)

export type PaginationMeta = typeof paginationMeta.infer
