# Webhooks Guide

EdgeCMS sends a signed HTTPS `POST` to your endpoint when content changes. Events come from the command engine, go through a D1 outbox and a Cloudflare Queue, and are retried on failure (PRD `DL-09`, `CMD-06`, both Partial). This guide covers event names and payloads, registering destinations, delivery, destination policy and tenant lifecycle events.

Related guides: [commands](commands.md), [content model](content-model.md), [hosting seams](hosting-seams.md), [auth and access](auth-and-access.md).

## Events

Event names use `{entity}.{action}` (`apps/api/src/webhooks/event-bus.ts`).

| Event | Sent when |
| --- | --- |
| `entry.created` | `createEntry`. |
| `entry.updated` | `updateEntry` or `updateSingleton` (also when `updateSingleton` creates the entry). |
| `entry.deleted` | `deleteEntry`. |
| `entry.published` | `publishNow`, including scheduled publishes run by the scheduler. |
| `entry.unpublished` | `unpublishNow`, including scheduled unpublishes. |
| `entry.scheduled` | `schedulePublish` or `scheduleUnpublish`. |
| `entry.bulk_updated` | `bulkUpdate` (one event for the whole batch). |
| `relation.linked` | `linkRelation`. |
| `relation.unlinked` | `unlinkRelation`. |
| `collection.created`, `collection.updated`, `collection.deleted` | Never today. The names are accepted for subscriptions, but no code emits them. |
| `tenant.created`, `tenant.activated`, `tenant.suspended`, `tenant.deleted`, `tenant.limit_reached` | Tenant lifecycle; see [below](#tenant-lifecycle-events). |

`cancelSchedule` and the `transaction` wrapper emit nothing; each sub-command of a transaction emits its own event. Dry runs, failed commands and changes made outside the command engine (direct CRUD routes, collection routes, version rollback) emit nothing.

## Payload

The request body is the event object, sent as JSON:

```json
{
  "id": "5d1f0c4e-8a51-4a3e-9d8b-2f6c1e0b7a90",
  "event": "entry.updated",
  "timestamp": "2026-10-22T09:00:01.250Z",
  "data": {
    "before": { "id": "e1", "slug": "hello-world", "status": "draft", "version": 3, "data": { "title": "Old Title" } },
    "after": { "id": "e1", "slug": "hello-world", "status": "draft", "version": 4, "data": { "title": "New Title" } },
    "metadata": {
      "commandId": "idem_post-42-title-v3",
      "actor": { "userId": "user-1", "source": "admin" },
      "syncChannel": "<tenant id or global>",
      "outboxEventId": "9b7c...",
      "revalidate": {
        "paths": ["/hello-world"],
        "tags": ["collection:<collection id>", "entry:e1"],
        "entryId": "e1"
      }
    }
  }
}
```

The entry objects above are shortened. `before` and `after` are full entry rows (`id`, `collectionId`, `slug`, `status`, `data`, `version`, `createdAt`, `updatedAt`, `publishAt`, `unpublishAt`). Localized fields keep their locale objects.

What `before` and `after` hold per event:

| Event | `before` | `after` |
| --- | --- | --- |
| `entry.created` | `null` | New entry. |
| `entry.updated` from a first `updateSingleton` | `null` | New entry. |
| `entry.updated`, `entry.published`, `entry.unpublished`, `entry.scheduled` | Entry before the change. | Entry after the change. |
| `entry.deleted` | `null` | `{ "id": "..." }` only. |
| `entry.bulk_updated` | `null` | `{ "updated": [...], "errors": [...], "totalUpdated": n, "totalFailed": n }` |
| `relation.linked` | `null` | The new `relations` row. |
| `relation.unlinked` | `null` | `{ "deleted": true }` |

`metadata` fields:

- `commandId`: the command that caused the event.
- `actor`: `{ userId, source }`. `source` is `admin`, `ai`, `sync` or `scheduler`.
- `syncChannel`: tenant ID, or `global`. This decides which webhooks receive the event.
- `outboxEventId`: ID of the outbox row. Present when the outbox row was written.
- `revalidate`: paths and cache tags a frontend can revalidate. Paths are derived from the entry slug. Commands can override them with a `revalidate` object in the payload.

## Registering Destinations

Webhooks are managed per tenant:

```text
GET    /api/tenants/:tenantSlug/admin/webhooks
POST   /api/tenants/:tenantSlug/admin/webhooks
GET    /api/tenants/:tenantSlug/admin/webhooks/signing
GET    /api/tenants/:tenantSlug/admin/webhooks/:webhookId
PUT    /api/tenants/:tenantSlug/admin/webhooks/:webhookId
DELETE /api/tenants/:tenantSlug/admin/webhooks/:webhookId
POST   /api/tenants/:tenantSlug/admin/webhooks/:webhookId/test
GET    /api/tenants/:tenantSlug/admin/webhooks/:webhookId/deliveries?limit=50&offset=0
```

The same routes under `/api/admin/webhooks` manage **global** webhooks (`tenantId: "global"`).

Auth: every route needs a signed-in user. Writes need a role that can write to the admin API (tenant editor, admin or owner). The built-in `webhooks:*` permission for admins is not used by the route checks today, so editors can also manage webhooks. See [auth and access](auth-and-access.md).

Create body (`POST`):

```json
{
  "url": "https://hooks.example.com/edgecms",
  "events": ["entry.published", "entry.unpublished"],
  "headers": { "x-team": "web" },
  "enabled": true,
  "retryMaxRetries": 5,
  "retryTimeout": 30
}
```

| Field | Rules |
| --- | --- |
| `url` | Must pass the [destination policy](#destination-policy). |
| `events` | At least one known event name. Unknown names return `400 VALIDATION_ERROR` listing the valid ones. |
| `headers` | Optional. Sent with every delivery. |
| `enabled` | Default `true`. |
| `retryMaxRetries` | `1`–`5`, default `5`. Total delivery attempts. |
| `retryTimeout` | Seconds per attempt, `5`–`120`, default `30`. |
| `retryBackoff` | `exponential` or `linear`. Stored but not used: delivery always uses the exponential schedule below. |

`POST` returns `201` with the webhook, **including its `secret`**. This is the only response that shows the secret. `GET` and `PUT` responses leave it out. There is no rotate route; to change the secret, delete the webhook and create a new one.

`GET` lists at most 100 webhooks, newest first.

### Verifying signatures

`GET .../webhooks/signing` describes the scheme:

```json
{ "algorithm": "HMAC-SHA256", "headers": ["x-edgecms-signature", "x-webhook-signature"], "format": "sha256=<hex digest>", "bodyEncoding": "application/json" }
```

The signature is an HMAC-SHA256 of the raw request body with the webhook secret. Both headers carry the same value. Verify against the raw body bytes, not a re-serialized object. Custom `headers` are applied after the signature headers, so do not name a custom header `x-edgecms-signature` or `x-webhook-signature`.

Delivery requests also send `Content-Type: application/json` and `User-Agent: EdgeCMS-Webhooks/1.0`.

### Test deliveries

`POST .../:webhookId/test` sends `{ "event": "test", "timestamp": "...", "data": { "test": true } }` straight from the API Worker, waits for the response and returns `{ status, body, success }`. Test deliveries are **not signed** and do not go through the queue or the destination policy check. They are recorded in the delivery log with `eventType: "test"`. A network failure returns `500 DELIVERY_FAILED`.

### Delivery log

`GET .../:webhookId/deliveries` returns `{ deliveries, total }`. Each delivery row has `eventId`, `eventType`, `payload`, `status` (`pending`, `delivered`, `failed`), `attempts`, `lastAttemptAt`, `nextRetryAt`, `responseStatus` and the first 10 KB of `responseBody`. `limit` is capped at 100 by the repository. `total` is the number of rows in this page, not the overall count.

## Delivery

The path from command to HTTP request:

1. **Outbox.** When a command succeeds, the engine writes a `webhook_outbox` row (status `pending`) in the same D1 batch as the `processed_commands` row. If the Worker stops after the commit, the event is not lost.
2. **Queue.** After the commit the engine emits the event on the in-process event bus. The producer (`apps/api/src/webhooks/queue-producer.ts`) finds enabled webhooks subscribed to the event and in the same scope, sends one message per webhook to `WEBHOOK_QUEUE` (in batches of 100), and marks the outbox row `sent`. Subscriptions are cached for 30 seconds per isolate and cleared when a webhook changes in that isolate.
3. **Consumer.** The queue consumer (`apps/api/src/webhooks/queue-consumer.ts`) handles up to 5 messages at a time. Before each delivery it re-reads the webhook and drops the message if the webhook is gone, disabled, in another scope, or its URL now fails the destination policy. It uses the current URL, secret, headers and limits from the database.
4. **Request.** A `POST` with the signed body. Any `2xx` counts as delivered.

If `WEBHOOK_QUEUE` is not bound, the producer is not started and events are only kept as outbox rows.

### Retries

A failed attempt (non-`2xx`, network error or timeout) is retried with Cloudflare Queues `retry({ delaySeconds })`, until the attempt count reaches the webhook's `retryMaxRetries`. The delay is `10 × 3^(attempt − 1)` seconds:

| After attempt | Wait |
| --- | --- |
| 1 | 10 s |
| 2 | 30 s |
| 3 | 90 s |
| 4 | 270 s |

Each attempt updates one delivery row per `(eventId, webhookId)`: `pending` while retries remain, `failed` when they run out. The queue consumers in `apps/api/wrangler.toml` set `max_retries = 5`, `max_batch_size = 10` and `max_batch_timeout = 5`. No dead-letter queue is configured.

### Duplicates

Queues deliver at least once. The consumer skips a message whose `(eventId, webhookId)` delivery is already `delivered`, so a redelivered queue message is not re-sent.

The outbox replay (below) sends the event with the outbox row's ID as `id`, while the live path uses a fresh event ID. If both paths send the same event, your endpoint sees two different `id` values. Deduplicate on `data.metadata.outboxEventId` when it is present, and on `id` otherwise.

### Replay

Replay today means re-sending outbox rows that never reached the queue:

- After each successful command the engine starts a best-effort sweep (`relayOutbox`, `apps/api/src/webhooks/outbox-relay.ts`). It picks up to 20 `pending` outbox rows older than 60 seconds, resolves subscriptions fresh, sends them to the queue and marks them `sent`. A failed send leaves the row `pending` with a 60-second backoff.
- A sweep that drains all due rows on a schedule, or from an admin route, is not wired yet. With no command traffic, orphaned rows wait for the next command.

There is no route to re-send a delivery that ended as `failed`. Use the delivery log to find it and recover from your own system.

## Destination Policy

`validateWebhookDestination` (`apps/api/src/webhooks/webhook-destination-policy.ts`) runs when a webhook is created or its URL changes, and again before every queued delivery. A URL must:

- use `https:`;
- have no username or password in the URL;
- use port `443` (or none);
- not target a local or private host: `localhost`, `*.local`, `*.internal`, `10.*`, `127.*`, `169.254.*`, `172.16–31.*`, `192.168.*`, `::1`, `fc*`/`fd*`/`fe80:` IPv6, and `::ffff:` mapped addresses;
- match `WEBHOOK_ALLOWED_HOSTS` when that variable is set.

`WEBHOOK_ALLOWED_HOSTS` is a comma-separated list. An entry matches the host and its subdomains; a leading `*.` is optional:

```text
WEBHOOK_ALLOWED_HOSTS=hooks.example.com,*.vercel.app
```

When it is empty, any public HTTPS host is allowed.

The check uses the host name as written. It does not resolve DNS, so a public name that resolves to a private address is not caught.

## Scope

Each webhook has a `tenantId` (a tenant ID or `global`). Each event has a scope from `metadata.syncChannel`. A webhook receives an event only when the two match (`canDeliver`):

- Commands on `/api/tenants/:tenantSlug/...` routes produce tenant-scoped events for that tenant's webhooks.
- Commands on global routes produce `global` events for global webhooks.
- Scheduled publishes keep the tenant of the original schedule.
- Events with no `syncChannel` are dropped.

Known gap: commands run by the AI command route and by MCP are scoped `global` even on tenant routes, so they reach global webhooks and not the tenant's. See [commands](commands.md#ai-and-mcp).

## Tenant Lifecycle Events

Tenant events (PRD `HS-08`) describe tenants, not content. They come from tenant management, not from commands (`apps/api/src/host/tenant-events.ts`):

| Event | Sent when |
| --- | --- |
| `tenant.created` | A tenant is created. |
| `tenant.activated` | A tenant's status changes to `active`. |
| `tenant.suspended` | A tenant's status changes to `suspended`. |
| `tenant.deleted` | A tenant is deleted. |
| `tenant.limit_reached` | A host limit denies a request (`HS-06`), once per tenant, dimension and period. |

Rules:

- They are always scoped `global`. Only global webhooks receive them.
- Only super-admins can subscribe, and only on global webhooks (`/api/admin/webhooks`). Others get `400 VALIDATION_ERROR` for those names.
- They have no outbox row. The Worker waits for the queue send inside the request, but if that send fails the event is not replayed.
- The same event goes to the host's `onTenantEvent` callback; see [hosting seams](hosting-seams.md).

Payload:

```json
{
  "id": "...",
  "event": "tenant.suspended",
  "timestamp": "2026-10-22T09:00:00.000Z",
  "data": {
    "after": { "id": "<tenant id>", "slug": "acme", "name": "Acme", "status": "suspended" },
    "metadata": {
      "syncChannel": "global",
      "tenantId": "<tenant id>",
      "previousStatus": "active",
      "actorId": "<user id>"
    }
  }
}
```

`tenant.limit_reached` adds `metadata.limit` with `dimension`, `kind` (`quota` or `rate`), `limit`, `used`, `upgradeUrl` and `period`.

## Frontend Revalidation

Separate from webhooks, when the Worker has `FRONTEND_REVALIDATE_URL` set, each event that carries `revalidate` metadata also triggers a `POST` to that URL with `event`, `tags`, `paths`, `entryId` and `collectionSlug`, signed with `FRONTEND_REVALIDATE_SECRET` when set (`Authorization: Bearer`, `x-revalidate-token`, and `x-edgecms-signature`/`x-hub-signature-256` HMAC headers). See [frontend integration](frontend-integration.md).
