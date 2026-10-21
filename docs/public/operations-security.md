# Operations And Security Boundaries

This guide records current local proof boundaries for operations, security, and backup work. It is not deployed proof.

## Smoke Fixtures

Smoke data should include:

- A tenant-scoped public asset fixture with a public asset path.
- A trusted plugin fixture such as `audit-trace`.
- Idempotent seed SQL so repeated local setup does not duplicate tenants, memberships, or collections.

## Admin Readiness Checklists

First-run admin readiness should cover:

- Create or confirm a tenant.
- Create a collection.
- Add an entry.
- Publish the entry.
- Read it through the public API.
- Confirm media upload when the workflow depends on media.

Content modeling empty states should point users to create the first collection or use Developer Export after fields exist. Publish screens should show validation, public-read, and cache/revalidation expectations before operators treat content as live.

The local checklist contract is complete only when tenant selection, collection creation, entry creation, publishing, and tenant-scoped public read are all recorded. UI copy can guide those steps, but it does not prove a deployed onboarding flow.

## Publish Readiness

Publish readiness proof should cover:

- SEO metadata required by the collection or frontend.
- Locale completeness for required localized fields.
- Media references needed by the entry.
- Schedule window expectations for scheduled publishing.

This contract does not claim a full publishing workflow UI or Strapi Releases parity.

## Autosave Conflict Warning

Autosave conflict proof requires both local and remote version numbers. Warn when the remote version is newer than the local optimistic version, and do not overwrite without user confirmation.

## Audit Log Redaction

Audit logs must not expose secrets. Redact at least:

- `password`
- `token`
- `secret`
- `tenantId`
- `tenantSlug`

Do not claim public-safe audit logs unless redaction tests cover the specific surface.
Local schema proof includes a payload redaction helper that replaces configured sensitive fields with `[redacted]`; each runtime audit surface still needs its own focused test before being treated as public-safe.

## Audit Ledger (HS-12)

Security-relevant actions are appended to the `audit_events` table in the main D1 database. Each tenant has its own chain; sign-ins and super-admin actions on global routes use the `global` chain.

Recorded today, with local tests in `apps/api/src/tests/audit/`:

- Every executed command and transaction (`command.executed`, success or failure; dry runs are not recorded). The event stores the command id, type and entity references, not field values. A replayed envelope with the same idempotency key is recorded again with the same command id, so the ledger shows each request, not only the first execution.
- Sign-in, sign-up and sign-out through `/api/auth/*`, including failed sign-ins. Starting a social sign-in is not recorded; its callback is. Only the user id is stored: no email, IP address or user agent. Failed attempts carry no identity.
- Role, membership, tenant, collection schema, webhook, plugin and settings mutations under `/api/admin/*` and `/api/tenants/:slug/api/admin/*`, including denied attempts, and every audit export or verification.

Tamper evidence: each event stores `prevHash` and `hash = sha256(prevHash + "\n" + canonicalJson(fields))`, where `canonicalJson` sorts keys recursively and the hashed fields are `id`, `scope`, `seq`, `category`, `action`, `outcome`, `actorDigest`, `actorSource`, `targetType`, `targetDigest`, `metadata` and `occurredAt`. User ids enter the hash only as `sha256("edgecms-audit-subject:" + id)`, so pseudonymizing them for a deletion request keeps the chain valid. The first event links to 64 zeros. Verification detects edited, removed or reordered events, and events re-attributed to any id other than a `deleted-user:` pseudonym. A chain is tamper-evident, not tamper-proof: someone with write access to D1 could rewrite the whole chain. Hosts should copy the `head` hash returned by each export to storage outside D1.

Retention: `AUDIT_RETENTION_DAYS` (default and minimum 365). Pruning of events older than the window runs on every 100th event in a chain and on the first event after a quiet day, so low-volume chains are pruned too. The pruning is first recorded in the chain (`audit.retention_pruned` with the last removed `seq` and `hash`), so verification can tell retention from deletion.

Export and verification (no-store, cursor pages of up to 1000 events, metadata redacted for secrets and emails):

- `GET /api/tenants/:slug/api/admin/audit/export?after=<seq>&limit=<n>` and `.../audit/verify` for tenant owners, tenant admins and super-admins.
- `GET /api/admin/audit/export` and `/api/admin/audit/verify` for the global chain, super-admins only.

The older `processed_commands` and `audit_log` tables still back idempotency and sync and are not hash-chained. Audit writes never fail the request they describe: a failed write is logged as `audit_event_write_failed`.

## Personal Data Requests (HS-13)

A signed-in user can export or delete their own personal data from **Settings → Account → Your data**, or through the API. Super-admins can do both for any user.

- `GET /api/me/data-export` and `GET /api/admin/users/:userId/data-export` return the account (name, email, role, verification state), linked sign-in methods, sessions (with IP address and user agent), tenant memberships, and authored-by references: entry versions, assets, AI import batches, executed commands and audit events. Password hashes, OAuth tokens, session tokens and verification values are never included. Each reference list is capped at 5,000 rows and carries a `truncated` flag.
- `POST /api/me/data-deletion` and `POST /api/admin/users/:userId/data-deletion` require the body `{ "confirm": "DELETE" }` (the self-service route is CSRF-protected). Deletion is refused with `409` while the user is the only owner of a tenant.
- Deletion first replaces the user id with a random `deleted-user:<id>` pseudonym in `entry_versions.createdBy`, `assets.created_by`, `ai_import_batches.created_by_user_id`, `processed_commands.actor` and `audit_events` actor/target, then deletes sessions, linked accounts, memberships, verification rows (email verification and password reset) and the user, all in one D1 batch so a failure leaves nothing half-deleted. A second pseudonymization pass catches references written meanwhile. Tenant content (entries, assets, versions) is never deleted or edited.
- Each export and deletion is recorded in the global audit chain. The deletion receipt (`privacy.user_deleted`) names only the pseudonym and the row counts; its id, `seq` and `hash` are returned to the caller. Audit chains stay verifiable after pseudonymization.

Limits: personal data typed into content fields is not searched or changed. Rows in a tenant-dedicated D1 database (HS-03 dedicated mode) are not pseudonymized. Webhook delivery payloads, logs and backups outside D1 are out of scope. Pseudonymized is not anonymized: someone holding the old user id from another source can still find the matching audit digests. Already-issued access tokens and the 5-minute session cookie cache stay valid until they expire.

## Rate Limits

Current API rate limit proof lives in `apps/api/src/tests/auth/rate-limit.middleware.test.ts`. Public, admin, and auth limits must stay documented with window and limit values before being treated as stable.
Local schema proof requires positive `windowMs` and `limit` values for each documented surface; this is policy proof only, not production configuration proof.

## Media Access

Media access proof is local unless an operator supplies a deployed receipt. Current schema proof covers upload size and MIME policy, public immutable cache headers, and signed private asset policy shape. Do not claim production upload enforcement, Cloudflare Images parity, or a public private-asset route without focused API tests for that surface.
Image transforms remain deferred until behavior, cost, cache keys, and tenant isolation have focused tests. Current docs must not imply Cloudflare Images-style transforms are shipped.

## Security Headers

Security header proof should include Content Security Policy and frame protection. Do not claim production header coverage until API/admin tests verify the headers on the shipped routes.

## Backup And Export

Local docs can describe the backup/export checklist, but they do not create backup artifacts. Treat local export notes as preparation for an operator-run D1/R2 receipt.

Backup/export proof needs an operator receipt:

- D1 export command and target environment.
- R2 lifecycle or object export plan.
- Date/time and operator.
- Restore or rollback expectation.

Docs-only backup notes do not prove a production backup exists.
No production backup claim is made by this runbook.

## Data Portability

Current portability proof is export, docs, and non-destructive import-preview planning only. Do not claim destructive import apply, migration application, or full data-portability parity until the import path has schema, migration, tenant-isolation, and rollback tests.
