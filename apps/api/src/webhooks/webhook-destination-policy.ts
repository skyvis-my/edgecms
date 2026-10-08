export type WebhookDestinationPolicy = {
  allowedHosts?: string[]
}

type ValidationResult = { valid: true } | { valid: false; error: string }

function normalizeHost(hostname: string): string {
  const lowered = hostname.trim().toLowerCase()
  if (lowered.startsWith('[') && lowered.endsWith(']')) {
    return lowered.slice(1, -1)
  }
  return lowered
}

function normalizeAllowedHost(hostname: string): string | null {
  const trimmed = hostname.trim().toLowerCase()
  if (!trimmed) return null
  const withoutWildcard = trimmed.startsWith('*.') ? trimmed.slice(2) : trimmed
  const normalized = normalizeHost(withoutWildcard)
  return normalized.length > 0 ? normalized : null
}

function isAllowedHost(hostname: string, allowedHosts: string[]): boolean {
  if (allowedHosts.length === 0) return true
  const normalizedHost = normalizeHost(hostname)
  return allowedHosts.some((allowedHost) => {
    const normalizedAllowed = normalizeAllowedHost(allowedHost)
    if (!normalizedAllowed) return false
    return (
      normalizedHost === normalizedAllowed || normalizedHost.endsWith(`.${normalizedAllowed}`)
    )
  })
}

function isPrivateOrLocalHost(hostname: string): boolean {
  const normalizedHost = normalizeHost(hostname)
  const isPrivateIpv4 =
    normalizedHost.startsWith('10.') ||
    normalizedHost.startsWith('127.') ||
    normalizedHost.startsWith('169.254.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(normalizedHost) ||
    normalizedHost.startsWith('192.168.')
  const isIpv6LocalOrPrivate =
    normalizedHost === '::1' ||
    normalizedHost.startsWith('fc') ||
    normalizedHost.startsWith('fd') ||
    normalizedHost.startsWith('fe80:')
  const isIpv4MappedLoopbackOrPrivate =
    normalizedHost.startsWith('::ffff:') ||
    normalizedHost.startsWith('::ffff:127.') ||
    normalizedHost.startsWith('::ffff:10.') ||
    normalizedHost.startsWith('::ffff:192.168.') ||
    /^::ffff:172\.(1[6-9]|2\d|3[0-1])\./.test(normalizedHost) ||
    normalizedHost.startsWith('::ffff:169.254.')
  const isLocalHost =
    normalizedHost === 'localhost' ||
    normalizedHost.endsWith('.local') ||
    normalizedHost.endsWith('.internal')

  return isPrivateIpv4 || isIpv6LocalOrPrivate || isIpv4MappedLoopbackOrPrivate || isLocalHost
}

export function parseAllowedWebhookHosts(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((value) => normalizeAllowedHost(value))
    .filter((value): value is string => Boolean(value))
}

export function validateWebhookDestination(
  url: string,
  policy: WebhookDestinationPolicy = {}
): ValidationResult {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') {
      return { valid: false, error: 'Webhook URL must use HTTPS protocol' }
    }

    if (parsed.username || parsed.password) {
      return { valid: false, error: 'Webhook URL must not include embedded credentials' }
    }

    if (parsed.port && parsed.port !== '443') {
      return { valid: false, error: 'Webhook URL must use standard HTTPS port 443' }
    }

    if (isPrivateOrLocalHost(parsed.hostname)) {
      return { valid: false, error: 'Webhook URL must not target local or private network hosts' }
    }

    const allowedHosts = policy.allowedHosts ?? []
    if (!isAllowedHost(parsed.hostname, allowedHosts)) {
      return {
        valid: false,
        error: 'Webhook URL host is not in the configured allowed host list',
      }
    }

    return { valid: true }
  } catch {
    return { valid: false, error: 'Invalid URL format' }
  }
}
