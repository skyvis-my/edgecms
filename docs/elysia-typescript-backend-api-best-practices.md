# ElysiaJS + TypeScript Backend API Best Practices (EdgeCMS)

**Last updated:** 2026-06-04  
**Applies to:** `apps/api` (ElysiaJS on Cloudflare Workers)

This guide focuses on practical coding standards for this repository, grounded in official ElysiaJS, TypeScript, Cloudflare, and OWASP guidance.

## 1. Application Structure and Composition

- Keep route handlers thin and push business logic into services/repositories (matches current `controller/service/repository` slices in `apps/api/src`).
- Prefer Elysia plugin composition (`.use(...)`) for cross-cutting features (auth, tenant context, observability) rather than duplicating middleware logic per route group.
- Follow Elysia guidance for context/state usage:
  - Use `state` for singleton/shared values.
  - Use `decorate` for request-scoped helper access, but avoid request-dependent decorated values.
  - Prefer passing full context to service methods when context data is required across multiple fields.

## 2. Contract-First Validation and API Docs

- Define runtime validation for all external boundaries (`params`, `query`, `body`, `headers`, `cookie`) and set response schemas on endpoints.
- Keep request/response contracts close to route definitions to preserve E2E type inference for Eden clients.
- Use `@elysiajs/openapi` for API docs generation. Do not add new usage of deprecated `@elysiajs/swagger`.
- Name route params by the resource they identify. Never add vague params such as `/:id`; use `/:assetId`, `/:collectionId`, `/:entryId`, `/:tenantSlug`, or another domain-specific name. This avoids handler bugs when nested routes or fallback routes mix multiple IDs.

## 3. Error Handling and HTTP Semantics

- Centralize operational error mapping through Elysia error handling hooks and return consistent error payloads.
- Enforce explicit HTTP semantics:
  - `401` for unauthenticated requests.
  - `403` for failed authorization.
  - `405` for disallowed methods.
  - `415` for unsupported media types.
- Keep domain errors structured (`code`, `message`) and machine-readable.

## 4. TypeScript Strictness (Required Baseline)

- Keep `strict: true` and `noUncheckedIndexedAccess: true` enabled in `apps/api/tsconfig.json`.
- For new/updated modules, prefer:
  - `unknown` over `any` at trust boundaries.
  - Narrowing with explicit guards before use.
  - Enabling and adopting `exactOptionalPropertyTypes` incrementally where feasible.
- Treat schema types as source of truth for transport-level contracts; avoid duplicating manual DTO types when schema inference exists.

## 5. Cloudflare Workers Runtime Practices

- Use `ctx.waitUntil(...)` for non-critical/background work so request latency is not coupled to webhook, analytics, or async fanout tasks.
- Keep handlers lightweight and avoid unbounded `Promise.all` spikes that can exceed Worker runtime/memory constraints.
- Store secrets with Wrangler secrets (`wrangler secret put`) and never hardcode secrets in source or config files.

## 6. Security Baseline for Public/Admin APIs

- Serve APIs over HTTPS only.
- Enforce authentication and object-level authorization on every tenant-scoped/admin route (protect against BOLA/BOPLA classes of failures).
- Validate content type and reject unsupported payload formats with clear 4xx responses.
- Use request IDs and audit-friendly logs for traceability of privileged operations.

## 7. Testing and Verification Expectations

- Maintain layered tests:
  - Controller tests for status/shape/auth behavior.
  - Service tests for business rules and orchestration.
  - Repository tests for query behavior and edge cases.
- Add regression tests for each bug fix in auth, tenant isolation, or payload validation.
- Run before merge: `bun run check:all`.

## 8. PR Checklist (Backend)

- Are all external inputs validated by schema?
- Are response bodies and status codes explicit and consistent?
- Is request path authorization enforced and tested?
- Is long-running side work moved to `waitUntil` or queue patterns?
- Are strict TypeScript guarantees preserved (no `any` leakage)?
- Are contract or behavior changes covered by tests?

## Primary Sources

- Elysia Best Practice: <https://elysiajs.com/essential/best-practice>
- Elysia Validation: <https://elysiajs.com/essential/validation>
- Elysia OpenAPI plugin: <https://elysiajs.com/plugins/openapi.html>
- Elysia Swagger deprecation note: <https://elysiajs.com/plugins/swagger.html>
- TypeScript `strict`: <https://www.typescriptlang.org/tsconfig/strict.html>
- TypeScript `noUncheckedIndexedAccess`: <https://www.typescriptlang.org/tsconfig/noUncheckedIndexedAccess.html>
- Cloudflare `ctx.waitUntil`: <https://developers.cloudflare.com/workers/runtime-apis/context/#waituntil>
- Cloudflare Workers limits: <https://developers.cloudflare.com/workers/platform/limits/>
- Cloudflare secrets: <https://developers.cloudflare.com/workers/configuration/secrets/>
- OWASP API Top 10 (2023): <https://owasp.org/API-Security/editions/2023/en/0x00-toc/>
- OWASP REST Security Cheat Sheet: <https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html>
