export type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string } }
