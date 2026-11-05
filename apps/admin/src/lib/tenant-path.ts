/**
 * Prefix admin API paths with the tenant slug for tenant-scoped routing.
 * Global admin routes (tenant management at /admin/tenants, deletion jobs at
 * /admin/tenant-deletions) are never prefixed.
 */
export function prefixTenantPath(path: string, tenantSlug: string | null): string {
  if (!tenantSlug) {
    return path
  }

  // Only transform /admin/* routes
  if (!path.startsWith('/admin/')) {
    return path
  }

  // Never prefix tenant management routes (/admin/tenants or /admin/tenants/*)
  if (path === '/admin/tenants' || path.startsWith('/admin/tenants/')) {
    return path
  }

  // HS-09 tenant deletion jobs are global (control-plane) routes too
  if (path === '/admin/tenant-deletions' || path.startsWith('/admin/tenant-deletions/')) {
    return path
  }

  return path.replace('/admin/', `/tenants/${tenantSlug}/admin/`)
}
