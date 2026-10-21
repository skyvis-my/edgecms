import { auditService } from '@/audit/audit.service'
import type { Database } from '@/database/db'
import { createMigratedTestDb } from '../audit/audit-test-db'

const NOW = '2026-01-01T00:00:00.000Z'
const EPOCH = 1767225600

/**
 * Two tenants, three users. alice co-owns t1 with bob and authored content,
 * commands and audit events; carol is the only owner of t2.
 */
export async function createPrivacyFixture(): Promise<{
  db: Database
  sqlite: ReturnType<typeof createMigratedTestDb>['sqlite']
}> {
  const { db, sqlite } = createMigratedTestDb()
  sqlite.exec(`
    INSERT INTO tenants (id, slug, name, createdAt, updatedAt) VALUES
      ('t1', 'one', 'Tenant One', '${NOW}', '${NOW}'),
      ('t2', 'two', 'Tenant Two', '${NOW}', '${NOW}');
    INSERT INTO user (id, name, email, createdAt, updatedAt, role) VALUES
      ('alice', 'Alice Example', 'alice@example.com', ${EPOCH}, ${EPOCH}, 'editor'),
      ('bob', 'Bob', 'bob@example.com', ${EPOCH}, ${EPOCH}, 'viewer'),
      ('carol', 'Carol', 'carol@example.com', ${EPOCH}, ${EPOCH}, 'viewer');
    INSERT INTO tenant_users (tenantId, userId, role, createdAt) VALUES
      ('t1', 'alice', 'owner', '${NOW}'),
      ('t1', 'bob', 'owner', '${NOW}'),
      ('t2', 'alice', 'member', '${NOW}'),
      ('t2', 'carol', 'owner', '${NOW}');
    INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent, userId) VALUES
      ('s1', ${EPOCH + 86400}, 'secret-session-token', ${EPOCH}, ${EPOCH}, '203.0.113.7', 'UA', 'alice'),
      ('s2', ${EPOCH + 86400}, 'bob-session-token', ${EPOCH}, ${EPOCH}, NULL, NULL, 'bob');
    INSERT INTO account (id, accountId, providerId, userId, accessToken, refreshToken, password, createdAt, updatedAt) VALUES
      ('acc1', 'alice', 'credential', 'alice', NULL, NULL, 'hashed-password', ${EPOCH}, ${EPOCH}),
      ('acc2', 'g-123', 'google', 'alice', 'oauth-access-token', 'oauth-refresh-token', NULL, ${EPOCH}, ${EPOCH});
    INSERT INTO verification (id, identifier, value, expiresAt) VALUES
      ('v1', 'alice@example.com', 'verify-token', ${EPOCH + 3600});
    INSERT INTO collections (id, name, slug, fields, supportedLocales, createdAt, updatedAt, tenantId) VALUES
      ('c1', 'Posts', 'posts', '[]', '["en"]', '${NOW}', '${NOW}', 't1');
    INSERT INTO entries (id, collectionId, slug, data, createdAt, updatedAt) VALUES
      ('e1', 'c1', 'hello', '{"title":"Hello by Alice"}', '${NOW}', '${NOW}');
    INSERT INTO entry_versions (id, entryId, version, data, createdBy, createdAt) VALUES
      ('ev1', 'e1', 1, '{"title":"Hello by Alice"}', 'alice', '${NOW}'),
      ('ev2', 'e1', 2, '{"title":"Hello by Alice"}', 'bob', '${NOW}');
    INSERT INTO assets (id, filename, mime_type, size, original_key, created_at, updated_at, tenant_id, created_by) VALUES
      ('a1', 'hero.png', 'image/png', 10, 't1/hero.png', '${NOW}', '${NOW}', 't1', 'alice');
    INSERT INTO ai_import_batches (id, tenant_id, created_by_user_id, intent, created_at, updated_at) VALUES
      ('b1', 't1', 'alice', 'import posts', '${NOW}', '${NOW}');
    INSERT INTO processed_commands (id, commandType, payload, actor, status, executedAt, tenantScope) VALUES
      ('cmd1', 'updateEntry', '{"entryId":"e1"}', '{"userId":"alice","source":"user"}', 'success', '${NOW}', 't1'),
      ('cmd2', 'updateEntry', '{"entryId":"e1"}', '{"userId":"bob","source":"user"}', 'success', '${NOW}', 't1');
  `)
  await auditService.append(db, {
    scope: 't1',
    category: 'command',
    action: 'command.executed',
    outcome: 'success',
    actorId: 'alice',
    actorSource: 'user',
    targetType: 'command',
    targetId: 'cmd1',
  })
  await auditService.append(db, {
    scope: 'global',
    category: 'rbac',
    action: 'admin.tenants.put',
    outcome: 'success',
    actorId: 'bob',
    actorSource: 'user',
    targetType: 'user',
    targetId: 'alice',
  })
  return { db, sqlite }
}
