# Content Model Guide

This guide covers how EdgeCMS stores content: collections and their fields, singletons, per-field localization, relations, the entry lifecycle and version history. It describes what the API code does today, including the gaps.

Related guides: [commands](commands.md) for writing content, [public API](public-api.md) for reading it, [webhooks](webhooks.md) for change events.

## Collections

A collection is a content type (PRD `CM-01`). It is stored in the `collections` table (`apps/api/src/database/schema/collections.schema.ts`) with these fields:

| Field | Meaning |
| --- | --- |
| `id` | UUID. |
| `tenantId` | Owning tenant, `global` when created on a global route. |
| `name`, `slug` | Slug is generated from `slug` or `name` and must be unique per tenant. A clash gets a `-1`, `-2` suffix. |
| `singleton` | `true` for one-entry collections. |
| `fields` | Array of field definitions (see below). |
| `defaultLocale` | Defaults to `en`. |
| `supportedLocales` | Defaults to `["en"]`. Must include `defaultLocale`. |
| `displayName`, `description`, `icon`, `color` | Admin display metadata. |
| `listFields`, `searchFields`, `defaultSort`, `defaultSortOrder` | Admin list and search settings. `searchFields` entries must name declared fields. |

Collections are managed with direct CRUD routes, not commands:

```text
GET    /api/tenants/:tenantSlug/admin/collections
GET    /api/tenants/:tenantSlug/admin/collections/:collectionIdOrSlug
POST   /api/tenants/:tenantSlug/admin/collections
PUT    /api/tenants/:tenantSlug/admin/collections/:collectionId
DELETE /api/tenants/:tenantSlug/admin/collections/:collectionId
```

The same routes exist without the tenant prefix under `/api/admin/collections`. The two `GET` routes return `400 TENANT_REQUIRED` there, so use the tenant routes. Writes need an editor, admin or owner role; see [auth and access](auth-and-access.md).

Create example:

```json
{
  "name": "Posts",
  "fields": [
    { "name": "title", "type": "text", "required": true, "localizable": true },
    { "name": "body", "type": "richtext", "required": false, "localizable": true },
    { "name": "readingMinutes", "type": "number", "required": false, "localizable": false },
    {
      "name": "author",
      "type": "relation",
      "required": false,
      "localizable": false,
      "options": { "targetCollectionId": "<authors collection id>", "relationType": "one-to-one" }
    }
  ],
  "defaultLocale": "en",
  "supportedLocales": ["en", "fr"]
}
```

Each create, update or delete also writes a `change_log` row and a new schema snapshot (`schema_snapshots`), and clears the GraphQL schema cache. Collections whose `description` contains `@managed:git` reject field changes unless the update matches the managed manifest or sends `bypassManagedLock: true`.

Deleting a collection cascades to its entries, versions and relations (foreign keys with `onDelete: 'cascade'`).

Collection changes do not emit webhooks today. The `collection.created`, `collection.updated` and `collection.deleted` event names exist and can be subscribed to, but no code emits them. See [webhooks](webhooks.md).

## Field Types

A field definition has `name`, `type`, `required`, `localizable` and optional `options`. The shared schema (`packages/schemas/src/collections.ts`) lists nine core types in `supportedCollectionFieldTypes`. The admin field editor offers six more from `FIELD_TYPES`.

What the API checks when an entry is written (`apps/api/src/entries/entries.service.ts`):

| Type | Accepted value | Server check |
| --- | --- | --- |
| `text`, `richtext` | string | Must be a string. |
| `number` | number | Must be a finite number. |
| `boolean` | boolean | Must be a boolean. |
| `date` | ISO date string | Must parse with `Date.parse`. |
| `media` | URL string, or `{ "assetId": "...", "variant": "..." }` | `assetId` required in the object form. |
| `relation` | `one-to-one`: one entry ID string. Others: array of entry ID strings. | Shape only. IDs are not checked against entries. |
| `json` | anything JSON-serializable | Must serialize. |
| `array` | array of items | No server check. `options.itemFields`, `minItems` and `maxItems` are used by the admin form only. |
| `markdown`, `select`, `email`, `url`, `slug`, `color` | admin-only types | No server check. |

The collection routes accept any non-empty string as a field `type`. A field with an unknown type is stored and its values are not checked.

`required` fields must be present and non-empty on `createEntry`. On updates, `required` is checked only for fields present in the request.

## Singletons

A collection with `singleton: true` is meant to hold one entry (PRD `CM-02`), such as site settings or navigation.

- Write it with the `updateSingleton` command. The first call creates a `draft` entry with the fixed slug `__singleton__`; later calls update that entry. The unique `(collectionId, slug)` index stops two concurrent first writes from creating two entries.
- Publish it with `publishNow` on the returned entry ID.
- Read it publicly at `/api/tenants/:tenantSlug/public/singleton/:collectionSlug`. A non-singleton collection returns `400`; no visible entry returns `404`.

The one-entry rule is only kept by `updateSingleton`. `createEntry` does not check the `singleton` flag. If a singleton collection ends up with several visible entries, the public route returns the most recently created one.

## Localization

Localization is per field (PRD `CM-03`). Set `localizable: true` on a field and store its value as an object keyed by locale:

```json
{
  "title": { "en": "Hello", "fr": "Bonjour" },
  "readingMinutes": 4
}
```

Rules enforced on write:

- A localizable field must be an object with at least one key.
- Every key must be in the collection's `supportedLocales`. Otherwise the write fails with `VALIDATION_ERROR`.
- A required localizable field needs at least one non-empty locale value. EdgeCMS does not require the default locale to be filled.
- Each locale value is checked against the field type.

On read, localizable fields are flattened to one value: the requested locale, then the collection `defaultLocale`, then `null` (`flattenLocaleFields` in `apps/api/src/shared/locale.ts`). Public routes take `?locale=` and default to `en` when it is missing. Admin entry reads (`GET /api/admin/entries/:entryId?locale=fr`) flatten only when `locale` is given.

When no slug is sent, `createEntry` derives one from `data.title` or `data.name`, using the `defaultLocale` value for localized titles.

Limits:

- Flattening applies to the top-level fields of the requested entry. Related entries added by `populate` keep their raw locale objects.
- The requested `locale` is not checked against `supportedLocales`. An unknown locale falls back to `defaultLocale`.

## Relations

Relations link a source entry to target entries through a named field (PRD `CM-04`). Links live in the `relations` table (`apps/api/src/database/schema/relations.schema.ts`):

| Column | Meaning |
| --- | --- |
| `sourceEntryId`, `targetEntryId` | Linked entries. Deleting either entry deletes the link. |
| `sourceCollectionId`, `targetCollectionId` | Stored for queries. |
| `relationType` | `one-to-one`, `one-to-many` or `many-to-many`. |
| `fieldName` | Field on the source entry. |
| `sortOrder` | Integer, default `0`. Populated arrays follow it. |
| `tenantId` | Copied from the source collection. |

Constraints:

- One link per `(sourceEntryId, targetEntryId, fieldName)`. A repeat returns `DUPLICATE_RELATION`.
- `one-to-one` allows one target per source and field. A second link returns `CARDINALITY_VIOLATION`, also under concurrent writes (partial unique index `relations_one_to_one_unique`).
- With the `linkRelation` command on a tenant route, the source and target must both belong to the tenant, or the link returns `NOT_FOUND`.

Create and remove links with the `linkRelation` and `unlinkRelation` [commands](commands.md). Direct routes also exist (`POST /api/admin/relations/link`, `POST /api/admin/relations/unlink`, `GET /api/admin/relations/:entryId?fieldName=...`), but they do not pass the tenant to the service and skip command side effects. Use the commands for writes.

Two things to keep in mind:

- Population reads the `relations` table only. Entry IDs stored in a `relation` field's `data` value are not turned into `relations` rows. Link entries with `linkRelation` if you want them populated.
- `relationFieldOptions` in the shared schema allows `many-to-one`, but the link command and the `relations` service accept only `one-to-one`, `one-to-many` and `many-to-many`.

### Populate and depth

Public entry reads take `populate` and `depth`:

```text
GET /api/tenants/:tenantSlug/public/posts/hello-world?populate=author,tags&depth=2
GET /api/tenants/:tenantSlug/public/posts/hello-world?populate=*
```

- `populate` is a comma-separated list of field names, or `*` for every linked field. Without `populate`, nothing is populated.
- `depth` is clamped to `1`–`3` and defaults to `1`.
- A visited set stops circular links from looping.
- `one-to-one` fields become one object or `null`. Other types become arrays.
- Collection list routes do not populate.

Populated entries are full entry rows (`id`, `slug`, `status`, `data`, `version`, timestamps). They are scoped to the tenant but are **not** filtered by lifecycle status, so a populated draft or archived entry is returned as-is. Only link published content you are happy to expose, until this is fixed. See also the relation notes in the [public API](public-api.md) guide.

## Entry Lifecycle

Entries live in the `entries` table with a `status` and two optional timestamps (PRD `CM-05`):

| Status | Meaning |
| --- | --- |
| `draft` | Default for new entries. Never public. |
| `scheduled` | Waiting for `publishAt`. |
| `published` | Live, subject to `publishAt`/`unpublishAt`. |
| `archived` | Kept but never public. |

`publishAt` and `unpublishAt` are ISO 8601 strings (`publish_at`, `unpublish_at` columns).

### Allowed transitions

`apps/api/src/scheduling/lifecycle.service.ts` defines the state machine used by the publishing commands:

```text
draft      -> scheduled, published
scheduled  -> published, draft
published  -> archived, draft
archived   -> draft
```

Which command moves an entry:

| Change | Command |
| --- | --- |
| draft → published, scheduled → published | `publishNow` |
| published → draft, scheduled → draft | `unpublishNow` |
| draft → scheduled (sets `publishAt`) | `schedulePublish` |
| keep published, set `unpublishAt` | `scheduleUnpublish` (entry must be `published`) |
| clear both timestamps; scheduled → draft | `cancelSchedule` |
| draft ↔ archived | `updateEntry` with `status` |

`createEntry`, `updateEntry` and `bulkUpdate` reject `scheduled` and `published`, and any change away from them, with `INVALID_STATUS_TRANSITION` and a hint naming the command to use. To archive a published entry, run `unpublishNow` and then `updateEntry` with `"status": "archived"`.

The direct route `PUT /api/admin/entries/:entryId` does not apply these rules and can set any status. It also skips the command side effects (audit, webhooks, cache invalidation). Prefer commands.

### Scheduling

`schedulePublish` and `scheduleUnpublish` store the timestamp, write a row to `schedule_intents`, and register the transition with the `PublishScheduler` Durable Object (`apps/api/src/scheduling/publish-scheduler.do.ts`). When the alarm fires, the Durable Object runs `publishNow` or `unpublishNow` through the command engine as actor `{ "userId": "system", "source": "scheduler" }`, then bumps the KV cache version for the collection's locales.

A scheduled unpublish moves the entry to `draft`, not `archived`.

If the Durable Object call is lost, the `schedule_intents` row stays open. `POST /api/admin/system/sweep-schedules` re-sends open intents (up to 50 per call). `wrangler.scheduler.toml` declares a one-minute cron for a separate scheduler worker (`src/scheduler/worker.ts`), which periodically sweeps and reconciles open intents automatically.

The timestamps are not validated: a past or malformed `publishAt` is stored as sent.

### How public reads decide visibility

Public reads do not trust `status` alone. They evaluate the timestamps at request time (PRD `DL-05`). An entry is visible when all three hold:

```text
status is "published" or "scheduled"
publishAt is null, or publishAt <= now
unpublishAt is null, or unpublishAt > now
```

So a `scheduled` entry becomes visible at `publishAt` even if the alarm is late, and a `published` entry disappears at `unpublishAt`. Cache TTLs shrink toward the next `publishAt`/`unpublishAt` in the collection (between 60 and 3600 seconds, `apps/api/src/scheduling/ttl.service.ts`).

`publishNow` and `unpublishNow` change only `status`; they do not clear old timestamps. An entry that was unpublished by its `unpublishAt` and then published again keeps the past `unpublishAt` and stays hidden. Run `cancelSchedule` first to clear both timestamps.

## Versions and Rollback

Every entry has an integer `version`, starting at `1` (PRD `CM-06`). Each update through the entries service (`updateEntry`, `updateSingleton`, `bulkUpdate`, the publishing commands) increments it and writes the previous `data` to `entry_versions` with the previous version number. On D1 the update and the snapshot are one `db.batch()`.

Snapshots store `data` and `createdBy` only. Status, slug and timestamps are not versioned.

`updateEntry` replaces the whole `data` object. Send every field, not only the changed ones.

Optimistic concurrency: pass `optimisticVersion` on `updateEntry` and the update only applies if the stored version still matches. A mismatch returns `409 VERSION_CONFLICT`. See [commands](commands.md).

Routes:

```text
GET  /api/admin/entries/:entryId/versions?page=1&limit=20
GET  /api/admin/entries/:entryId/versions/:versionId
GET  /api/admin/entries/:entryId/versions/:versionId/diff/:targetVersionId
POST /api/admin/entries/:entryId/versions/:versionId/rollback
```

Rollback copies the chosen version's `data` onto the entry, bumps `version`, and writes a version row. It runs outside the command engine: it writes a `change_log` row but no `audit_log` row, emits no webhook and does not invalidate the public cache.

Retention runs after each update: versions older than 90 days are deleted, and at most 50 are kept per entry (`apps/api/src/versioning/retention.service.ts`).

Known gaps:

- The list, get and diff version routes do not scope by tenant.
- Rollback writes its version row with the new version number, while normal updates write the previous number. The next update can then hit the `(entryId, version)` unique index. Test rollback-then-edit before relying on it.

## Deleting Entries

`deleteEntry` is a hard delete. Versions and relations of the entry are removed by cascade.
