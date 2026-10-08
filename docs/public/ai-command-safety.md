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
