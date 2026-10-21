# Hosting Seams

Hooks for running EdgeCMS as a multi-customer service (`PRD.md` §10.1). A host passes them to `createApp({ host })` when it composes the app. Each app instance keeps its own copy, and request input never changes them. Omitted hooks keep the framework defaults.

```ts
import { createApp, type HostPolicies } from 'edgecms-api/app'

const host: HostPolicies = {
  // HS-02: who may create a tenant. Return a boolean or a decision object.
  canCreateTenant: async (actor) =>
    actor.isSuperAdmin || { allowed: true, initialStatus: 'pending' },
  // HS-08: awaited after a tenant lifecycle change commits. Keep it fast; errors are logged.
  onTenantEvent: async (event) => {
    console.log(event.event, event.tenant.slug)
  },
  // HS-01 / HS-11: signup policy, email sender and super-admin MFA.
  auth: {
    signupPolicy: 'invite-only',
    emailSender: { send: async ({ to, subject, text }) => myMailer.send(to, subject, text) },
    requireMfaForSuperAdmins: true,
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

Events go to `host.onTenantEvent` and to the webhook event bus. Both are awaited inside the request, so a slow listener slows tenant changes. Enqueue the work instead of calling slow APIs. Webhook delivery uses global scope: only super-admins can subscribe a global webhook (created on `/api/admin/webhooks` without a tenant) to `tenant.*` events, because those events describe every tenant. A tenant-scoped webhook cannot subscribe to them.

## Sign-up and email verification (HS-01)

`host.auth.signupPolicy` (or the `SIGNUP_POLICY` var) is `open`, `invite-only` or `disabled`. The default is `open` so existing deployments keep working; use `disabled` for new ones.

- Every account creation path is checked, including Microsoft and Google sign-in. The first account of an empty database is always allowed, so a fresh install can be bootstrapped.
- `invite-only` accepts a new account only with an unused, unexpired invite for that email. Super-admins create invites with `POST /api/admin/invites` (`email`, optional `tenantSlug` and `tenantRole`, `expiresInHours`); the token is returned once, only its SHA-256 hash is stored, and it can be revoked with `DELETE /api/admin/invites/:id`. The admin sign-up page reads `?invite=<token>`.
- With `host.auth.emailSender` (or `AUTH_EMAIL_SENDER=console` in development), email/password accounts must verify their email before they can sign in. EdgeCMS ships no email provider.
- Unlike `canCreateTenant` and `onTenantEvent`, auth policies apply to the whole Worker isolate.

## Multi-factor authentication (HS-11)

Users enrol an authenticator app with recovery codes under **Settings → Profile**; sign-in then asks for a code.

- `host.auth.requireMfaForSuperAdmins` (or `SUPER_ADMIN_REQUIRE_MFA=true`) blocks super-admins on admin routes until they sign in with a second factor.
- `requireMfa: true` on `PUT /api/admin/tenants/:slug` does the same for everyone on that tenant's admin and MCP routes. Public reads are not affected.
- Blocked requests get `403 MFA_REQUIRED`. Access tokens are not minted for such sessions, and changing a tenant's setting invalidates its existing tokens.
- Microsoft and Google sign-ins get no EdgeCMS second-factor challenge, so they do not satisfy an MFA requirement.

