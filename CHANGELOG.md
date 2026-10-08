# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
