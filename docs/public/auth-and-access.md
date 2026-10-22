# Authentication And Access

How people sign in to EdgeCMS and what decides which admin routes they can call. Sign-in uses [Better Auth](https://www.better-auth.com/) with sessions stored in D1. Public delivery routes need no sign-in; see [Public API Guide](public-api.md).

Code: `apps/api/src/auth/`, `apps/api/src/invites/`, `apps/api/src/tenants/tenant.middleware.ts`, `apps/api/src/app.ts`. PRD items: `HS-01` (sign-up policy), `HS-04` (tenant states), `HS-07` (rate limits), `HS-11` (MFA).

## Settings

Set these as Worker vars or secrets (`wrangler secret put NAME --env <env>`). The [deployment runbook](../deployment-runbook.md) lists the full set.

| Variable | Default | Purpose |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` | none | Signs sessions and CSRF tokens. Must be at least 32 characters, or auth fails to start. |
| `BASE_URL` | request origin | Canonical deployment URL. Also used in invite links. |
| `SIGNUP_POLICY` | `open` | `open`, `invite-only` or `disabled`. Any other value stops the Worker at bootstrap. |
| `AUTH_EMAIL_SENDER` | unset | Only `console` is accepted: writes verification and invite emails to the Worker log. Development only. |
| `SUPER_ADMIN_EMAILS` | unset | Comma-separated super-admin addresses. Each must be verified. |
| `SUPER_ADMIN_REQUIRE_MFA` | `false` | Super-admins need a second-factor session on admin routes. |
| `SUPER_ADMIN_DEV_MODE` | unset | `true` lets every signed-in user through the super-admin-only routes (`/api/admin/tenants`, `/api/admin/invites`), but only while `SUPER_ADMIN_EMAILS` is empty. Never set in production. |
| `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET`, `ENTRA_TENANT_ID` | unset | Microsoft Entra sign-in. Tenant ID defaults to `common`. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | unset | Google sign-in. |
| `JWT_HS256_SECRET` | unset | Signs and verifies short-lived access tokens. |
| `JWT_ISSUER`, `JWT_AUDIENCE` | unset | Checked on access tokens when set. |
| `JWT_REQUIRED_FOR_ADMIN` | `false` | `true` rejects admin requests without a bearer access token (`401 JWT_REQUIRED`). |

Hosts that compose the app in code can set the sign-up policy, email sender and super-admin MFA through `host.auth` or `configureAuthPolicies()`; code values win over env vars. See [Hosting Seams](hosting-seams.md#sign-up-and-email-verification-hs-01).

Recommended for new deployments: `SIGNUP_POLICY=disabled` and `SUPER_ADMIN_REQUIRE_MFA=true`.

## Sign-in methods

Better Auth is mounted at `/api/auth`. The routes the admin uses:

```text
POST /api/auth/sign-up/email        { name, email, password, inviteToken? }
POST /api/auth/sign-in/email        { email, password }
POST /api/auth/sign-in/social       { provider: "microsoft" | "google", callbackURL? }
GET  /api/me                        current user, with role "superadmin" when applicable
```

- **Email and password** is always on. Passwords are 8 to 128 characters.
- **Microsoft Entra** is on only when both `ENTRA_CLIENT_ID` and `ENTRA_CLIENT_SECRET` are set.
- **Google** is on only when both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set.
- Sessions last 7 days and refresh once a day.
- A new user's global `role` is `viewer`. Sign-up and update-user input cannot set it.

Password reset is not wired up. The admin has a "Forgot password" page, but the API configures no reset email, so reset requests do not send anything.

## Sign-up policy (HS-01)

| Policy | Who can create an account |
| --- | --- |
| `open` | Anyone. |
| `invite-only` | Only someone with an unused, unexpired invite for that exact email. |
| `disabled` | Nobody. |

The policy is checked on every account creation path, including the first Microsoft or Google sign-in.

**First-account bootstrap.** While the user table is empty, one account can always be created, whatever the policy. Create the operator account right after deploying. `GET /api/bootstrap/status` returns `{ "needsOnboarding": true, "userCount": 0 }` until then. After signing in, `POST /api/bootstrap/provision-tenant` gives a user their first tenant, with the user as owner (returns the existing one if they already have a tenant).

Rejected sign-ups return `403` with one of these codes: `SIGNUP_DISABLED`, `INVITE_REQUIRED`, `INVITE_INVALID`, `SUPER_ADMIN_EMAIL_UNVERIFIED`.

## Invites

Super-admins manage invites. Invites matter only under `SIGNUP_POLICY=invite-only`.

```text
GET    /api/admin/invites             list recent invites (no tokens)
POST   /api/admin/invites             create an invite
DELETE /api/admin/invites/:inviteId   revoke an unused invite
```

```json
{
  "email": "editor@example.com",
  "tenantSlug": "acme",
  "tenantRole": "admin",
  "expiresInHours": 72
}
```

- `tenantRole` is `owner`, `admin` or `member`. With `tenantSlug`, the new user joins that tenant when the account is created.
- `expiresInHours` defaults to 72 and can be 1 to 720.
- The response (`201`) holds the token once, plus `signUpPath` (`/sign-up?invite=<token>`) and `emailed` (whether an email sender sent the link). Only a SHA-256 hash of the token is stored.
- Each invite works once and only for its email.
- The sign-up request carries the token as `inviteToken` in the body or the `x-edgecms-invite-token` header. The admin sign-up page reads it from `?invite=`.

## Email verification

EdgeCMS ships no email provider. Verification turns on when an email sender is configured:

```ts
import { createApp } from 'edgecms-api/app'

export const app = createApp({
  host: {
    auth: {
      emailSender: {
        send: async ({ to, subject, text }) => {
          await myMailer.send({ to, subject, text }) // your provider
        },
      },
    },
  },
})
```

With a sender:

- Email/password accounts must verify before they can sign in. A verification email goes out on sign-up and again on each sign-in attempt while unverified.
- Clicking the link verifies the address but does not sign the user in, so the password and any second factor are still required.
- Invite emails are sent automatically when an invite is created.

For local development, `AUTH_EMAIL_SENDER=console` writes these emails to the Worker log. The links in the log are live credentials.

## Super-admins

A user is a super-admin when any of these holds:

- their global `role` is `superadmin`;
- their email is in `SUPER_ADMIN_EMAILS` **and** verified;
- `SUPER_ADMIN_DEV_MODE=true` and `SUPER_ADMIN_EMAILS` is empty (super-admin-only routes and the MFA requirement only; the general admin route guard does not use dev mode).

An unverified listed address grants nothing. A listed address can only be registered when verification is enforced (an email sender is set) or the identity provider verified it; otherwise sign-up fails with `SUPER_ADMIN_EMAIL_UNVERIFIED`. The runbook explains how to fix an operator account created before this check.

Super-admins can call every admin route, including `/api/admin/tenants`, `/api/admin/invites` and tenant routes in any state. When `SUPER_ADMIN_EMAILS` is empty and dev mode is off, super-admin routes return `403` with `Super-admin access is not configured. Set SUPER_ADMIN_EMAILS.`

No API route changes a user's global `role`; set `user.role` in D1 if you need `superadmin`, `admin` or `editor` globally.

## MFA (HS-11)

Users enrol under **Settings → Profile** in the admin. The Better Auth routes behind it:

```text
POST /api/auth/two-factor/enable              { password } -> totpURI, backupCodes
POST /api/auth/two-factor/verify-totp         { code }
POST /api/auth/two-factor/verify-backup-code  { code }
POST /api/auth/two-factor/disable             { password }
```

After enrolment, password sign-in returns `twoFactorRedirect` and the admin asks for a TOTP code or a recovery code. Each recovery code works once.

A session counts as MFA-verified only when it was created by `verify-totp` or `verify-backup-code` (or replaces the user's own MFA-verified session). Disabling two-factor clears it. Microsoft and Google sign-ins never count as MFA-verified.

Two requirements can be switched on:

- **Super-admins:** `SUPER_ADMIN_REQUIRE_MFA=true`. Enforced on every authorization-checked admin route and on `/api/mcp`.
- **Per tenant:** a super-admin sends `PUT /api/admin/tenants/:tenantSlug` with `{ "requireMfa": true }`. Enforced for everyone, super-admins included, on that tenant's `/api/tenants/:tenantSlug/api/admin/*` and `/api/tenants/:tenantSlug/api/mcp/*` routes. Public reads are not affected.

Blocked requests get:

```json
{ "success": false, "error": { "code": "MFA_REQUIRED", "message": "Multi-factor authentication is required. ..." } }
```

with status `403`. Access tokens are not minted for such sessions, and changing a tenant's `requireMfa` makes its existing tokens stale.

## Roles

There are two layers.

**Global role** (`user.role`): `viewer` (default), `editor`, `admin`, or `superadmin`. `editor` and `admin` can call global `/api/admin/*` routes; `admin` can also list `/api/admin/users`.

**Tenant role** (membership in `tenant_users`): `owner`, `admin`, `editor`, `member` or `viewer`. On `/api/tenants/:tenantSlug/api/admin/*`:

| Tenant role | Read admin routes | Mutate admin routes | List users, read audit |
| --- | --- | --- | --- |
| `owner`, `admin` | yes | yes | yes |
| `editor` | yes | yes | no |
| `member` | yes | no | no |
| `viewer` | no | no | no |

Other cases: no session returns `401 UNAUTHORIZED`; a role without the ability returns `403 FORBIDDEN`.

Memberships are managed by super-admins:

```text
GET    /api/admin/tenants/:tenantSlug/users
POST   /api/admin/tenants/:tenantSlug/users            { userId, role: "owner" | "admin" | "member" }
PUT    /api/admin/tenants/:tenantSlug/users/:userId    { role }
DELETE /api/admin/tenants/:tenantSlug/users/:userId
```

### Custom roles

Each tenant gets built-in `viewer`, `editor`, `admin` and `owner` role rows with permission lists. Tenant routes for roles:

```text
GET    /api/tenants/:tenantSlug/api/admin/roles
GET    /api/tenants/:tenantSlug/api/admin/roles/:roleId
GET    /api/tenants/:tenantSlug/api/admin/roles/:roleId/permissions
POST   /api/tenants/:tenantSlug/api/admin/roles     { name, description?, permissions?: [{ subject, action }] }
PUT    /api/tenants/:tenantSlug/api/admin/roles/:roleId
DELETE /api/tenants/:tenantSlug/api/admin/roles/:roleId
```

Current limits, stated plainly:

- The request guard checks coarse subjects only (`TenantAdminApi`, `GlobalAdminApi`, plus the users and audit reads). Stored permissions such as `entry:*` or `asset:*` are listed by the API but do not restrict individual routes. A stored grant takes effect only when its subject is `TenantAdminApi` or `GlobalAdminApi`.
- The membership routes accept only `owner`, `admin` and `member`, so no API route assigns a custom role to a user.
- Role routes need the same ability as other tenant admin mutations, which includes `editor`.

## Access tokens

Signed-in users can trade their session for a short-lived bearer token. The admin does this to skip D1 lookups on each request.

```text
GET /api/auth/access-token?tenant=acme
```

```json
{ "success": true, "data": { "token": "<jwt>", "expiresAt": "2026-10-22T08:10:00.000Z" } }
```

- HS256 JWT signed with `JWT_HS256_SECRET` (`500 CONFIG_ERROR` if unset), valid for 10 minutes.
- Carries the user, global role, tenant id, slug and role, MFA and email-verified flags.
- `403 FORBIDDEN` if the user is not a member of `tenant`; `403 MFA_REQUIRED` if a required second factor is missing.
- Send it as `Authorization: Bearer <token>`. Role or permission changes make older tokens stale: requests then get `401 TOKEN_STALE` and the client should fetch a new token.

EdgeCMS has no long-lived personal or machine API tokens for admin routes. `EDGECMS_API_KEY` and `MCP_API_KEY` are shared keys accepted only by the MCP endpoint (see [MCP Server](mcp-server.md)).

## Tenant states (HS-04)

Set with `PUT /api/admin/tenants/:tenantSlug` and `{ "status": "..." }` (super-admin).

| State | Admin, MCP, AI, sync | Public reads and GraphQL | Super-admins |
| --- | --- | --- | --- |
| `active` | allowed by role | allowed | allowed |
| `suspended` | blocked, `403 TENANT_SUSPENDED` | allowed | allowed |
| `pending` | blocked, `403 TENANT_UNAVAILABLE` | blocked | allowed |
| `disabled` (and legacy `inactive`) | blocked, `403 TENANT_UNAVAILABLE` | blocked | allowed |

Preview-token requests are blocked while `suspended`. See [Hosting Seams](hosting-seams.md#tenant-states-hs-04) for how hosts pick the initial state.

## CSRF

Cookie-based admin writes need a CSRF token:

1. `GET /api/csrf` sets a `csrf_token` cookie (`SameSite=Lax`, 24 hours) and returns `{ "success": true, "data": { "csrfToken": "..." } }`.
2. Send the same value in the `x-csrf-token` header.

Required on every `POST`, `PUT`, `PATCH` and `DELETE` to a path that starts with `/api/admin/`, contains `/admin/`, or starts with `/api/me/`. A missing or wrong token returns `403 CSRF_REQUIRED`. The check also applies to requests that carry a bearer access token. Better Auth routes under `/api/auth` use Better Auth's own origin checks instead.

Non-`/api/auth` requests with a body must use `Content-Type: application/json` (asset upload also accepts `multipart/form-data`); others get `415 UNSUPPORTED_MEDIA_TYPE`.

## Rate limits (HS-07)

Every `/api/*` request except `/api`, `/api/health`, `/api/health/live` and `/api/docs` is counted. Buckets are per tenant, per caller (user id, else `cf-connecting-ip`), per method and path, and are shared across isolates through the `CACHE` KV namespace.

| Category | Matches | Limit per 60 s |
| --- | --- | --- |
| `auth` | `/api/auth/*`, `/api/csrf` | 30 |
| `ai_command` | `.../admin/ai/command`, `.../admin/ai/workflow` | 20 |
| `admin_mutation` | non-GET on admin paths | 60 |
| `public_read` | GET/HEAD on public paths | 300 |
| `default` | everything else | 120 |

Over the limit:

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests",
    "details": { "dimension": "admin_mutation", "kind": "rate", "scope": "caller", "limit": 60, "retryAfterSeconds": 12 }
  }
}
```

with status `429` and a `Retry-After` header. Hosts can replace these numbers per tenant and add a tenant-wide budget (`scope: "tenant"`); see [Hosting Seams](hosting-seams.md#per-tenant-rate-limits-hs-07). These are local test values (`apps/api/src/tests/auth/rate-limit.middleware.test.ts`), not production measurements.

## Checks

```bash
bun test --isolate apps/api/src/tests/auth/auth-policies.test.ts apps/api/src/tests/auth/mfa-enforcement.test.ts \
  apps/api/src/tests/auth/csrf.middleware.test.ts apps/api/src/tests/auth/rate-limit.middleware.test.ts \
  apps/api/src/tests/auth/authorization.test.ts apps/api/src/tests/auth/super-admin.test.ts apps/api/src/tests/invites
```
