# Commands Guide

Every content mutation in EdgeCMS is a typed command (PRD `CMD-01`). The admin UI, AI features, MCP tools and the scheduler all send the same command envelope to one engine (`apps/api/src/commands/engine.ts`). This guide covers the envelope, each command type, how to call the route, duplicate suppression, errors, and how AI and MCP build envelopes.

Related guides: [content model](content-model.md), [webhooks](webhooks.md), [AI command safety](ai-command-safety.md), [MCP server](mcp-server.md), [auth and access](auth-and-access.md).

## The Route

```text
POST /api/tenants/:tenantSlug/admin/commands
POST /api/admin/commands
```

Use the tenant route. The global route runs without a tenant scope: it acts on `global` content and its webhook events go to global webhooks.

Auth: the route requires a signed-in user (`auth: true`) whose role can write to the admin API: editor, admin or owner on the tenant, or editor/admin on global routes. Viewers and members get `403`. There is no per-command permission check; any role that can write can send any command type. See [auth and access](auth-and-access.md) for sessions, CSRF and bearer tokens.

## The Envelope

The envelope schema is `commandEnvelope` in `packages/schemas/src/commands.ts`. The route validates the same fields (`apps/api/src/commands/commands.controller.ts`).

| Field | Type | Notes |
| --- | --- | --- |
| `type` | string | One of the 13 command types below. |
| `payload` | object | Command-specific. Checked by the handler, not by the route schema. |
| `actor.userId` | string | Required, but the route replaces it with the signed-in user's ID. |
| `actor.source` | `admin`, `ai`, `sync` or `scheduler` | Kept as sent. Recorded in audit rows and webhook metadata. |
| `optimisticVersion` | integer ≥ 1 | Optional. Used by `updateEntry` only. |
| `transactionId` | string | Optional. The engine sets it on each sub-command of a `transaction`. |
| `dryRun` | boolean | Optional. Preview without writing. |
| `previewReceipt` | string | Optional. Ties execution to a reviewed dry run. |
| `idempotencyKey` | string | Optional. Also accepted as the `Idempotency-Key` header, which wins. |
| `timestamp` | string | Required. Client time; the engine uses its own time for records. |

A body that fails the route schema returns `422 VALIDATION_ERROR` before the engine runs (PRD `CMD-02`).

## Command Types

| Type | Payload | Webhook event |
| --- | --- | --- |
| `createEntry` | `collectionId`, `data`, optional `slug`, `status` (`draft` or `archived`) | `entry.created` |
| `updateEntry` | `entryId`, optional `slug`, `status`, `data` | `entry.updated` |
| `deleteEntry` | `entryId` | `entry.deleted` |
| `bulkUpdate` | `entryIds` (1–100), `updates: { status?, data? }` | `entry.bulk_updated` |
| `updateSingleton` | `collectionId`, `data` | `entry.updated` |
| `linkRelation` | `sourceEntryId`, `targetEntryId`, `sourceCollectionId`, `targetCollectionId`, `relationType`, `fieldName`, optional `sortOrder` | `relation.linked` |
| `unlinkRelation` | `sourceEntryId`, `targetEntryId`, `fieldName` | `relation.unlinked` |
| `publishNow` | `entryId` | `entry.published` |
| `unpublishNow` | `entryId` | `entry.unpublished` |
| `schedulePublish` | `entryId`, `publishAt` | `entry.scheduled` |
| `scheduleUnpublish` | `entryId`, `unpublishAt` | `entry.scheduled` |
| `cancelSchedule` | `entryId` | none |
| `transaction` | `commands`: array of envelopes | none (each sub-command emits its own) |

Behavior to know:

- `updateEntry` replaces the whole `data` object. Send every field.
- `createEntry`, `updateEntry` and `bulkUpdate` cannot set or leave `scheduled`/`published`; use the publishing commands. The error is `INVALID_STATUS_TRANSITION` and names the command to use. The full state machine is in the [content model](content-model.md#entry-lifecycle) guide.
- `bulkUpdate` applies the same `updates` to each entry and succeeds if at least one entry updates. The result lists `updated`, `errors`, `totalUpdated` and `totalFailed`. On D1 it writes in batches of 25 entries and does not run the per-field checks that `updateEntry` runs.
- `updateSingleton` creates the singleton entry as `draft` on first use, then updates it.
- `publishNow` also queues the entry for semantic search indexing when the tenant AI switch allows it.
- `cancelSchedule` clears `publishAt` and `unpublishAt`, moves a `scheduled` entry back to `draft`, and returns `schedulerSyncRequired: true` if the scheduler could not be reached.
- `deleteEntry` is a hard delete.

## Optimistic Versions

Send the entry's current `version` as `optimisticVersion` on `updateEntry`. The update only applies when the stored version still matches; otherwise the response is `409 VERSION_CONFLICT` with a message like `Expected version 3 but found 4`. Without `optimisticVersion` the last write wins. Other command types ignore the field.

## Transactions

A `transaction` runs its sub-commands in order:

```json
{
  "type": "transaction",
  "payload": {
    "commands": [
      {
        "type": "createEntry",
        "payload": { "collectionId": "<posts id>", "data": { "title": "Launch notes" } },
        "actor": { "userId": "ignored", "source": "admin" },
        "timestamp": "2026-10-22T09:00:00.000Z"
      },
      {
        "type": "publishNow",
        "payload": { "entryId": "<existing entry id>" },
        "actor": { "userId": "ignored", "source": "admin" },
        "timestamp": "2026-10-22T09:00:00.000Z"
      }
    ]
  },
  "actor": { "userId": "ignored", "source": "admin" },
  "timestamp": "2026-10-22T09:00:00.000Z"
}
```

Rules from `handleTransaction`:

- **Not atomic.** D1 has no interactive transactions. Execution stops at the first failure, and earlier sub-commands stay committed. The error is `TRANSACTION_FAILED` and the message says so. Undo with inverse commands using `data.subResults`.
- Nested transactions and unknown sub-command types are rejected before anything runs (`VALIDATION_ERROR`).
- Sub-commands are validated by their handlers, not by the route schema. Sub-command `actor` values are used as sent; the route only replaces the outer actor.
- Each sub-command is recorded, audited and emits its own webhook event.
- The result has `subResults`, `totalCommands`, `completedCommands` and `failedCommands`.

A later sub-command cannot reference an ID created by an earlier one; payloads are fixed when you send them.

## Dry Run and Diff

Set `dryRun: true` to preview a command (PRD `CMD-03`). The engine computes a field-level diff and writes nothing to content tables:

```json
[
  { "field": "title", "before": "Old Title", "after": "New Title", "action": "update" },
  { "field": "subtitle", "after": "Draft", "action": "add" }
]
```

`action` is `add`, `update` or `remove`. `before` is left out when the field did not exist. `bulkUpdate` diffs prefix fields with the entry ID, for example `[entry-1].status`.

What a dry run does:

- Records a `processed_commands` row with status `dry_run`.
- Creates a preview receipt (stored in KV for 15 minutes) and returns its ID as `previewReceipt`.
- Skips host limit checks and metering.

Limits:

- Diffs are implemented for `createEntry`, `updateEntry`, `deleteEntry`, `bulkUpdate`, `updateSingleton`, `linkRelation`, `unlinkRelation`, `publishNow` and `unpublishNow`. The scheduling commands return an empty diff.
- The diff does not run validation or lifecycle checks. A command can preview cleanly and still fail on execution.
- The `transaction` handler does not read the top-level `dryRun`. A transaction sent with `"dryRun": true` executes its sub-commands. To preview a transaction, set `dryRun: true` on each sub-command.

### Preview receipts

To execute exactly what was previewed, send the same command again with `previewReceipt` set and `dryRun` omitted. The engine checks that the receipt exists, has not expired or been used, belongs to the same user and tenant, and that the command's `type`, `payload`, `actor` and `optimisticVersion` hash to the stored value. A mismatch returns `400 INVALID_PREVIEW_RECEIPT`. The receipt is marked used after success.

Sending `previewReceipt` is optional on this route. Without it, the command runs directly.

## Duplicate Suppression

Send an idempotency key to make retries safe (PRD `CMD-04`):

```text
Idempotency-Key: 6f1c2e8a-post-launch-1
```

The engine uses `idem_<key>` as the command ID and reserves it in `processed_commands` (status `pending`) before running the handler. The table's primary key makes the reservation race-safe. A repeat with the same key:

| Stored state | Result |
| --- | --- |
| `success` | The stored result, without running again. |
| `failed` | The stored error. |
| `dry_run` | The stored diff and receipt. |
| `pending` | `CONCURRENT_REQUEST`. |
| Different `type` or `payload` | `IDEMPOTENCY_CONFLICT`. |

Keys do not expire. A replayed success returns the stored `data`, without cache purge headers. Without a key, every request runs.

The scheduler uses keys of the form `sched_<entryId>_<scheduledAt>_<publish|unpublish>`, so a repeated alarm does not publish twice.

## Responses and Errors

Success:

```json
{ "success": true, "data": { "commandId": "...", "type": "updateEntry", "status": "success", "data": { }, "executedAt": "..." } }
```

`createEntry` returns `201`; every other success and every dry run returns `200`. When cache tags were invalidated, the response carries `Cache-Tag-Purge`, `X-Cache-Tag-Purge` and `CF-Cache-Purge` headers listing them.

Failure:

```json
{ "success": false, "error": { "code": "VERSION_CONFLICT", "message": "Expected version 3 but found 4" } }
```

Status codes from `COMMAND_ERROR_STATUS_MAP`:

| Code | Status |
| --- | --- |
| `VERSION_CONFLICT` | `409` |
| `NOT_FOUND` | `404` |
| `BAD_REQUEST`, `VALIDATION_ERROR`, `INVALID_COMMAND_TYPE`, `UNKNOWN_COMMAND`, `INVALID_TRANSITION`, `INVALID_STATUS_TRANSITION`, `INVALID_PREVIEW_RECEIPT` | `400` |
| `UNAUTHORIZED` | `403` |
| `QUOTA_EXCEEDED` / `RATE_LIMITED` from the host limits policy (`HS-06`) | `402` / `429`, with `error.details` |
| Anything else | `500` |

"Anything else" includes codes handlers return for client mistakes: `DUPLICATE_SLUG`, `DUPLICATE_RELATION`, `CARDINALITY_VIOLATION`, `BULK_UPDATE_FAILED`, `TRANSACTION_FAILED`, `IDEMPOTENCY_CONFLICT` and `CONCURRENT_REQUEST`. Read `error.code`, not only the status.

## What Gets Recorded

For each executed command the engine writes (PRD `CMD-05`):

- a `processed_commands` row (type, payload, actor, result, status, tenant scope);
- `audit_log` rows, one per changed entity;
- `change_log` rows for sync clients;
- a `webhook_outbox` row for the event, in the same D1 batch as the command row;
- a hash-chained audit event (`HS-12`).

After the commit it invalidates KV snapshots by cache tag, purges Cloudflare cache tags, emits the webhook event and, when `FRONTEND_REVALIDATE_URL` is set, posts a revalidation request. These side effects never turn a committed command into a failure. See [webhooks](webhooks.md).

## Example

A dry run of a data update, then the real call. Request:

```http
POST /api/tenants/acme/admin/commands
Content-Type: application/json
Idempotency-Key: post-42-title-v3

{
  "type": "updateEntry",
  "payload": {
    "entryId": "e1",
    "data": { "title": "New Title", "body": "Old Body" }
  },
  "actor": { "userId": "ignored", "source": "admin" },
  "optimisticVersion": 3,
  "dryRun": true,
  "timestamp": "2026-10-22T09:00:00.000Z"
}
```

Response, `200` (diff shape from `apps/api/src/tests/commands/diff.service.test.ts`):

```json
{
  "success": true,
  "data": {
    "commandId": "idem_post-42-title-v3",
    "type": "updateEntry",
    "status": "dry_run",
    "diff": [
      { "field": "title", "before": "Old Title", "after": "New Title", "action": "update" }
    ],
    "previewReceipt": "<receipt id>",
    "executedAt": "2026-10-22T09:00:00.120Z"
  }
}
```

Because the dry run is stored under the idempotency key, the real call needs a new key (or none). Send the same body without `dryRun`, with `"previewReceipt": "<receipt id>"` and a new `Idempotency-Key`. A stale `optimisticVersion` then returns `409 VERSION_CONFLICT`.

## Direct CRUD Routes

`/api/admin/entries` (`POST`, `PUT /:entryId`, `DELETE /:entryId`) and `/api/admin/relations` (`/link`, `/unlink`) still write directly. They skip audit, change log, webhooks, cache invalidation and lifecycle checks. Use commands for content writes. Collections have no commands yet and are managed only through their CRUD routes; see [content model](content-model.md).

## AI and MCP

AI features never write to the database directly; they produce envelopes and run them through `executeCommand` (PRD `AI-01`). Their envelopes always carry `actor.source: "ai"`.

**AI command route** (`POST /api/tenants/:tenantSlug/admin/ai/command`, `apps/api/src/ai/ai.controller.ts`):

- `{ "prompt": "...", "dryRun": true }` asks the model for commands and returns them with an explanation and a `previewReceipt`, without running them.
- `{ "previewReceipt": "..." }` runs the stored commands from that receipt without calling the model again, then marks the receipt used.
- `{ "prompt": "..." }` with `dryRun` omitted or `false` generates and runs the commands in one call. The review step is up to the caller here (PRD `AI-05` is Partial).
- Commands run one after another, not as a `transaction`. A failure stops the run; earlier commands stay committed.

**MCP** (`POST /api/mcp`, `POST /api/admin/mcp`, and the tenant forms; see [MCP server](mcp-server.md)):

- `edgecms_preview_command` builds an envelope with `dryRun: true`, runs it, and returns the diff and a `previewReceipt`.
- `edgecms_execute_command` requires a `previewReceipt`, verifies it, and runs the stored command. A receipt with several commands runs as one `transaction` envelope.

Tenant switch: while a tenant's AI switch is off, the AI routes return `403 AI_DISABLED` and tenant MCP requests return JSON-RPC error `-32003` ([AI command safety](ai-command-safety.md)).

Known gap: the AI route and MCP set the tenant for the handlers but not the sync channel. Commands they run are recorded with no tenant scope in `processed_commands` and `change_log`, and their webhook events are scoped `global`. Tenant webhooks do not receive them; global webhooks do.
