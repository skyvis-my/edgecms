import { toast } from 'sonner'
import { ApiClientError } from './api-error'

export function handleServerError(error: unknown) {
  let errMsg = 'Something went wrong!'

  if (error && typeof error === 'object' && 'status' in error && Number(error.status) === 204) {
    errMsg = 'Content not found.'
  }

  if (error instanceof ApiClientError) {
    if (error.status === 204) {
      errMsg = 'Content not found.'
    } else if (error.message) {
      errMsg = error.message
    }
  }

  toast.error(errMsg)
}
