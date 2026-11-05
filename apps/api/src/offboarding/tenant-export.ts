import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core'
import { AUDIT_GLOBAL_SCOPE, sha256Hex } from '@/audit/audit-chain'
import { auditService } from '@/audit/audit.service'
import type { Database } from '@/database/db'
import {
  assetVariants,
  assets,
  collections,
  entries,
  entryVersions,
  permissions,
  relations,
  roles,
  schemaSnapshots,
  tenantUsers,
  webhooks,
} from '@/database/schema'
import { logger } from '@/observability/logger'
import type { TenantRow } from '@/tenants/tenants.repository'
import { offboardingRepository, TENANT_EXPORT_ACTION } from './offboarding.repository'

export const TENANT_EXPORT_FORMAT = 'edgecms.tenant-export'
export const TENANT_EXPORT_VERSION = 1
export const TENANT_EXPORT_PAGE_SIZE = 200
export const REDACTED = '[redacted]'

type ExportSection = {
  type: string
  table: SQLiteTable
  tableName: string
  key: SQLiteColumn
  redact?: (row: Record<string, unknown>) => Record<string, unknown>
}

/** Webhook signing secrets and custom header values (often bearer tokens) never leave. */
function redactWebhook(row: Record<string, unknown>): Record<string, unknown> {
  const headers = row.headers as Record<string, unknown> | null | undefined
  return {
    ...row,
    secret: REDACTED,
    headers: headers
      ? Object.fromEntries(Object.keys(headers).map((name) => [name, REDACTED]))
      : headers ?? null,
  }
}

/** Sections in archive order. Parents come before the rows that reference them. */
const SECTIONS: ExportSection[] = [
  { type: 'member', table: tenantUsers, tableName: 'tenant_users', key: tenantUsers.userId },
  { type: 'role', table: roles, tableName: 'roles', key: roles.id },
  { type: 'permission', table: permissions, tableName: 'permissions', key: permissions.id },
  { type: 'collection', table: collections, tableName: 'collections', key: collections.id },
  {
    type: 'schema_snapshot',
    table: schemaSnapshots,
    tableName: 'schema_snapshots',
    key: schemaSnapshots.id,
  },
  { type: 'entry', table: entries, tableName: 'entries', key: entries.id },
  { type: 'entry_version', table: entryVersions, tableName: 'entry_versions', key: entryVersions.id },
  { type: 'relation', table: relations, tableName: 'relations', key: relations.id },
  { type: 'asset', table: assets, tableName: 'assets', key: assets.id },
  { type: 'asset_variant', table: assetVariants, tableName: 'asset_variants', key: assetVariants.id },
  { type: 'webhook', table: webhooks, tableName: 'webhooks', key: webhooks.id, redact: redactWebhook },
]

export type TenantExportOptions = {
  exportId: string
  actorId: string
  requestedBy: 'super_admin' | 'owner'
  retentionDays?: number
  pageSize?: number
  now?: () => Date
}

/**
 * HS-09 tenant export as NDJSON lines (each ends with `\n`).
 *
 * Line 1 is a `header`, then `tenant` (settings), then one line per row in
 * `SECTIONS` order, then a `receipt`. The receipt is written to the global
 * audit chain only after every row was produced, so an interrupted download
 * never yields a usable receipt. `receipt.sha256` is a running digest:
 * `d = sha256hex(d + line)` over every line before the receipt (without its
 * newline), starting from the empty string.
 */
export async function* tenantExportLines(
  db: Database,
  tenant: TenantRow,
  options: TenantExportOptions
): AsyncGenerator<string> {
  const now = options.now ?? (() => new Date())
  const pageSize = options.pageSize ?? TENANT_EXPORT_PAGE_SIZE
  let digest = ''
  const counts: Record<string, number> = {}

  async function line(value: Record<string, unknown>): Promise<string> {
    const text = JSON.stringify(value)
    digest = await sha256Hex(digest + text)
    return `${text}\n`
  }

  yield await line({
    type: 'header',
    format: TENANT_EXPORT_FORMAT,
    version: TENANT_EXPORT_VERSION,
    exportId: options.exportId,
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    exportedAt: now().toISOString(),
    redacted: ['webhook.secret', 'webhook.headers values'],
  })
  yield await line({ type: 'tenant', data: tenant })

  for (const section of SECTIONS) {
    counts[section.type] = 0
    let after: string | null = null
    for (;;) {
      const rows: Record<string, unknown>[] = await offboardingRepository.exportPage(
        db,
        section.table,
        section.tableName,
        section.key,
        tenant.id,
        after,
        pageSize
      )
      for (const row of rows) {
        yield await line({ type: section.type, data: section.redact ? section.redact(row) : row })
      }
      counts[section.type] = (counts[section.type] ?? 0) + rows.length
      if (rows.length < pageSize) break
      after = String(rows[rows.length - 1]![section.key === tenantUsers.userId ? 'userId' : 'id'])
    }
  }

  let receipt
  try {
    receipt = await auditService.append(
      db,
      {
        scope: AUDIT_GLOBAL_SCOPE,
        category: 'privacy',
        action: TENANT_EXPORT_ACTION,
        outcome: 'success',
        actorId: options.actorId,
        actorSource: 'user',
        targetType: 'tenant',
        targetId: tenant.id,
        metadata: {
          exportId: options.exportId,
          tenantSlug: tenant.slug,
          requestedBy: options.requestedBy,
          counts,
          sha256: digest,
        },
      },
      { retentionDays: options.retentionDays }
    )
  } catch (err) {
    logger.error('tenant_export_receipt_failed', {
      tenantId: tenant.id,
      error: err instanceof Error ? err.message : String(err),
    })
    yield `${JSON.stringify({ type: 'error', code: 'RECEIPT_FAILED', message: 'Export receipt could not be recorded; export again' })}\n`
    return
  }

  yield `${JSON.stringify({
    type: 'receipt',
    exportId: options.exportId,
    auditEventId: receipt.id,
    auditSeq: receipt.seq,
    counts,
    sha256: digest,
  })}\n`
}

/** Wrap the line generator as a byte stream; a failure ends the stream with an `error` line. */
export function toNdjsonStream(lines: AsyncGenerator<string>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await lines.next()
        if (next.done) {
          controller.close()
          return
        }
        controller.enqueue(encoder.encode(next.value))
      } catch (err) {
        logger.error('tenant_export_failed', {
          error: err instanceof Error ? err.message : String(err),
        })
        controller.enqueue(
          encoder.encode(
            `${JSON.stringify({ type: 'error', code: 'EXPORT_FAILED', message: 'Export failed; no receipt was issued' })}\n`
          )
        )
        controller.close()
      }
    },
    async cancel() {
      await lines.return(undefined)
    },
  })
}
