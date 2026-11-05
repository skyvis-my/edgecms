import { useMutation, useQueryClient } from '@tanstack/react-query'
import { edenGet, edenPost } from '@/lib/eden-client'
import { tenantsKeys } from './api'

/**
 * HS-09 tenant offboarding client. The direct `DELETE /admin/tenants/:slug`
 * is retired (it returns 409 `TENANT_OFFBOARDING_REQUIRED`); deletion is
 * request -> export -> typed confirmation. These calls are online-only on
 * purpose: a destructive step must never wait in the offline queue.
 */

export type TenantDeletionStatus = 'requested' | 'confirmed' | 'completed' | 'cancelled'

export type TenantDeletionJob = {
  id: string
  tenantId: string
  tenantSlug: string
  tenantName: string
  status: TenantDeletionStatus
  done: boolean
  requestedAt: string
  exportId: string | null
  counts: Record<string, number>
  lastError: string | null
}

export type TenantExport = {
  exportId: string
  filename: string
  text: string
}

function deletionPath(jobId: string, action?: 'confirm' | 'resume' | 'cancel') {
  const base = `/admin/tenant-deletions/${encodeURIComponent(jobId)}`
  return action ? `${base}/${action}` : base
}

/** Read the export id from the NDJSON header line. */
export function parseTenantExportId(ndjson: string): string | null {
  const newline = ndjson.indexOf('\n')
  const firstLine = newline === -1 ? ndjson : ndjson.slice(0, newline)
  try {
    const header = JSON.parse(firstLine) as { type?: unknown; exportId?: unknown }
    return header.type === 'header' && typeof header.exportId === 'string' ? header.exportId : null
  } catch {
    return null
  }
}

/** Download the tenant's NDJSON archive. Its export id is needed to confirm deletion. */
export async function fetchTenantExport(slug: string): Promise<TenantExport> {
  const payload = await edenGet<unknown>(`/admin/tenants/${encodeURIComponent(slug)}/export`)
  // A one-line archive parses as JSON; re-serialise so the header is readable.
  const text = typeof payload === 'string' ? payload : `${JSON.stringify(payload)}\n`
  const exportId = parseTenantExportId(text)
  if (!exportId) throw new Error('Export did not include an export id')
  return { exportId, filename: `tenant-${slug}-${exportId}.ndjson`, text }
}

export function saveTenantExport(file: TenantExport) {
  const blob = new Blob([file.text], { type: 'application/x-ndjson' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = file.filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Revoking synchronously can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Step 1: open (or reuse) a deletion job. Suspends an active tenant; deletes nothing. */
export function useRequestTenantDeletion() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (slug: string) =>
      edenPost<TenantDeletionJob>(`/admin/tenants/${encodeURIComponent(slug)}/deletion-requests`),
    onSuccess: (job) => {
      queryClient.invalidateQueries({ queryKey: tenantsKeys.all })
      queryClient.invalidateQueries({ queryKey: tenantsKeys.detail(job.tenantSlug) })
    },
  })
}

/** Step 2: confirm with the exact slug and an export id taken after the request. */
export function useConfirmTenantDeletion() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { jobId: string; tenantSlug: string; exportId: string }) =>
      edenPost<TenantDeletionJob>(deletionPath(input.jobId, 'confirm'), {
        tenantSlug: input.tenantSlug,
        exportId: input.exportId,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tenantsKeys.all }),
  })
}

/** Continue a confirmed job that ran out of budget. */
export function useResumeTenantDeletion() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (jobId: string) => edenPost<TenantDeletionJob>(deletionPath(jobId, 'resume')),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tenantsKeys.all }),
  })
}

/** Cancel before confirmation; restores the tenant's previous status. */
export function useCancelTenantDeletion() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (jobId: string) => edenPost<TenantDeletionJob>(deletionPath(jobId, 'cancel')),
    onSuccess: (job) => {
      queryClient.invalidateQueries({ queryKey: tenantsKeys.all })
      queryClient.invalidateQueries({ queryKey: tenantsKeys.detail(job.tenantSlug) })
    },
  })
}
