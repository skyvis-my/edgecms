# Hosting seams

This guide covers the policy hooks a host passes to `createApp({ host })` to run EdgeCMS as a multi-customer service: who may create tenants, tenant states and lifecycle events, sign-up and MFA rules, usage metering, quotas and per-tenant rate limits. It is for developers composing their own Worker entry around `edgecms-api`. Background is in `PRD.md` §10.1.

Each app instance keeps its own copy of the policies, and request input never changes them. Omitted hooks keep the framework defaults.

```ts
import { createApp, type HostPolicies } from 'edgecms-api/app'

const host: HostPolicies = {
  // Who may create a tenant. Return a boolean or a decision object.
  canCreateTenant: async (actor) =>
    actor.isSuperAdmin || { allowed: true, initialStatus: 'pending' },
  // Awaited after a tenant lifecycle change commits. Keep it fast; errors are logged.
  onTenantEvent: async (event) => {
    console.log(event.event, event.tenant.slug)
  },
  // Sign-up policy, email sender and super-admin MFA.
  auth: {
    signupPolicy: 'invite-only',
    emailSender: { send: async ({ to, subject, text }) => myMailer.send(to, subject, text) },
    requireMfaForSuperAdmins: true,
  },
  // Per-tenant usage, delivered after the response through waitUntil.
  usageSink: { record: (events) => usageQueue.sendBatch(events.map((body) => ({ body }))) },
  // Quotas. Return true to allow, or a denial with an upgrade link.
  limits: {
    check: async ({ dimension, tenant }) =>
      dimension === 'entries' && tenant && (await entriesLeft(tenant.id)) <= 0
        ? { allowed: false, upgradeUrl: 'https://example.com/billing', period: '2026-10' }
        : true,
  },
  // Per-tenant rate limits. Return nothing to keep the framework policy.
  rateLimits: ({ tenantSlug, category, defaultPolicy }) =>
    category === 'public_read' ? { ...defaultPolicy, tenantLimit: 1_000 } : undefined,
}

export const app = createApp({ host })
```

`usageQueue` and `entriesLeft` stand for the host's own Queue binding and plan lookup.

## Tenant creation

`canCreateTenant(actor)` is asked before `POST /api/admin/tenants` and `POST /api/bootstrap/provision-tenant`. `actor.source` is `admin-api` or `onboarding`.

- Default: super-admins only on the admin API. Onboarding still gives a signed-in user with no tenant their first workspace.
- Return `false`, `{ allowed: false, reason }`, or throw to deny with `403 FORBIDDEN`.
- Return `{ allowed: true, initialStatus: 'pending' }` to create the tenant as `pending`.
- A creator who is not a super-admin becomes the tenant `owner`. The membership is written in the same D1 batch as the tenant.

## Tenant states

| Status | Admin, MCP, AI, sync | Public REST reads and GraphQL | Super-admin |
| --- | --- | --- | --- |
| `active` | Allowed (RBAC applies) | Allowed | Allowed |
| `suspended` | `403 TENANT_SUSPENDED` | Allowed | Allowed |
| `pending` | `403 TENANT_UNAVAILABLE` | `403 TENANT_UNAVAILABLE` | Allowed |
| `disabled` | `403 TENANT_UNAVAILABLE` | `403 TENANT_UNAVAILABLE` | Allowed |

The legacy `inactive` status, and any status not listed above, behaves like `disabled`. Draft preview tokens (`/public/preview-token`) are admin work, so a suspended tenant cannot issue them. Responses that a CDN or browser cached before a status change stay cached until their TTL ends.

## Tenant lifecycle events

| Event | When |
| --- | --- |
| `tenant.created` | A tenant is created through the admin API or onboarding. |
| `tenant.activated` | Status changes to `active` from any other status. |
| `tenant.suspended` | Status changes to `suspended`. |
| `tenant.deleted` | A tenant is deleted. |
| `tenant.limit_reached` | A limit denied a request. Sent once per tenant, dimension and period. |

Events go to `host.onTenantEvent` and to the webhook event bus. Both are awaited inside the request, so a slow listener slows tenant changes. Enqueue the work instead of calling slow APIs. Webhook delivery uses global scope: only super-admins can subscribe a global webhook (created on `/api/admin/webhooks` without a tenant) to `tenant.*` events, because those events describe every tenant. A tenant-scoped webhook cannot subscribe to them.

`tenant.limit_reached` carries `limit: { dimension, kind, limit?, used?, upgradeUrl?, period }`. The period is the denial's `period`, or the UTC day when the host gives none. A KV marker suppresses repeats across isolates, but two isolates that race can each send one, so treat delivery as at least once. A denied tenant creation has no tenant yet and sends no event.

## Sign-up and email verification

`host.auth.signupPolicy` (or the `SIGNUP_POLICY` var) is `open`, `invite-only` or `disabled`. The default is `open` so existing deployments keep working; use `disabled` for new ones.

- Every account creation path is checked, including Microsoft and Google sign-in. The first account of an empty database is always allowed, so a fresh install can be bootstrapped.
- `invite-only` accepts a new account only with an unused, unexpired invite for that email. Super-admins create invites with `POST /api/admin/invites` (`email`, optional `tenantSlug` and `tenantRole`, `expiresInHours`); the token is returned once, only its SHA-256 hash is stored, and it can be revoked with `DELETE /api/admin/invites/:id`. The admin sign-up page reads `?invite=<token>`.
- With `host.auth.emailSender` (or `AUTH_EMAIL_SENDER=console` in development), email/password accounts must verify their email before they can sign in. EdgeCMS ships no email provider.
- Super-admin by `SUPER_ADMIN_EMAILS` requires a verified email. A listed address can be registered only when verification is enforced (an email sender is set) or the identity provider verified it.
- Unlike `canCreateTenant` and `onTenantEvent`, auth policies apply to the whole Worker isolate.

## Multi-factor authentication

Users enrol an authenticator app with recovery codes under **Settings → Profile**; sign-in then asks for a code.

- `host.auth.requireMfaForSuperAdmins` (or `SUPER_ADMIN_REQUIRE_MFA=true`) blocks super-admins on admin routes until they sign in with a second factor.
- `requireMfa: true` on `PUT /api/admin/tenants/:slug` does the same for everyone on that tenant's admin and MCP routes. Public reads are not affected.
- Blocked requests get `403 MFA_REQUIRED`. Access tokens are not minted for such sessions, and changing a tenant's setting invalidates its existing tokens.
- Microsoft and Google sign-ins get no EdgeCMS second-factor challenge, so they do not satisfy an MFA requirement.

## Usage metering

`host.usageSink.record(events)` receives batches of `UsageEvent`:

```text
{ tenantId, tenantSlug?, metric, quantity, detail?, timestamp }
```

| Metric | Quantity |
| --- | --- |
| `public_reads` | 1 per successful public REST or GraphQL read the Worker served. Reads answered by the CDN never reach the Worker and are not counted. |
| `admin_mutations` | 1 per executed command (a transaction counts once). Dry runs, failed commands and idempotent replays are not counted. |
| `ai_tokens` | Input plus output tokens of one model call; `detail` is the model tier (`nano`, `mid`, `heavy`). |
| `media_bytes` | Signed change in stored bytes (original plus image variants): `+` on upload, `-` when an asset is deleted. Soft-deleted assets stop counting even though R2 keeps them until garbage collection. |
| `entries` | Signed change in entry count: `+1` per `createEntry`, `-1` per `deleteEntry`, including inside transactions. |

Commands sent through the admin API, MCP and AI routes are metered. Imports and scheduled publishing are not. Global (non-tenant) routes are not metered, because there is no tenant to attribute them to.

Recording never fails or slows a request. The framework hands each batch to `waitUntil` after the handler. A sink that throws, rejects or hangs is logged and dropped. Keep `record` cheap: enqueue to a Queue or buffer, then return.

### D1 daily rollups

`createD1UsageRollupSink({ db: env.DB })` sums events into `usage_daily` (tenant, UTC day, metric, detail). Migration `0035_usage_daily.sql` creates the table; apply it with the other migrations. The sink buffers in the isolate. When an event arrives at least 10 s (`flushIntervalMs`) after the last write, or once 50 rows are pending (`maxBufferedRows`), it writes the buffer in one D1 batch. There is no timer, so rows wait in the buffer until the next event arrives; call `flush()` yourself if you need them written sooner. A failed flush keeps its rows for the next one. Counts still in the buffer when an isolate is evicted are lost, so treat these rollups as approximate. For billing-grade counts, send events to a Queue and aggregate them there.

## Limit policy

`host.limits.check({ dimension, amount, tenant?, actor? })` runs before:

| Dimension | Checked before | `amount` |
| --- | --- | --- |
| `commands` | Every command (admin API, MCP, AI execution) that is not a dry run | 1 |
| `entries` | `createEntry`, including inside a transaction | Number of entries created |
| `media_bytes` | `POST /admin/assets/upload` | Upload size in bytes (original plus variants) |
| `ai_tokens` | `POST /admin/ai/command` (except when executing a preview receipt) and `/admin/ai/workflow` | 0: the cost is unknown before the call, so deny when the tenant has no budget left |
| `tenants` | `POST /api/admin/tenants` and onboarding, after `canCreateTenant` allows the actor | 1 (`tenant` is absent) |

`tenant` includes the tenant-row media limits (`mediaUploadMaxBytes`, `mediaUploadMaxDimension`). The upload path keeps enforcing those per-file limits itself (`413`, `415`) whether or not a host is configured.

Return `true` or `{ allowed: true }` to allow. Return `false` or `{ allowed: false, kind, message?, limit?, used?, upgradeUrl?, retryAfterSeconds?, period? }` to deny:

| `kind` | Response |
| --- | --- |
| `quota` (default) | `402` with code `QUOTA_EXCEEDED` |
| `rate` | `429` with code `RATE_LIMITED` and a `Retry-After` header when `retryAfterSeconds` is set |

```json
{
  "success": false,
  "error": {
    "code": "QUOTA_EXCEEDED",
    "message": "Quota exceeded for entries",
    "details": { "dimension": "entries", "kind": "quota", "limit": 500, "used": 500, "upgradeUrl": "https://example.com/billing" }
  }
}
```

`upgradeUrl` must be an absolute `http` or `https` URL; any other value is dropped. The admin shows these errors in a toast, with an Upgrade button when a link is present. A provider that throws allows the request (fail open) and logs `host_limits_check_failed`. Without `host.limits`, every check passes and nothing changes. Global routes are not limited.

## Per-tenant rate limits

Every API request except health checks and `/api/docs` is rate limited per caller (user, else IP) and route, in one of these categories:

| Category | Routes | Framework policy |
| --- | --- | --- |
| `auth` | `/api/auth/*`, `/api/csrf` | 30 per minute |
| `ai_command` | `/admin/ai/command`, `/admin/ai/workflow` | 20 per minute |
| `admin_mutation` | Other non-GET `/admin/*` routes | 60 per minute |
| `public_read` | GET `/public/*` | 300 per minute |
| `default` | Everything else | 120 per minute |

On tenant routes (`/api/tenants/:tenantSlug/...`), `host.rateLimits({ tenantSlug, category, defaultPolicy })` can return `{ windowMs, limit, tenantLimit?, upgradeUrl? }`. Buckets are keyed by tenant, so one tenant's traffic never uses another tenant's budget. `limit` applies per caller. `tenantLimit` is an optional budget shared by all callers of that tenant in the category. Return nothing to keep the framework policy.

Counters live in isolate memory and KV without atomic increments, the same as the framework policies. Under concurrent traffic across isolates, the effective budget can exceed `limit` and `tenantLimit`. For exact enforcement, apply the limit in the host with a Durable Object or Cloudflare's rate limiting binding.

The slug comes from the URL and is not yet verified, so a request for an unknown tenant reaches your resolver too. Answer unknown slugs quickly (for example from a cached tenant list). Results are cached per app instance for 30 s, per tenant and category. Invalid policies (non-positive or non-integer numbers) and a resolver that throws fall back to the framework policy. Over-limit requests get `429 RATE_LIMITED` with `Retry-After` and `details: { dimension: <category>, kind: 'rate', scope: 'caller' | 'tenant', limit, retryAfterSeconds, upgradeUrl? }`.
