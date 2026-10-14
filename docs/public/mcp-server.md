# Model Context Protocol (MCP) Server

EdgeCMS provides a native [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server interface at `/api/mcp` (and `/api/admin/mcp`), enabling AI developer tools, editors, and agent assistants to discover content models, inspect entries, perform semantic RAG search, and generate verified mutation receipts.

## Overview

The EdgeCMS MCP server adheres to the JSON-RPC 2.0 specification over HTTP POST. It enables AI clients to interact with your CMS without direct database access or unreviewed data mutations.

All mutations flow through the EdgeCMS Command Engine and require dry-run preview receipts before execution.

## Endpoint & Authentication

- **Endpoint**: `POST /api/mcp` or `POST /api/admin/mcp`
- **Content-Type**: `application/json`

### Authentication Methods

1. **API Key Header**:
   ```http
   X-EdgeCMS-API-Key: <your-api-key>
   ```
   Or:
   ```http
   Authorization: Bearer <your-api-key>
   ```
   Configured on the Worker via `EDGECMS_API_KEY` or `MCP_API_KEY` secret.

2. **Session Cookie**:
   Browser-based AI agents sharing an active administrative session cookie automatically inherit the authenticated user context.

### Tenant Isolation

Tool executions are strictly scoped to the active tenant. You can specify a tenant explicitly via the `X-Tenant` header or pass the optional `tenantId` parameter in supported tool arguments.

---

## Supported Methods

| Method | Description |
|---|---|
| `initialize` | Negotiates protocol version (`2024-11-05`), capabilities, and server metadata. |
| `ping` | Lightweight health and availability check (`{}`). |
| `tools/list` | Returns the schema and descriptions of all available EdgeCMS tools. |
| `tools/call` | Executes a specific tool with validated input parameters. |
| `resources/list` | Lists readable CMS resources (collections and entries). |
| `resources/read` | Retrieves raw JSON payload for a collection schema or entry URI. |

---

## Available Tools

### 1. Discovery & Schemas

#### `edgecms_list_collections`
Lists all content collections in the current tenant scope with field summaries and localization settings.
```json
{
  "name": "edgecms_list_collections",
  "arguments": {
    "tenantId": "optional-tenant-id"
  }
}
```

#### `edgecms_get_schema`
Retrieves the full schema definition, field types, validation rules, and indexes for a specific collection slug.
```json
{
  "name": "edgecms_get_schema",
  "arguments": {
    "collectionSlug": "articles"
  }
}
```

### 2. Reading Content

#### `edgecms_list_entries`
Queries entries with pagination and lifecycle status filtering.
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

#### `edgecms_get_entry`
Fetches the full content object and metadata for an entry by unique ID.
```json
{
  "name": "edgecms_get_entry",
  "arguments": {
    "entryId": "entry_01h7x..."
  }
}
```

### 3. Semantic Search (RAG)

#### `edgecms_search_rag`
Searches published content using Cloudflare Vectorize vector embeddings. Accepts natural language queries.
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

### 4. Safe Command Mutations

EdgeCMS strictly prevents unreviewed, direct mutations from AI tools. Mutations follow a two-step preview and commit protocol.

#### Step 1: `edgecms_preview_command`
Simulates the mutation against current validation rules and optimistic versioning locks. Returns a diff preview and a cryptographic preview receipt ID.
```json
{
  "name": "edgecms_preview_command",
  "arguments": {
    "type": "createEntry",
    "payload": {
      "collectionSlug": "posts",
      "data": {
        "title": "Getting Started with EdgeCMS",
        "slug": "getting-started"
      }
    }
  }
}
```

#### Step 2: `edgecms_execute_command`
Executes the mutation using the unconsumed preview receipt.
```json
{
  "name": "edgecms_execute_command",
  "arguments": {
    "previewReceipt": "prv_sha256_hash_here"
  }
}
```

---

## Client Configuration Examples

### Claude Desktop (`claude_desktop_config.json`)

To use EdgeCMS tools in Claude Desktop via an HTTP-to-stdio proxy or direct remote MCP:

```json
{
  "mcpServers": {
    "edgecms": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote-bridge",
        "--url",
        "https://<your-deployed-worker>/api/mcp",
        "--header",
        "X-EdgeCMS-API-Key=YOUR_SECRET_API_KEY"
      ]
    }
  }
}
```

### Antigravity & Agent Workflows

In agent configurations or custom MCP tool integrations, configure the remote HTTP server:

```json
{
  "serverName": "edgecms",
  "url": "https://<your-worker>.workers.dev/api/mcp",
  "headers": {
    "X-EdgeCMS-API-Key": "<your-secret-api-key>"
  }
}
```

---

## Security Boundaries

- **Actor Provenance**: All MCP tool executions record `actor.source = 'ai'` and attach the authenticated caller's identity in the audit trail.
- **Optimistic Locking**: Command envelopes support optimistic locking versions to reject stale edits.
- **Tenant Isolation**: Queries and mutations strictly enforce tenant foreign key filters on Cloudflare D1 and KV bindings.
