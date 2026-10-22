# AI command safety

This guide explains how AI-generated content changes are previewed, executed, audited and switched off per tenant. It is for developers building AI features or agents on top of EdgeCMS, and for operators deciding whether a tenant's content may reach an AI provider.

## How AI changes flow

AI features never write to the database directly. They produce command envelopes, the same ones the admin uses, and those go through the command engine. See [Commands](commands.md) for the full command reference.

The safe pattern is two steps:

1. Run the command as a dry run. You get the proposed changes and a preview receipt.
2. Show the preview to a person. If they approve, execute the receipt.

Preview receipts are stored in KV, bound to the user and tenant that created them, expire after 15 minutes and can be used once.

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
| `idempotencyKey` | No | Replays with the same key return the first result. |
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
- `{ "previewReceipt": "..." }` executes the reviewed commands without calling the model again.
- `{ "prompt": "..." }` without `dryRun: true` generates and executes in one call.

To require review, always send `dryRun: true` first and execute only the returned receipt. The route does not force this for you. The [MCP server](mcp-server.md) does: its execute tool accepts only a preview receipt.

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
