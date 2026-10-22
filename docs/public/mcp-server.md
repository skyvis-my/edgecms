# MCP server

This guide explains how to connect an AI client to EdgeCMS through its [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) endpoint, and what each tool does. It is for developers wiring up editors, agents or assistants that read content and propose changes.

Through MCP a client can list collections and schemas, read entries, run semantic search, and change content in two steps: preview, then execute a preview receipt. Every change goes through the command engine, as described in [AI command safety](ai-command-safety.md).

## Endpoints

| Path | Scope |
| --- | --- |
| `POST /api/mcp` | Global (no tenant) |
| `POST /api/admin/mcp` | Global (no tenant) |
| `POST /api/tenants/:slug/api/mcp` | One tenant |
| `POST /api/tenants/:slug/api/admin/mcp` | One tenant |

Requests are JSON-RPC 2.0 with `Content-Type: application/json`. A request body can be a single message or a batch array of up to 25 messages. The server answers over plain HTTP POST; it has no SSE stream.

Use a tenant-scoped path whenever you can. The tenant comes from the path; there is no tenant header.

## Authenticate

Send one of:

- `X-EdgeCMS-API-Key: <key>`
- `Authorization: Bearer <key>`
- An admin session cookie, for browser-based agents running in a signed-in admin session.

The key must match the `EDGECMS_API_KEY` or `MCP_API_KEY` Worker secret. Set one with:

```bash
cd apps/api
bunx wrangler secret put MCP_API_KEY --env production
```

API-key calls are recorded with the actor id `mcp-key-<first 8 characters of the key>`. Session calls use the signed-in user's id.

Errors:

| Case | HTTP | JSON-RPC error |
| --- | --- | --- |
| No valid key or session | `401` | `-32001` |
| Super-admin session without a second factor, when MFA is required | `403` | `-32001` |
| Tenant's AI switch is off | `403` | `-32003`, `data.code = "AI_DISABLED"` |
| Unknown method | `200` | `-32601` |
| `tools/call` without `name` | `200` | `-32602` |

## Methods

| Method | Result |
| --- | --- |
| `initialize` | Protocol version `2024-11-05`, the `tools` capability and server info (`edgecms-mcp-server`). |
| `ping` | `{}` |
| `tools/list` | The tools below with their input schemas. |
| `tools/call` | Runs a tool. The result is `{ content: [{ type: "text", text }] }`, where `text` is JSON, plus `isError: true` on failure. |

MCP resources and prompts are not implemented.

## Tools

### `edgecms_list_collections`

Lists the collections in scope with id, name, slug, singleton flag, default and supported locales, and a field summary (name, type, required).

```json
{
  "name": "edgecms_list_collections",
  "arguments": {}
}
```

### `edgecms_get_schema`

Returns the full collection definition for a slug.

```json
{
  "name": "edgecms_get_schema",
  "arguments": { "collectionSlug": "articles" }
}
```

### `edgecms_list_entries`

Lists entries in a collection. `page` defaults to 1, `perPage` to 20 (maximum 100). `status` is `draft`, `published`, `scheduled` or `archived`. Unlike the public API, this tool can read drafts.

```json
{
  "name": "edgecms_list_entries",
  "arguments": {
    "collectionSlug": "articles",
    "page": 1,
    "perPage": 20,
    "status": "published"
  }
}
```

### `edgecms_get_entry`

Returns one entry by id.

```json
{
  "name": "edgecms_get_entry",
  "arguments": { "entryId": "entry_01h7x..." }
}
```

### `edgecms_search_rag`

Semantic search over published entries, using the `ASSET_VECTORS` Vectorize index. `limit` defaults to 5 (maximum 20); `collectionSlug` is optional. Query embeddings use Workers AI when `CF_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are set.

```json
{
  "name": "edgecms_search_rag",
  "arguments": {
    "query": "How do I configure edge caching for static assets?",
    "collectionSlug": "docs",
    "limit": 5
  }
}
```

### Change content in two steps

1. Call `edgecms_preview_command` with a command `type` and `payload`, and optionally `optimisticVersion`. It runs the command as a dry run and returns `status: "dry_run"`, the `diff`, a `previewReceipt`, its `sha256Hash` and `expiresAt`.

   ```json
   {
     "name": "edgecms_preview_command",
     "arguments": {
       "type": "createEntry",
       "payload": {
         "collectionId": "<collection id>",
         "slug": "getting-started",
         "data": { "title": "Getting Started with EdgeCMS" }
       }
     }
   }
   ```

   Supported types: `createEntry`, `updateEntry`, `deleteEntry`, `bulkUpdate`, `updateSingleton`, `linkRelation`, `unlinkRelation`, `publishNow`, `unpublishNow`, `schedulePublish`, `scheduleUnpublish`, `cancelSchedule`. Payloads are described in [Commands](commands.md).

2. Show the diff to a person. If they approve, call `edgecms_execute_command` with the receipt:

   ```json
   {
     "name": "edgecms_execute_command",
     "arguments": { "previewReceipt": "<previewReceipt from step 1>" }
   }
   ```

   You can also pass `command`, the envelope you expect, and execution fails if it does not match the receipt. Receipts expire after 15 minutes, work once, and only for the same caller and tenant. A receipt with several commands runs as one transaction.

There is no tool that writes without a preview receipt.

## Connect a client

Claude Desktop and other stdio-only clients can reach the endpoint through the `mcp-remote` bridge. In `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "edgecms": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://<your-worker>/api/tenants/<slug>/api/mcp",
        "--header",
        "X-EdgeCMS-API-Key:${EDGECMS_MCP_KEY}"
      ],
      "env": { "EDGECMS_MCP_KEY": "<your key>" }
    }
  }
}
```

Clients that support remote HTTP servers directly need the URL and the header:

```json
{
  "serverName": "edgecms",
  "url": "https://<your-worker>/api/tenants/<slug>/api/mcp",
  "headers": {
    "X-EdgeCMS-API-Key": "<your key>"
  }
}
```

Test a connection with `curl`:

```bash
curl -X POST https://<your-worker>/api/tenants/<slug>/api/mcp \
  -H 'content-type: application/json' \
  -H "X-EdgeCMS-API-Key: $EDGECMS_MCP_KEY" \
  -d '{ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }'
```

## Security notes

- Every MCP command runs with `actor.source = "ai"` and the caller's id, and executed commands are written to the audit chain.
- Commands accept `optimisticVersion` to reject stale edits.
- Queries and changes are filtered by tenant in D1 and KV.
- On tenant-scoped paths, every request gets `403` and JSON-RPC error `-32003` while the tenant's AI switch is off. Global paths have no tenant switch.
- Tools accept an optional `tenantId` argument. On tenant-scoped paths it is rejected when it names another tenant. On global paths it is honored only when that tenant's AI switch is on, and it does not check the caller's membership in that tenant. Give global MCP paths only to deployment-level API keys.
- A tenant that requires MFA blocks sessions without a second factor on its MCP routes.
