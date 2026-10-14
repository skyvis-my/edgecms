export type ServiceResult<
  T,
  E extends { code: string; message: string } = { code: string; message: string },
> =
  | { success: true; data: T }
  | { success: false; error: E }

export type ServiceResponseOptions = {
  successStatus?: number
  errorStatusMap?: Record<string, number>
  defaultErrorStatus?: number
}

/**
 * Standard utility to map a ServiceResult to an HTTP status and response envelope.
 * Preserves E2E type inference for Eden clients.
 */
export function toServiceResponse<
  T,
  E extends { code: string; message: string },
>(
  set: { status?: number | string | unknown },
  result: ServiceResult<T, E>,
  options?: ServiceResponseOptions
): ServiceResult<T, E> {
  if (!result.success) {
    const status =
      options?.errorStatusMap?.[result.error.code] ??
      (result.error.code === 'NOT_FOUND'
        ? 404
        : result.error.code === 'CONFLICT' ||
            result.error.code === 'MANAGED_SCHEMA_IMMUTABLE'
          ? 409
          : result.error.code === 'UNAUTHORIZED'
            ? 401
            : result.error.code === 'FORBIDDEN'
              ? 403
              : (options?.defaultErrorStatus ?? 400))
    set.status = status
    return result
  }

  if (options?.successStatus) {
    set.status = options.successStatus
  }
  return result
}

export function createErrorEnvelope<C extends string = string>(
  code: C,
  message: string,
  details?: unknown
) {
  return {
    success: false as const,
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
    },
  }
}
