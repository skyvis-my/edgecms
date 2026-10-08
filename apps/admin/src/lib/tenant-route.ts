import { redirect } from '@tanstack/react-router'
import { getCurrentTenantSlug, setCurrentTenantSlug } from '@/features/tenants/api'

const TENANT_SLUG_PATTERN = /^[a-z0-9-]+$/
const TENANT_CANONICAL_PATH_PREFIX = '/tenants/'

export function isTenantManagementPath(pathname: string): boolean {
  return pathname === '/admin/tenants' || pathname.startsWith('/admin/tenants/')
}

export function resolveTenantSlugFromLocation(locationHref: string): string | null {
  const baseOrigin = globalThis.location?.origin ?? 'http://localhost'
  const url = new URL(locationHref, baseOrigin)
  return resolveTenantSlugFromPathname(url.pathname)
}

export function resolveTenantSlugFromPathname(pathname: string): string | null {
  const pathSlug = pathname.startsWith(TENANT_CANONICAL_PATH_PREFIX)
    ? pathname.slice(TENANT_CANONICAL_PATH_PREFIX.length).split('/')[0]
    : null
  if (!pathSlug || !TENANT_SLUG_PATTERN.test(pathSlug)) {
    return null
  }
  return pathSlug
}

export function buildTenantRedirectUrl(path: string, tenantSlug: string): string {
  const baseOrigin = globalThis.location?.origin ?? 'http://localhost'
  const url = new URL(path, baseOrigin)
  const pathname = url.pathname.startsWith('/') ? url.pathname : `/${url.pathname}`
  const existingTenantSlug = resolveTenantSlugFromPathname(pathname)
  const workspacePath = existingTenantSlug
    ? pathname.slice(`${TENANT_CANONICAL_PATH_PREFIX}${existingTenantSlug}`.length) || '/'
    : pathname
  const tenantPath = `${TENANT_CANONICAL_PATH_PREFIX}${tenantSlug}${workspacePath}`
  return `${tenantPath}${url.search}${url.hash}`
}

export function buildTenantAdminUrl(tenantSlug: string): string {
  return buildTenantRedirectUrl('/collections', tenantSlug)
}

function isCanonicalFrontendPath(pathname: string): boolean {
  return (
    pathname === '/admin' ||
    pathname.startsWith('/admin/') ||
    pathname.startsWith(TENANT_CANONICAL_PATH_PREFIX)
  )
}

export function requireActiveTenantSlug(locationHref: string): string {
  const baseOrigin = globalThis.location?.origin ?? 'http://localhost'
  const url = new URL(locationHref, baseOrigin)
  const currentPathWithSearch = `${url.pathname}${url.search}${url.hash}`

  const currentTenantSlug = getCurrentTenantSlug()
  const locationTenantSlug = resolveTenantSlugFromLocation(locationHref)

  if (locationTenantSlug) {
    if (locationTenantSlug !== currentTenantSlug) {
      setCurrentTenantSlug(locationTenantSlug)
    }
    return locationTenantSlug
  }

  if (currentTenantSlug) {
    if (!isCanonicalFrontendPath(url.pathname)) {
      throw redirect({
        to: currentPathWithSearch,
        mask: {
          to: buildTenantRedirectUrl(currentPathWithSearch, currentTenantSlug),
        },
      })
    }
    return currentTenantSlug
  }

  throw redirect({
    to: '/admin/tenants',
    search: {
      reason: 'tenant-required',
      redirect: locationHref,
    },
  })
}
