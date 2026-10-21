# AI Command Safety

EdgeCMS AI commands must stay auditable and previewable. Current proof is schema and workflow-boundary proof, not autonomous mutation approval.

## Command Envelope

AI-generated commands use the shared command envelope in `packages/schemas/src/commands.ts`:

- `type`: supported command type only.
- `payload`: command-specific data.
- `actor.source`: `ai`.
- `dryRun`: use `true` for preview.
- `timestamp`: ISO timestamp.

Invalid command types and missing required payload fields must fail schema validation before execution.

Accepted local schema example:

```json
{
  "type": "updateEntry",
  "payload": { "entryId": "entry-1", "data": { "seoTitle": "Launch" } },
  "actor": { "userId": "ai-agent", "source": "ai" },
  "dryRun": true,
  "timestamp": "2026-06-08T00:00:00.000Z"
}
```

Rejected local schema examples:

```json
{ "type": "rewriteEverything", "payload": {}, "actor": { "userId": "ai-agent", "source": "ai" }, "timestamp": "2026-06-08T00:00:00.000Z" }
```

```json
{ "data": { "title": "Missing id" } }
```

## Audit Rules

- Keep dry-run output visible before mutation.
- Store command result status as `success`, `failed`, or `dry_run`.
- Keep audit records tied to actor source, tenant scope, command result status, and reviewer-visible diff where the workflow supports review.
- Do not let plugin tools generate unsupported command types.
- Keep rejection messages clear enough for reviewer action.
- Treat schema tests as local proof only; production command safety still needs route/service tests for each workflow.

The current proof supports previewable and auditable AI-assisted workflows where those flows use dry-run review. It does not claim every AI command route blocks unreviewed mutation.

## Per-Tenant AI Switch (HS-14)

Each tenant has an `aiEnabled` setting. While it is off, no content from that tenant is sent to an AI provider:

- `/api/tenants/:slug/admin/ai/*` (AI commands, workflows and AI import review) returns `403` with code `AI_DISABLED` before any model call.
- Tenant-scoped MCP requests return `403` with JSON-RPC error `-32003`.
- Published entries and asset file names are not embedded with Workers AI, and semantic search returns no vector matches (asset search falls back to keyword search). Embeddings stored while AI was on are kept but not queried.

Providers that receive content when the switch is on, listed in the admin under **Settings → AI** (`AI_CONTENT_PROVIDERS` in `apps/api/src/ai/ai-access.ts`):

| Provider | Operator | Route | Used for |
| --- | --- | --- | --- |
| Qwen | Alibaba Cloud | Cloudflare AI Gateway | AI commands, workflows, import analysis |
| Gemini | Google | Cloudflare AI Gateway | Fallback when Qwen is unavailable |
| Workers AI embeddings | Cloudflare | Workers AI binding | Semantic search over published entries and asset file names |

Defaults: new tenants start with AI off. Migration `0033_tenant_ai_enabled.sql` sets existing tenants to on, so upgrading does not change behavior for tenants that already used AI; their owners can turn it off. The local smoke seed inserts its tenant with raw SQL and therefore gets the migration default (on).

Who can change it: tenant owners, tenant admins and super-admins (`PUT /api/tenants/:slug/admin/settings/ai` with `{ "aiEnabled": boolean }`). Every change is recorded in the tenant's audit chain as `settings.ai_enabled` or `settings.ai_disabled`. Requests on global (non-tenant) routes have no switch and keep their current behavior.
