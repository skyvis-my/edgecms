import { useQuery } from '@tanstack/react-query'
import { ensureAccessToken } from '@/lib/access-token'
import { getSessionIfNeeded } from '@/lib/auth-client'
import type { AdminViewer } from './access'

function decodeBase64Url(segment: string): string {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  return atob(padded)
}

/**
 * Read the tenant role claim from an RBAC access token without verifying it.
 * Display gating only: the API verifies the signature on every request.
 */
export function readTenantRoleClaim(token: string | null, tenantSlug: string): string | null {
  if (!token) return null
  const payloadSegment = token.split('.')[1]
  if (!payloadSegment) return null
  try {
    const claims = JSON.parse(decodeBase64Url(payloadSegment)) as { trl?: unknown; tsl?: unknown }
    if (claims.tsl !== tenantSlug) return null
    return typeof claims.trl === 'string' && claims.trl ? claims.trl : null
  } catch {
    return null
  }
}

async function loadAdminViewer(tenantSlug: string | null): Promise<AdminViewer> {
  const { data } = await getSessionIfNeeded()
  const rawRole = data?.user?.role
  const tenantRole = tenantSlug
    ? readTenantRoleClaim(await ensureAccessToken(tenantSlug), tenantSlug)
    : null
  return {
    globalRole: typeof rawRole === 'string' ? rawRole : null,
    tenantSlug,
    tenantRole,
  }
}

export const adminViewerKeys = {
  viewer: (tenantSlug: string | null) => ['plugin-admin-viewer', tenantSlug ?? ''] as const,
}

/** `null` until the viewer is known, so contributions stay hidden (fail closed). */
export function useAdminViewer(tenantSlug: string | null): AdminViewer | null {
  const { data } = useQuery({
    queryKey: adminViewerKeys.viewer(tenantSlug),
    queryFn: () => loadAdminViewer(tenantSlug),
    staleTime: 60_000,
    retry: false,
  })
  return data ?? null
}
