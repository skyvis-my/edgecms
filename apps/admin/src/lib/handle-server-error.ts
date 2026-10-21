import { toast } from 'sonner'
import { ApiClientError, getLimitErrorInfo } from './api-error'

const LIMIT_DIMENSION_LABELS: Record<string, string> = {
  commands: 'content changes',
  entries: 'entries',
  media_bytes: 'media storage',
  ai_tokens: 'AI usage',
  tenants: 'workspaces',
}

function showLimitError(error: ApiClientError): boolean {
  const limit = getLimitErrorInfo(error)
  if (!limit) return false
  const label = limit.dimension
    ? (LIMIT_DIMENSION_LABELS[limit.dimension] ?? limit.dimension.replace(/_/g, ' '))
    : ''
  const title =
    limit.kind === 'quota'
      ? `Plan limit reached${label ? ` for ${label}` : ''}`
      : `Too many requests${label ? ` (${label})` : ''}`
  const description =
    limit.kind === 'rate' && limit.retryAfterSeconds
      ? `Try again in ${limit.retryAfterSeconds}s.`
      : error.message
  const upgradeUrl = limit.upgradeUrl
  toast.error(title, {
    description,
    ...(upgradeUrl && {
      action: {
        label: 'Upgrade',
        onClick: () => window.open(upgradeUrl, '_blank', 'noopener,noreferrer'),
      },
    }),
  })
  return true
}

export function handleServerError(error: unknown) {
  let errMsg = 'Something went wrong!'

  if (error && typeof error === 'object' && 'status' in error && Number(error.status) === 204) {
    errMsg = 'Content not found.'
  }

  if (error instanceof ApiClientError) {
    if (showLimitError(error)) return
    if (error.status === 204) {
      errMsg = 'Content not found.'
    } else if (error.message) {
      errMsg = error.message
    }
  }

  toast.error(errMsg)
}
