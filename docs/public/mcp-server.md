# MCP server

This guide explains how to connect an AI client to EdgeCMS through its [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) endpoint, and what each tool does. It is for developers wiring up editors, agents or assistants that read content and propose changes.

Through MCP a client can list collections and schemas, read entries, run semantic search, and change content in two steps: preview, then execute a preview receipt. Every change goes through the command engine, as described in [AI command safety](ai-command-safety.md).

## Endpoints

| Path | Scope |
| --- | --- |
| `POST /api/tenants/:slug/api/mcp` | One tenant (use this for MCP clients) |
| `POST /api/mcp` | Global (no tenant) |
| `POST /api/admin/mcp` | Global, browser admin session only |
| `POST /api/tenants/:slug/api/admin/mcp` | One tenant, browser admin session only |

The two `admin` aliases sit under the admin CSRF check, so every POST to them needs the `X-CSRF-Token` header and `csrf_token` cookie pair (from `GET /api/csrf`). Use them only from the signed-in admin app; external MCP clients use the first two paths.

Use a tenant-scoped path whenever you can. The tenant comes from the path; there is no tenant header.

### Transport

The endpoint implements the MCP [Streamable HTTP](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#streamable-http) transport in its stateless, JSON-only form:

- Requests are JSON-RPC 2.0, `POST`ed with `Content-Type: application/json`. Clients should send `Accept: application/json, text/event-stream`; replies are always `application/json`, never an SSE stream.
- A body can be one message or a batch array of up to 25 messages (`400` and `-32600` beyond that, or for an empty batch).
- Notifications (messages without `id`, such as `notifications/initialized`) and client responses get `202 Accepted` with no body. In a batch, they get no entry in the reply array.
- `GET` and `DELETE` return `405` with `Allow: POST`: there is no server-to-client stream and no session to end.
- There are no sessions: the server sends no `Mcp-Session-Id` and ignores one if sent. Every request is authenticated on its own.

## Authenticate

Send one of:

- `X-EdgeCMS-API-Key: <key>`, or `Authorization: Bearer <key>`, where the key matches the `EDGECMS_API_KEY` or `MCP_API_KEY` Worker secret. This is a deployment-level key: it works on every tenant path and is not tied to a user.
- `Authorization: Bearer <access token>`, an EdgeCMS access token from `GET /api/auth/access-token?tenant=<slug>` (signed in). It acts as that user, on that tenant only, and expires after 10 minutes, so it suits scripts more than long-lived client configs.
- A Better Auth session cookie, for agents running in a signed-in browser session.

On tenant paths, users (session or access token) must be an owner, admin or editor of the tenant, or hold a custom role that can write to the tenant admin API; other users get `403`, and calls without credentials get `401`. For users, entry reads and commands are also checked per collection, as on the admin routes; a denied command returns an error and no preview receipt. A deployment key is not a user and keeps full access.

Set a deployment key with:

```bash
cd apps/api
bunx wrangler secret put MCP_API_KEY --env production
```

API-key calls are recorded with the actor id `mcp-key-<first 8 characters of the key>`. Session and access-token calls use the signed-in user's id.

Errors:

| Case | HTTP | JSON-RPC error |
| --- | --- | --- |
| No valid key, token or session | `401` | `-32001` (tenant paths answer `401` with an `UNAUTHORIZED` error envelope before the MCP handler) |
| Signed-in user who is not an owner, admin or editor of the tenant | `403` | none (`FORBIDDEN` error envelope) |
| Super-admin session without a second factor, when MFA is required | `403` | `-32001` |
| Tenant's AI switch is off | `403` | `-32003`, `data.code = "AI_DISABLED"` |
| Unknown method | `200` | `-32601` |
| `tools/call` without `name` | `200` | `-32602` |

## Methods

| Method | Result |
| --- | --- |
| `initialize` | The negotiated protocol version, the `tools` capability and server info (`edgecms-mcp-server`). The server supports `2025-06-18`, `2025-03-26` and `2024-11-05`: it answers with the version the client asked for when supported, otherwise with `2025-06-18`. |
| `ping` | `{}` |
| `tools/list` | The tools below with their input schemas. |
| `tools/call` | Runs a tool. The result is `{ content: [{ type: "text", text }] }`, where `text` is JSON, plus `isError: true` on failure, including a missing required argument. |
| Notifications | Accepted with `202`, no reply. |

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

1. Call `edgecms_preview_command` with a command `type` and `payload`, and optionally `optimisticVersion`. It runs the command as a dry run and returns `status: "dry_run"`, the `diff`, a `previewReceipt`, its `sha256Hash` and `expiresAt`. A `transaction` preview returns the combined diff of its sub-commands (each entry tagged with `commandIndex` and `commandType`), and its receipt covers those sub-commands. If the dry run fails, the tool returns an error and no receipt.

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

   You can also pass `command`, the envelope you expect, and execution fails if it does not match the receipt. Receipts expire after 15 minutes, work once, and only for the same caller and tenant. A receipt with several commands runs as one transaction. A dry run that fails returns `isError: true` and no receipt. A rejected receipt returns `isError: true` with `{ "status": "rejected", "error": { "code", "message" } }`; the codes are listed in [AI command safety](ai-command-safety.md#preview-receipts).

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

Check a connection with the MCP Inspector CLI, which runs the full handshake:

```bash
npx -y @modelcontextprotocol/inspector --cli https://<your-worker>/api/tenants/<slug>/api/mcp \
  --transport http --method tools/list \
  --header "X-EdgeCMS-API-Key: $EDGECMS_MCP_KEY"
```

Or send one request with `curl`:

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
- The tenant comes only from the path. Tools take no `tenantId` argument; one that names a different tenant (or any tenant on a global path) is rejected with a tool error. To work on a tenant, call its `/api/tenants/:slug/api/mcp` path.
- `POST /api/mcp` (global) needs a deployment key, or a user with the global `admin` or `editor` role (or a super-admin); other signed-in users get `403`.
- A tenant that requires MFA blocks sessions without a second factor on its MCP routes and access tokens without the `mfa` claim. Deployment API keys are not user credentials and are not subject to tenant MFA, so keep them in a secret store and rotate them like any other Worker secret.
