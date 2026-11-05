import type { Database } from '@/database/db'
import { offboardingRepository } from '@/offboarding/offboarding.repository'
import { TENANT_DELETION_ORDER } from '@/offboarding/tenant-data-map'
import { createMigratedTestDb } from '../audit/audit-test-db'

const NOW = '2026-01-01T00:00:00.000Z'
const EPOCH = 1767225600

/** One row (or more) in every tenant-scoped table for tenant `t`. */
function tenantSeedSql(t: string, slug: string, extraEntries: number): string {
  const entries = Array.from({ length: extraEntries }, (_, i) => `('${t}-e-x${i}', '${t}-c1', 'x${i}', '{"title":"x${i}"}', '${NOW}', '${NOW}')`)
  return `
    INSERT INTO tenants (id, slug, name, status, createdAt, updatedAt) VALUES ('${t}', '${slug}', 'Tenant ${slug}', 'active', '${NOW}', '${NOW}');
    INSERT INTO tenant_users (tenantId, userId, role, createdAt) VALUES ('${t}', 'owner-${t}', 'owner', '${NOW}'), ('${t}', 'shared-user', 'editor', '${NOW}');
    INSERT INTO tenant_resources (tenantId, createdAt, updatedAt) VALUES ('${t}', '${NOW}', '${NOW}');
    INSERT INTO roles (id, tenant_id, name, created_at, updated_at) VALUES ('${t}-role', '${t}', 'editor', '${NOW}', '${NOW}');
    INSERT INTO permissions (id, role_id, subject, action, created_at) VALUES ('${t}-perm', '${t}-role', 'entry:*', 'update', '${NOW}');
    INSERT INTO signup_invites (id, tokenHash, email, tenantId, expiresAt, createdAt) VALUES ('${t}-inv', 'hash-${t}', 'invitee@example.com', '${t}', ${EPOCH}, ${EPOCH});
    INSERT INTO collections (id, name, slug, fields, supportedLocales, createdAt, updatedAt, tenantId) VALUES ('${t}-c1', 'Posts', 'posts', '[{"name":"title","type":"text","required":true,"localizable":false}]', '["en"]', '${NOW}', '${NOW}', '${t}');
    INSERT INTO entries (id, collectionId, slug, data, createdAt, updatedAt) VALUES ('${t}-e1', '${t}-c1', 'hello', '{"title":"Hello ${slug}"}', '${NOW}', '${NOW}'), ('${t}-e2', '${t}-c1', 'world', '{"title":"World ${slug}"}', '${NOW}', '${NOW}')${entries.length ? `, ${entries.join(', ')}` : ''};
    INSERT INTO entry_versions (id, entryId, version, data, createdBy, createdAt) VALUES ('${t}-ev1', '${t}-e1', 1, '{"title":"Hello ${slug}"}', 'owner-${t}', '${NOW}');
    INSERT INTO entries_fts (entry_id, tenant_id, collection_id, locale, title, body) VALUES ('${t}-e1', '${t}', '${t}-c1', 'en', 'Hello', 'Hello ${slug}');
    INSERT INTO relations (id, sourceEntryId, targetEntryId, sourceCollectionId, targetCollectionId, relationType, fieldName, createdAt, updatedAt, tenantId) VALUES ('${t}-rel', '${t}-e1', '${t}-e2', '${t}-c1', '${t}-c1', 'one-to-many', 'related', '${NOW}', '${NOW}', '${t}');
    INSERT INTO schedule_intents (id, entry_id, transition_type, tenant_scope, created_at, updated_at) VALUES ('${t}-si', '${t}-e2', 'publish', '${t}', '${NOW}', '${NOW}');
    INSERT INTO preview_receipt_redemptions (receipt_id, tenant_scope, user_id, commands_hash, redeemed_at) VALUES ('${t}-rcpt', '${t}', 'u-${t}', 'hash', '${NOW}');
    INSERT INTO schema_snapshots (id, tenant_id, schema_version, created_at) VALUES ('${t}-ss', '${t}', 1, '${NOW}');
    INSERT INTO cache_tags (id, tag, snapshotKey, createdAt) VALUES ('${t}-ct1', 't:${t}:c:${t}-c1', '${slug}:snapshot:posts:en:list', '${NOW}'), ('${t}-ct2', 'collection:${t}-c1', '${slug}:snapshot:posts:en:list', '${NOW}');
    INSERT INTO assets (id, filename, mime_type, size, original_key, created_at, updated_at, tenant_id) VALUES ('${t}-a1', 'hero.png', 'image/png', 10, 'tenants/${t}/assets/${t}-a1/original/hero.png', '${NOW}', '${NOW}', '${t}');
    INSERT INTO asset_variants (id, asset_id, variant, format, object_key, created_at) VALUES ('${t}-av1', '${t}-a1', 'thumb', 'webp', 'tenants/${t}/assets/${t}-a1/variants/thumb.webp', '${NOW}');
    INSERT INTO ai_import_batches (id, tenant_id, created_by_user_id, intent, created_at, updated_at) VALUES ('${t}-b1', '${t}', 'owner-${t}', 'import', '${NOW}', '${NOW}');
    INSERT INTO ai_import_sources (id, batch_id, tenant_id, kind, r2_object_key, expires_at, created_at) VALUES ('${t}-src', '${t}-b1', '${t}', 'file', 'imports/${t}/source.docx', '${NOW}', '${NOW}');
    INSERT INTO ai_suggestion_sets (id, batch_id, tenant_id, created_at, updated_at) VALUES ('${t}-set', '${t}-b1', '${t}', '${NOW}', '${NOW}');
    INSERT INTO ai_suggestions (id, suggestion_set_id, tenant_id, operation, created_at, updated_at) VALUES ('${t}-sug', '${t}-set', '${t}', 'update', '${NOW}', '${NOW}');
    INSERT INTO ai_tool_invocations (id, tenant_id, tool_name, status, created_at) VALUES ('${t}-tool', '${t}', 'search', 'ok', '${NOW}');
    INSERT INTO webhooks (id, url, events, secret, headers, created_at, updated_at, tenant_id) VALUES ('${t}-wh', 'https://hooks.example.com/${t}', '["entry.created"]', 'whsec-${t}-signing', '{"Authorization":"Bearer hook-token-${t}"}', '${NOW}', '${NOW}', '${t}');
    INSERT INTO webhook_deliveries (id, webhook_id, event_id, event_type, payload, created_at) VALUES ('${t}-wd', '${t}-wh', 'ev-${t}', 'entry.created', '{}', '${NOW}');
    INSERT INTO webhook_outbox (id, event_id, event_type, payload, tenant_scope, created_at) VALUES ('${t}-wo', 'ob-${t}', 'entry.created', '{}', '${t}', '${NOW}');
    INSERT INTO side_effect_intents (id, command_id, tenant_scope, kind, payload, created_at) VALUES ('${t}-sei', '${t}-cmd', '${t}', 'cdn_purge', '{"tags":[]}', '${NOW}');
    INSERT INTO processed_commands (id, commandType, actor, status, executedAt, tenantScope) VALUES ('${t}-cmd', 'updateEntry', '{"userId":"owner-${t}","source":"user"}', 'success', '${NOW}', '${t}');
    INSERT INTO audit_log (id, commandId, entityType, entityId, action, timestamp) VALUES ('${t}-al', '${t}-cmd', 'entry', '${t}-e1', 'update', '${NOW}');
    INSERT INTO change_log (id, entityType, entityId, commandId, changeType, timestamp, tenantScope) VALUES ('${t}-cl', 'entry', '${t}-e1', '${t}-cmd', 'update', '${NOW}', '${t}');
    INSERT INTO usage_daily (tenant_id, day, metric, value, updated_at) VALUES ('${t}', '2026-01-01', 'entries', 3, '${NOW}');
  `
}

/**
 * Two shared-mode tenants (`t1`/`one`, `t2`/`two`) with a row in every
 * tenant-scoped table, plus users. Foreign keys are enforced like D1.
 */
export function createOffboardingFixture(options: { extraEntries?: number } = {}) {
  const { db, sqlite } = createMigratedTestDb()
  sqlite.exec('PRAGMA foreign_keys = ON')
  sqlite.exec(`
    INSERT INTO user (id, name, email, createdAt, updatedAt, role) VALUES
      ('owner-t1', 'Owner One', 'owner1@example.com', ${EPOCH}, ${EPOCH}, 'viewer'),
      ('owner-t2', 'Owner Two', 'owner2@example.com', ${EPOCH}, ${EPOCH}, 'viewer'),
      ('shared-user', 'Shared', 'shared@example.com', ${EPOCH}, ${EPOCH}, 'viewer');
  `)
  sqlite.exec(tenantSeedSql('t1', 'one', options.extraEntries ?? 0))
  sqlite.exec(tenantSeedSql('t2', 'two', 0))
  return { db, sqlite }
}

/** Rows per tenant-scoped table for one tenant. */
export async function tenantRowCounts(db: Database, tenantId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const rule of TENANT_DELETION_ORDER) {
    counts[rule.table] = await offboardingRepository.countTenantRows(db, rule.table, tenantId)
  }
  return counts
}
