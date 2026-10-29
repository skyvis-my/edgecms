# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- `@edgecms/client`, `@edgecms/schemas`, `@edgecms/runtime`, `@edgecms/plugin-sdk`, and `create-edgecms-app` are publishable (no longer `private: true`) with Changesets SemVer and documented npm dry-run / publish path. First registry publish still requires `NPM_TOKEN`.

## [0.2.0] - 2026-10-22

### Security
- Super-admin by `SUPER_ADMIN_EMAILS` now requires a verified email, and a listed address can only be self-registered when email verification is enforced (an email sender is configured) or the identity provider verified it. Previously anyone who registered a listed address became super-admin. **Upgrade step:** operators whose existing account is unverified lose email-based super-admin until they verify (see the deployment runbook).
- The global `role` field can no longer be set from sign-up or `/api/auth/update-user` input; previously anyone could register or promote themselves as `superadmin`.

### Added
- Product requirements in `PRD.md` with stable requirement IDs, the `/prd-check` Claude Code command, and a CI check that every PR cites a requirement (`PRD:` line).
- Host policy surface `createApp({ host })` for multi-customer hosts: tenant creation policy, tenant states (`pending`, `active`, `suspended`, `disabled`) and tenant lifecycle events (PRD HS-02, HS-04, HS-08). See `docs/public/hosting-seams.md`.
- Usage metering through an injected `host.usageSink` with an opt-in D1 daily rollup, a `TenantLimits` policy returning `402 QUOTA_EXCEEDED` / `429 RATE_LIMITED`, and per-tenant rate-limit policies (PRD HS-05, HS-06, HS-07).
- Hash-chained, per-tenant audit ledger with retention, verification and export (PRD HS-12).
- Personal data export and deletion requests with pseudonymized authorship and an audit receipt (PRD HS-13).
- Per-tenant AI switch, off for new tenants, with provider disclosure in the admin (PRD HS-14).
- Signup policy (`SIGNUP_POLICY`: `open`, `invite-only`, `disabled`), single-use email-bound invites (`/api/admin/invites`) and email verification through an injected sender (PRD HS-01).
- Two-factor authentication (TOTP + recovery codes) with per-tenant `requireMfa` and `SUPER_ADMIN_REQUIRE_MFA` (PRD HS-11).
- Added `@edgecms/client` SDK featuring TipTap ProseMirror AST serializer, React rendering component, live draft preview bridge, and Section Builder.
- Added dynamic zero-config GraphQL endpoint with D1 execution guardrails and GraphiQL playground (`/api/graphql`).
- Added on-demand Cloudflare CDN edge cache purge service triggered on entry/collection mutations.
- Added Model Context Protocol (MCP) server tools and endpoints (`/api/mcp`) for authorized AI agent interactions.
- Added x402 paywall protocol middleware and WordPress WXR XML import parser with preview receipts.
- Added package release automation and pack validation scripts (`scripts/publish-packages.ts`).

### Changed
- CI no longer runs Playwright; run the `smoke:e2e:*` scripts by hand before merging UI changes.
- A published release without `NPM_TOKEN` now qualifies packages (dry run) instead of failing.
- Upgraded Elysia ecosystem to 2.0 (`elysia@2.0.0-beta.30`, `@elysia/eden@2.0.0-beta.6`, `@elysia/openapi@2.0.0-beta.4`) and standardized all API and schema validation on `@sinclair/typebox`.
- Removed ArkType and Zod runtime dependencies across backend and shared schema packages.
- Optimized `@edgecms/runtime` bundle, reducing unpacked package size from 7.6 MB to 2.4 MB (-68.4%).
- Consolidated admin dashboard vendor chunking into cohesive domain chunks, reducing asset requests by 26%.

### Fixed
- POST requests to `/api/auth/*` returned 500 on Cloudflare Workers because Elysia consumed the body before Better Auth.
- Configured Elysia 2 AOT precompilation explicitly for Cloudflare Workers isolates.
- Hardened GraphQL identifier validation, revalidation dispatch, and route authorization.
- Enforced strict test isolation across API and admin suites.

## [0.1.0] - 2026-03-12

### Added
- Initial MVP release of EdgeCMS as a Bun monorepo with a React admin dashboard and a Cloudflare Workers API.
- Core CMS workflows for tenants, collections, entries, assets, relations, versioning, webhooks, and command-based mutations.
- AI-assisted authoring infrastructure with provider routing, optional Cloudflare AI Gateway integration, and plugin-extensible tools.
- Deployment and operations documentation for Cloudflare Workers, D1, KV, R2, Durable Objects, Queues, and Vectorize.
- GitHub Actions workflows for CI, staging deployment, and production deployment.

### Changed
- Added API version metadata, request tracing, and batched request metrics for release diagnostics.
- Hardened production configuration around CORS, env schema coverage, and Cloudflare environment overrides.
- Added rich text authoring support and reusable loading skeletons in the admin app.

### Fixed
- Restored API typecheck and build stability across AI provider registry, RBAC typing, and observability integrations.
- Eliminated release-readiness regressions that blocked the canonical `check:all` and `build` workflows.
