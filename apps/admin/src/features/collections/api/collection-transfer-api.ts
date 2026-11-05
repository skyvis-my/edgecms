import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { AdminViewer } from '@/features/plugins/admin-contributions/access'
import { entriesKeys } from '@/features/entries/api/entries-api'
import { useAdminViewer } from '@/features/plugins/admin-contributions/viewer'
import { edenGet, edenPost } from '@/lib/eden-client'

/**
 * OP-06 collection export and receipt-bound import.
 * Types mirror `apps/api/src/collections/collection-transfer.service.ts`.
 */

export type CollectionExportDocument = {
  format: 'edgecms.collection-export'
  formatVersion: 1
  exportedAt: string
  collection: {
    slug: string
    name: string
    singleton: boolean
    defaultLocale: string
    supportedLocales: string[]
    fields: Array<{ name: string; type: string; required: boolean; localizable: boolean }>
    schemaHash: string
  }
  entries: Array<{ slug: string; status: string; data: Record<string, unknown> }>
  relations: Array<{
    sourceSlug: string
    fieldName: string
    relationType: string
    sortOrder: number
    target: { collectionSlug: string; slug: string }
  }>
  omitted?: { relations: number }
}

export type ImportStrategy = 'skip' | 'update'
export type EntryPlanAction = 'create' | 'update' | 'skip' | 'conflict' | 'invalid'
export type RelationPlanAction = 'link' | 'skip' | 'conflict'
export type ImportOutcome = 'success' | 'failed' | 'not_run'

export type EntryPlanItem = {
  index: number
  slug: string
  action: EntryPlanAction
  reason: string
  entryId?: string
  status?: string
  publish?: boolean
  changedFields?: string[]
  validationErrors?: string[]
  warnings?: string[]
}

export type RelationPlanItem = {
  index: number
  sourceSlug: string
  fieldName: string
  target: { collectionSlug: string; slug: string }
  action: RelationPlanAction
  reason: string
}

export type ImportPreview = {
  collection: { id: string; slug: string }
  strategy: ImportStrategy
  summary: Record<EntryPlanAction, number>
  entries: EntryPlanItem[]
  relations: RelationPlanItem[]
  warnings: string[]
  commandCount: number
  diff: Array<Record<string, unknown>>
  /** Absent when the plan has nothing to run. */
  previewReceipt?: string
  expiresAt?: string
}

export type ImportExecution = {
  status: 'applied' | 'partial_failure' | 'nothing_to_do'
  collection: { id: string; slug: string }
  entries: Array<EntryPlanItem & { outcome?: ImportOutcome; publishOutcome?: ImportOutcome; error?: string }>
  relations: Array<RelationPlanItem & { outcome?: ImportOutcome; error?: string }>
  warnings: string[]
  commandIds: string[]
}

function collectionPath(collectionSlug: string) {
  return `/admin/collections/${encodeURIComponent(collectionSlug)}`
}

export function exportCollection(collectionSlug: string) {
  return edenGet<CollectionExportDocument>(`${collectionPath(collectionSlug)}/export`)
}

export function previewCollectionImport(
  collectionSlug: string,
  input: { document: unknown; strategy: ImportStrategy }
) {
  return edenPost<ImportPreview>(`${collectionPath(collectionSlug)}/import/preview`, input)
}

export function executeCollectionImport(
  collectionSlug: string,
  input: { document: unknown; strategy: ImportStrategy; previewReceipt: string }
) {
  // A 207 (partial failure) is a 2xx, so it resolves with per-entry outcomes.
  return edenPost<ImportExecution>(`${collectionPath(collectionSlug)}/import/execute`, input)
}

/** Largest file the admin reads into memory; the API caps an import at 500 entries. */
export const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024

export type ParsedImportFile = { ok: true; document: unknown } | { ok: false; message: string }

/**
 * Read a chosen file as JSON. Only checks that it parses and looks like an
 * export; the API validates every entry against the target collection.
 */
export async function parseImportFile(file: File): Promise<ParsedImportFile> {
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    return { ok: false, message: 'This file is larger than 10 MB. Split the import into smaller files.' }
  }
  let document: unknown
  try {
    document = JSON.parse(await file.text())
  } catch {
    return { ok: false, message: 'This file is not valid JSON.' }
  }
  if (
    typeof document !== 'object' ||
    document === null ||
    (document as { format?: unknown }).format !== 'edgecms.collection-export'
  ) {
    return {
      ok: false,
      message: 'This file is not an EdgeCMS collection export (format "edgecms.collection-export").',
    }
  }
  return { ok: true, document }
}

export function exportFileName(collectionSlug: string, now: Date = new Date()) {
  return `${collectionSlug}-export-${now.toISOString().slice(0, 10)}.json`
}

/** Save a JSON document through a temporary object URL. */
export function downloadJson(document_: unknown, fileName: string) {
  const blob = new Blob([JSON.stringify(document_, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export type TransferAccess = { canExport: boolean; canImport: boolean }

function normalizeRole(role: string | null): string {
  return (role ?? '').trim().toLowerCase().replace(/[\s_-]/g, '')
}

/**
 * Display gating only; the API enforces PL-03 on every call. Mirrors the
 * built-in roles: owners, admins and editors export and import, members only
 * export, viewers neither. Custom roles may hold `entry:<collection>` grants
 * the admin cannot see, so they get nothing here (fail closed) and use the API.
 */
export function resolveTransferAccess(viewer: AdminViewer | null): TransferAccess {
  if (!viewer) return { canExport: false, canImport: false }
  if (normalizeRole(viewer.globalRole) === 'superadmin') return { canExport: true, canImport: true }
  const role = normalizeRole(viewer.tenantRole)
  if (role === 'owner' || role === 'admin' || role === 'editor') return { canExport: true, canImport: true }
  if (role === 'member') return { canExport: true, canImport: false }
  return { canExport: false, canImport: false }
}

export function useCollectionTransferAccess(tenantSlug: string | null): TransferAccess {
  return resolveTransferAccess(useAdminViewer(tenantSlug))
}

export function useExportCollection() {
  return useMutation({
    mutationFn: async (collectionSlug: string) => {
      const document_ = await exportCollection(collectionSlug)
      downloadJson(document_, exportFileName(collectionSlug))
      return document_
    },
  })
}

export function usePreviewCollectionImport(collectionSlug: string) {
  return useMutation({
    mutationFn: (input: { document: unknown; strategy: ImportStrategy }) =>
      previewCollectionImport(collectionSlug, input),
  })
}

export function useExecuteCollectionImport(collectionSlug: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { document: unknown; strategy: ImportStrategy; previewReceipt: string }) =>
      executeCollectionImport(collectionSlug, input),
    // Partial failures keep completed commands, so refresh in every case.
    onSettled: () => queryClient.invalidateQueries({ queryKey: entriesKeys.all }),
  })
}
