# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Added `@edgecms/client` SDK featuring TipTap ProseMirror AST serializer, React rendering component, live draft preview bridge, and Section Builder.
- Added dynamic zero-config GraphQL endpoint with D1 execution guardrails and GraphiQL playground (`/api/graphql`).
- Added on-demand Cloudflare CDN edge cache purge service triggered on entry/collection mutations.
- Added Model Context Protocol (MCP) server tools and endpoints (`/api/mcp`) for authorized AI agent interactions.
- Added x402 paywall protocol middleware and WordPress WXR XML import parser with preview receipts.
- Added package release automation and pack validation scripts (`scripts/publish-packages.ts`).

### Changed
- Upgraded Elysia ecosystem to 2.0 (`elysia@2.0.0-beta.30`, `@elysia/eden@2.0.0-beta.6`, `@elysia/openapi@2.0.0-beta.4`) and standardized all API and schema validation on `@sinclair/typebox`.
- Removed ArkType and Zod runtime dependencies across backend and shared schema packages.
- Optimized `@edgecms/runtime` bundle, reducing unpacked package size from 7.6 MB to 2.4 MB (-68.4%).
- Consolidated admin dashboard vendor chunking into cohesive domain chunks, reducing asset requests by 26%.

### Fixed
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
