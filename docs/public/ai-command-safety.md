# AI command safety

This guide explains how AI-generated content changes are previewed, executed, audited and switched off per tenant. It is for developers building AI features or agents on top of EdgeCMS, and for operators deciding whether a tenant's content may reach an AI provider.

## How AI changes flow

AI features never write to the database directly. They produce command envelopes, the same ones the admin uses, and those go through the command engine. See [Commands](commands.md) for the full command reference.

The safe pattern is two steps:

1. Run the command as a dry run. You get the proposed changes and a preview receipt.
2. Show the preview to a person. If they approve, execute the receipt.

## Preview receipts

A dry run returns a `previewReceipt` id. The receipt record is stored server-side (KV, with an in-memory fallback for local runs) and holds:

- the reviewed command envelopes and a SHA-256 hash of their canonical form (command type, payload, actor and `optimisticVersion`, with object keys sorted; `timestamp` is ignored);
- the user and tenant that created it;
- an expiry 15 minutes after creation.

Execution accepts a receipt only when all of these hold:

| Check | Rejected with |
| --- | --- |
| The receipt exists. | `RECEIPT_NOT_FOUND` |
| It has not expired. | `RECEIPT_EXPIRED` |
| The caller is the user who created it. | `ACTOR_MISMATCH` |
| The request is on the tenant it was created for. | `TENANT_MISMATCH` |
| The commands to run hash to the reviewed hash: same commands, same order, same count. A subset, a repeat or an edited payload fails. | `HASH_MISMATCH` |
| It has not been executed before. | `RECEIPT_ALREADY_USED` |
| The single-use claim was recorded. | `RECEIPT_CLAIM_FAILED` |

Single use is enforced in the database, not in KV. Before anything runs, execution inserts the receipt id into `preview_receipt_redemptions` (migration `0038_preview_receipt_redemptions.sql`). The primary key rejects a second insert, so a replay, two concurrent executions or a stale KV copy of the receipt cannot run the commands twice. If the claim cannot be written, nothing runs.

A claimed receipt is spent even if a command then fails, for example on a version conflict. Run a new dry run and review it again.

Where the error code shows up:

- `POST /api/tenants/:slug/commands` (and the global commands route): `error.code` is `INVALID_PREVIEW_RECEIPT` and `error.details.reason` is the code from the table. The status is `409` for `RECEIPT_ALREADY_USED`, `403` for actor or tenant mismatches, `503` for `RECEIPT_CLAIM_FAILED` and `400` otherwise.
- `/admin/ai/command`: `error.code` is the code from the table, with the same statuses.
- MCP `edgecms_execute_command`: the tool result has `isError: true` and a JSON body `{ "status": "rejected", "error": { "code", "message" } }`.

Receipts are not HMAC-signed tokens: the id is a random lookup key, and every check runs against the stored record.

## Command envelope

Envelopes are defined in `packages/schemas/src/commands.ts`:

| Field | Required | Notes |
| --- | --- | --- |
| `type` | Yes | `createEntry`, `updateEntry`, `deleteEntry`, `bulkUpdate`, `updateSingleton`, `linkRelation`, `unlinkRelation`, `publishNow`, `unpublishNow`, `schedulePublish`, `scheduleUnpublish`, `cancelSchedule` or `transaction`. |
| `payload` | Yes | Command-specific data. |
| `actor` | Yes | `{ userId, source }`. `source` is `admin`, `ai`, `sync` or `scheduler`; AI commands use `ai`. |
| `timestamp` | Yes | ISO timestamp. |
| `dryRun` | No | `true` previews without writing. |
| `optimisticVersion` | No | Rejects the change if the entry's version has moved on. |
| `previewReceipt` | No | Receipt from an earlier dry run. |
| `idempotencyKey` | No | Replays of a real execution with the same key return the first result. Dry runs ignore it. |
| `transactionId` | No | Groups commands in a transaction. |

Unknown command types and missing required payload fields fail schema validation before anything runs.

A valid dry-run envelope:

```json
{
  "type": "updateEntry",
  "payload": { "entryId": "entry-1", "data": { "seoTitle": "Launch" } },
  "actor": { "userId": "ai-agent", "source": "ai" },
  "dryRun": true,
  "timestamp": "2026-06-08T00:00:00.000Z"
}
```

Rejected: unknown command type.

```json
{ "type": "rewriteEverything", "payload": {}, "actor": { "userId": "ai-agent", "source": "ai" }, "timestamp": "2026-06-08T00:00:00.000Z" }
```

Rejected: no `type`, `actor` or `timestamp`, and no `entryId`.

```json
{ "data": { "title": "Missing id" } }
```

## Admin AI routes

```text
POST /api/tenants/:slug/admin/ai/command
POST /api/tenants/:slug/admin/ai/workflow
```

`/ai/command` takes a `prompt` (with optional `context.collectionSlug` and `context.entryId`) or a `previewReceipt`, plus `dryRun`:

- `{ "prompt": "...", "dryRun": true }` generates commands, stores a preview receipt and returns the commands and the `previewReceipt` without writing.
- `{ "previewReceipt": "..." }` executes the stored, reviewed commands without calling the model again. The request cannot change them.
- `{ "previewReceipt": "...", "dryRun": true }` returns the stored commands again without spending the receipt.
- `{ "prompt": "..." }` without `dryRun: true` is rejected with `400 PREVIEW_RECEIPT_REQUIRED`.

The [MCP server](mcp-server.md) works the same way: `edgecms_preview_command` returns a receipt only when the dry run succeeded, and `edgecms_execute_command` accepts only a receipt. If you also pass `command`, it must match the reviewed command exactly.

## AI import review

AI import review is off unless the Worker sets `ENABLE_AI_IMPORT_REVIEW=true`; every route below then returns `404 AI_IMPORT_REVIEW_DISABLED`.

```text
POST  /api/tenants/:slug/admin/ai/import-batches
POST  /api/tenants/:slug/admin/ai/import-batches/:batchId/sources
POST  /api/tenants/:slug/admin/ai/import-batches/:batchId/analyze
GET   /api/tenants/:slug/admin/ai/import-batches/:batchId
PATCH /api/tenants/:slug/admin/ai/suggestions/:suggestionId
POST  /api/tenants/:slug/admin/ai/suggestion-sets/:suggestionSetId/dry-run
POST  /api/tenants/:slug/admin/ai/suggestion-sets/:suggestionSetId/apply
```

Everything before `apply` writes no entries. It writes only the review records (batch, source, suggestion and suggestion-set rows, tenant-scoped) and, for file sources, the uploaded file to R2 under the tenant's `ai-imports/` prefix. Sources expire 30 days after upload. The Worker's cron trigger (every minute, in the same `scheduled()` run as the webhook and side-effect sweeps) cleans them up in bounded batches of up to 100 sources and 50 batches:

- An expired source loses its stored text and media summary and gets `purged_at` set. Its R2 file is deleted only when the key starts with that source's own `<tenant>/ai-imports/<batchId>/` prefix. Any other key is left in R2 and logged as `ai_import_cleanup_r2_prefix_mismatch`. If an R2 delete fails, the source stays unpurged and the next run retries it.
- A batch not updated for 30 days, with no unpurged source left, is deleted with its sources, suggestion sets, suggestions and context-tool invocation rows. Entries already created by `apply` stay; the command log still records them.

An asset source (`{ "kind": "asset", "existingAssetId": "..." }`) must name a live, not deleted, asset of the same tenant. Otherwise the route returns `400 AI_IMPORT_SOURCE_FAILED` with the message `Asset was not found`, and no source is stored.

- `dry-run` runs the accepted suggestions through the command engine as dry runs. When every command passes, it returns a `previewReceipt` (see [Preview receipts](#preview-receipts)) with the `dryRunHash`. No receipt is issued when a dry-run command fails.
- `apply` takes `{ "dryRunHash": "...", "previewReceipt": "..." }`. It runs only the stored dry-run commands, and only after it redeems the receipt. A missing receipt returns `400 AI_IMPORT_APPLY_FAILED`. A rejected receipt returns `INVALID_PREVIEW_RECEIPT` with `err.reason` set to the code from the table, and the status from the table. A set that was already applied cannot be dry-run or applied again.
- Mutating routes need a tenant owner, admin or editor role. Every command also checks `entry:<collection>` grants (PL-03).

The WordPress WXR converter (`stageWordPressImportCommands`) stages `createEntry` dry-run commands from an export. It is a library function: no route accepts a WXR upload yet. It does not expand DTD entities. It rejects exports over 10,000,000 characters or 2,000 items. It keeps only `http`, `https`, `mailto` and relative link and image URLs, and it does not fetch remote media. Imported posts are staged as drafts unless the caller sets `defaultStatus: 'published'`.

## Audit rules

- Show dry-run output to a person before executing.
- Command results have status `success`, `failed` or `dry_run`.
- Every executed command is recorded in the tenant's audit chain with its actor source. Dry runs are not. See [Operations and security](operations-security.md#audit-ledger).
- Plugin AI tools may only generate supported command types. See [Plugin SDK](plugin-sdk.md#ai-tools).
- Rejection messages should tell the reviewer what to fix.
- Schema tests cover the envelope only. Each workflow that executes commands needs its own route or service tests.

## Per-tenant AI switch

Each tenant has an `aiEnabled` setting. While it is off, no content from that tenant is sent to an AI provider:

- `/api/tenants/:slug/admin/ai/*` (AI commands, workflows and AI import review) returns `403` with code `AI_DISABLED` before any model call.
- Tenant-scoped MCP requests return `403` with JSON-RPC error `-32003`.
- Published entries and asset file names are not embedded, and semantic search returns no vector matches; asset search falls back to keyword search. Embeddings stored while AI was on are kept but not queried.

Requests on global (non-tenant) routes have no switch and keep their current behavior.

### Turn it on or off

Tenant owners, tenant admins and super-admins can change it under **Settings → AI** in the admin, or through the API:

```text
PUT /api/tenants/:slug/admin/settings/ai
```

```json
{ "aiEnabled": false }
```

Each change is recorded in the tenant's audit chain as `settings.ai_enabled` or `settings.ai_disabled`.

### Defaults

New tenants start with AI off. Migration `0033_tenant_ai_enabled.sql` sets existing tenants to on, so upgrading does not change behavior for tenants that already used AI; their owners can turn it off. The local smoke seed inserts its tenant with raw SQL, so it gets the migration default (on).

### Providers

When the switch is on, content can go to these providers. The admin lists them under **Settings → AI**; the source is `AI_CONTENT_PROVIDERS` in `apps/api/src/ai/ai-access.ts`.

| Provider | Operator | Route | Used for |
| --- | --- | --- | --- |
| Qwen | Alibaba Cloud | Cloudflare AI Gateway | AI commands, workflows, import analysis |
| Gemini | Google | Cloudflare AI Gateway | Fallback when Qwen is unavailable |
| Workers AI embeddings | Cloudflare | Workers AI REST API, when `CF_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are set | Semantic search over published entries and asset file names |
