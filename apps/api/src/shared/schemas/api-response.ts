import { Type, createSchema } from './typebox'
import { paginationMeta } from './pagination'

/**
 * Standard API response envelope schemas for EdgeCMS.
 *
 * All API endpoints return responses wrapped in a consistent envelope:
 * - Success responses carry `success: true` with a `data` payload and optional `meta`.
 * - Error responses carry `success: false` with a structured `error` object.
 *
 * The generic data payload is typed as `unknown` at the schema level;
 * individual endpoints narrow it via TypeBox combinators.
 */

/**
 * Response metadata — currently only pagination, but extensible.
 */
export const responseMeta = createSchema(
  Type.Object({
    pagination: Type.Optional(paginationMeta),
  })
)

export type ResponseMeta = typeof responseMeta.infer

/**
 * Successful API response envelope.
 * `data` is `unknown` here; endpoints should intersect with a concrete type.
 */
export const successResponse = createSchema(
  Type.Object({
    success: Type.Literal(true),
    data: Type.Unknown(),
    meta: Type.Optional(responseMeta),
  })
)

export type SuccessResponse = typeof successResponse.infer

/**
 * Structured error detail returned in error responses.
 */
export const apiError = createSchema(
  Type.Object({
    code: Type.String(),
    message: Type.String(),
    details: Type.Optional(Type.Unknown()),
  })
)

export type ApiError = typeof apiError.infer

/**
 * Error API response envelope.
 */
export const errorResponse = createSchema(
  Type.Object({
    success: Type.Literal(false),
    error: apiError,
  })
)

export type ErrorResponse = typeof errorResponse.infer

/**
 * Union of success and error response envelopes.
 * Useful for typing middleware or generic response handlers.
 */
export const apiResponse = createSchema(
  Type.Union([successResponse, errorResponse])
)

export type ApiResponse = typeof apiResponse.infer
