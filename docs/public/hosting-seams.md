# Hosting Seams

Hooks for running EdgeCMS as a multi-customer service (`PRD.md` §10.1). A host passes them to `createApp({ host })` when it composes the app. Each app instance keeps its own copy, and request input never changes them. Omitted hooks keep the framework defaults.

```ts
import { createApp, type HostPolicies } from 'edgecms-api/app'

const host: HostPolicies = {
  // HS-02: who may create a tenant. Return a boolean or a decision object.
  canCreateTenant: async (actor) =>
    actor.isSuperAdmin || { allowed: true, initialStatus: 'pending' },
  // HS-08: runs after a tenant lifecycle change commits. Errors are logged, never thrown.
  onTenantEvent: async (event) => {
    console.log(event.event, event.tenant.slug)
  },
}

export const app = createApp({ host })
```

## Tenant creation (HS-02)

`canCreateTenant(actor)` is asked before `POST /api/admin/tenants` and `POST /api/bootstrap/provision-tenant`. `actor.source` is `admin-api` or `onboarding`.

- Default: super-admins only on the admin API. Onboarding still gives a signed-in user with no tenant their first workspace.
- Return `false`, `{ allowed: false, reason }`, or throw to deny with `403 FORBIDDEN`.
- Return `{ allowed: true, initialStatus: 'pending' }` to create the tenant as `pending`.
- A creator who is not a super-admin becomes the tenant `owner`. The membership is written in the same D1 batch as the tenant.

## Tenant states (HS-04)

| Status | Admin, MCP, AI, sync | Public REST reads and GraphQL | Super-admin |
| --- | --- | --- | --- |
| `active` | Allowed (RBAC applies) | Allowed | Allowed |
| `suspended` | `403 TENANT_SUSPENDED` | Allowed | Allowed |
| `pending` | `403 TENANT_UNAVAILABLE` | `403 TENANT_UNAVAILABLE` | Allowed |
| `disabled` | `403 TENANT_UNAVAILABLE` | `403 TENANT_UNAVAILABLE` | Allowed |

The legacy `inactive` status, and any status not listed above, behaves like `disabled`. Draft preview tokens (`/public/preview-token`) are admin work, so a suspended tenant cannot issue them. Responses that a CDN or browser cached before a status change stay cached until their TTL ends.

## Tenant lifecycle events (HS-08)

| Event | When |
| --- | --- |
| `tenant.created` | A tenant is created through the admin API or onboarding. |
| `tenant.activated` | Status changes to `active` from any other status. |
| `tenant.suspended` | Status changes to `suspended`. |
| `tenant.deleted` | A tenant is deleted. |
| `tenant.limit_reached` | Reserved for HS-06. Not emitted yet. |

Events go to `host.onTenantEvent` and to the webhook event bus. Webhook delivery uses global scope: only global webhooks (created on `/api/admin/webhooks` without a tenant) can subscribe to `tenant.*` events. A tenant-scoped webhook cannot.
