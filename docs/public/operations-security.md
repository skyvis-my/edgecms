# Operations and security

This guide covers the audit ledger, personal data requests, rate limits, security headers, media access, and backup and export. It is for operators and developers who run an EdgeCMS deployment and need to know what the Worker records, enforces and leaves to them.

## Audit ledger

Security-relevant actions are appended to the `audit_events` table in the main D1 database. Each tenant has its own hash chain. Sign-ins and super-admin actions on global routes use the `global` chain.

### What is recorded

- Every executed command and transaction as `command.executed`, with success or failure. Dry runs are not recorded. The event stores the command id, type and entity references, not field values. A replayed envelope with the same idempotency key is recorded again with the same command id, so the ledger shows each request, not only the first execution.
- Sign-in, sign-up and sign-out through `/api/auth/*`, including failed sign-ins. Starting a social sign-in is not recorded; its callback is. Only the user id is stored: no email, IP address or user agent. Failed attempts carry no identity.
- Role, membership, tenant, collection schema, webhook, plugin and settings changes under `/api/admin/*` and `/api/tenants/:slug/api/admin/*`, including denied attempts, and every audit export or verification.

Tests for these events are in `apps/api/src/tests/audit/`.

### How tampering is detected

Each event stores `prevHash` and `hash = sha256(prevHash + "\n" + canonicalJson(fields))`. `canonicalJson` sorts keys recursively. The hashed fields are `id`, `scope`, `seq`, `category`, `action`, `outcome`, `actorDigest`, `actorSource`, `targetType`, `targetDigest`, `metadata` and `occurredAt`. The first event links to 64 zeros.

User ids enter the hash only as `sha256("edgecms-audit-subject:" + id)`, so pseudonymizing a user for a deletion request keeps the chain valid.

Verification detects edited, removed or reordered events, and events re-attributed to any id other than a `deleted-user:` pseudonym. The chain is tamper-evident, not tamper-proof: someone with write access to D1 could rewrite the whole chain. Copy the `head` hash returned by each export to storage outside D1.

### Retention

`AUDIT_RETENTION_DAYS` sets retention. The default and minimum is 365. Events older than the window are pruned on every 100th event in a chain and on the first event after a quiet day, so low-volume chains are pruned too. Each pruning is first recorded in the chain as `audit.retention_pruned` with the last removed `seq` and `hash`, so verification can tell retention from deletion.

### Export and verify

Responses are `no-store`, paged by cursor in pages of up to 1000 events, and have secrets and emails redacted from metadata.

```text
GET /api/tenants/:slug/api/admin/audit/export?after=<seq>&limit=<n>
GET /api/tenants/:slug/api/admin/audit/verify
GET /api/admin/audit/export
GET /api/admin/audit/verify
```

The tenant routes are for tenant owners, tenant admins and super-admins. The global routes are for super-admins only.

The older `processed_commands` and `audit_log` tables still back idempotency and sync and are not hash-chained. Audit writes never fail the request they describe; a failed write is logged as `audit_event_write_failed`.

### Redacting payloads

Audit output must not expose secrets. Redact at least `password`, `token`, `secret`, `tenantId` and `tenantSlug`. The shared schema package has a redaction helper that replaces configured fields with `[redacted]`. Each surface that exposes audit data still needs its own redaction test.

## Personal data requests

A signed-in user can export or delete their own personal data from **Settings → Account → Your data**, or through the API. Super-admins can do both for any user.

### Export

```text
GET /api/me/data-export
GET /api/admin/users/:userId/data-export
```

The export contains the account (name, email, role, verification state), linked sign-in methods, sessions (with IP address and user agent), tenant memberships, and authored-by references: entry versions, assets, AI import batches, executed commands and audit events. It never includes password hashes, OAuth tokens, session tokens or verification values. Each reference list is capped at 5,000 rows and has a `truncated` flag.

### Deletion

```text
POST /api/me/data-deletion
POST /api/admin/users/:userId/data-deletion
```

Both require the body `{ "confirm": "DELETE" }`. The self-service route is CSRF-protected. Deletion is refused with `409` while the user is the only owner of a tenant.

Deletion runs in this order, in one D1 batch so a failure leaves nothing half-deleted:

1. Replace the user id with a random `deleted-user:<id>` pseudonym in `entry_versions.createdBy`, `assets.created_by`, `ai_import_batches.created_by_user_id`, `processed_commands.actor`, and the `audit_events` actor and target.
2. Delete sessions, linked accounts, memberships, verification rows (email verification and password reset) and the user.

A second pseudonymization pass catches references written in the meantime. Tenant content (entries, assets, versions) is never deleted or edited.

Each export and deletion is recorded in the global audit chain. The deletion receipt (`privacy.user_deleted`) names only the pseudonym and the row counts; its id, `seq` and `hash` are returned to the caller. Audit chains stay verifiable after pseudonymization.

### Limits

- Personal data typed into content fields is not searched or changed.
- Rows in a tenant's dedicated D1 database are not pseudonymized.
- Webhook delivery payloads, logs and backups outside D1 are out of scope.
- Pseudonymized is not anonymized: someone holding the old user id from another source can still find the matching audit digests.
- Access tokens already issued, and the 5-minute session cookie cache, stay valid until they expire.

## Rate limits

Every API request except health checks and `/api/docs` is rate limited per caller (user, else IP address) and route. The defaults, per minute:

| Category | Routes | Limit |
| --- | --- | --- |
| `auth` | `/api/auth/*`, `/api/csrf` | 30 |
| `ai_command` | `/admin/ai/command`, `/admin/ai/workflow` | 20 |
| `admin_mutation` | Other non-GET `/admin/*` routes | 60 |
| `public_read` | GET `/public/*` | 300 |
| `default` | Everything else | 120 |

Over-limit requests get `429 RATE_LIMITED` with `Retry-After`. Counters live in isolate memory and KV without atomic increments, so under concurrent traffic across isolates the effective limit can be higher. Hosts can set per-tenant limits; see [Hosting seams](hosting-seams.md#per-tenant-rate-limits). Tests are in `apps/api/src/tests/auth/rate-limit.middleware.test.ts`.

## Security headers

API responses include:

```text
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Content-Security-Policy: default-src 'none'; frame-ancestors 'none'
```

The GraphiQL playground gets a looser Content Security Policy so it can load its scripts from `unpkg.com`. HSTS is off unless you set `HSTS_MAX_AGE_SECONDS`; `HSTS_INCLUDE_SUBDOMAINS` and `HSTS_PRELOAD` add the matching directives, and `HSTS_PRELOAD` requires `HSTS_INCLUDE_SUBDOMAINS=true` and a max age of at least `31536000`. Check the headers on your own deployment and custom domain; these docs do not cover a production rollout.

## Media access

Uploads are checked against the tenant's size and dimension limits (`413` and `415` responses). Stored public asset files are served with `Cache-Control: public, max-age=31536000, immutable`. The shared schema package also defines a signed private asset policy (tenant, asset, expiry, signing secret reference), but there is no public route for private assets. See [Media](media.md) and [Public API](public-api.md#public-assets).

## Admin onboarding checklist

A new tenant is ready when you have:

1. Created or selected a tenant.
2. Created a collection.
3. Added an entry.
4. Published the entry.
5. Read it through the tenant-scoped public API.
6. Confirmed media upload, if the content uses media.

Before publishing, check:

- SEO metadata required by the collection or frontend.
- Locale completeness for required localized fields.
- Media the entry references.
- The schedule window, for scheduled publishing.

There is no release calendar or bulk release publishing.

While an editor works on an existing entry, the admin saves the draft in the background every 30 seconds if the form has unsaved changes, sending the version it last saw. It shows a conflict warning when the server's draft version is newer than the editor's version.

## Test fixtures

Local smoke data should include:

- A tenant-scoped public asset with a public asset path.
- A trusted plugin such as `audit-trace`.
- Idempotent seed SQL, so repeated setup does not duplicate tenants, memberships or collections.

## Backup and export

EdgeCMS does not create backups for you. Plan them per environment and record each run:

- The D1 export command and target environment.
- The R2 lifecycle or object export plan.
- The date, time and operator.
- How you would restore or roll back.

See the [Operations guide](../operations-guide.md) for D1 Time Travel and the [Deployment runbook](../deployment-runbook.md) for rollback.

## Data portability

You can export collection schemas (Developer Export) and personal data (above), and preview an import without changing anything. There is no import that applies schema changes or deletes data. Adding one needs schema, migration, tenant isolation and rollback tests.
