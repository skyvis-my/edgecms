# EdgeCMS Architecture Decisions

Date: 2026-02-08

## Validation Strategy: ArkType + TypeBox

Decision:
- Keep ArkType as the canonical shared schema system in `apps/api/src/shared/schemas`.
- Keep Elysia TypeBox (`t.Object(...)`) for transport-level route validation in controllers.

Rationale:
- Elysia integrates directly with TypeBox for request parsing and OpenAPI metadata.
- ArkType is already used for shared command/schema modeling and AI tool schema validation.
- For now, duplicating a subset of input shapes is acceptable to preserve clear route contracts and framework compatibility.

Guardrails:
- Shared domain schema changes should be reflected in controller request schemas in the same PR.
- Prefer reusing shared types at service boundaries even when route validators stay TypeBox.

## Mutation Pattern Guidelines (Admin Frontend)

Decision:
- Use `useOfflineMutation` for CRUD-like user/admin operations that should queue offline.
- Use command execution (`useExecuteCommand`) for domain operations requiring server-side orchestration, validation pipelines, and audit/version semantics.
- Use plain `useMutation` only when offline queueing is intentionally not required (for example ephemeral operations).

Rationale:
- This preserves offline-first behavior where it matters while keeping command-based workflows explicit.

## Commands Service Naming

Decision:
- Keep `apps/api/src/commands/engine.ts` as the command service implementation.

Rationale:
- The command engine is not a CRUD service; it is an orchestration runtime with registry/dispatch behavior.
- Renaming to `commands.service.ts` is optional and not required for correctness.

## Proposed: Modular Composition and Deployment Profiles (2026-09-11)

Status: Proposed; implementation and deployment qualification are pending.

- [ADR: Modular, composable EdgeCMS with qualified deployment profiles](adr/2026-09-11-modular-composable-edgecms.md)
- [Headless CMS benchmark and source evidence](comparisons/2026-09-11-headless-cms-benchmark.md)
- [Gap implementation plan and verification gates](plans/2026-09-11-headless-cms-gap-implementation-plan.md)

The proposal retains the decisions above. It defines consumer application packaging, isolated application composition, trusted extension contracts, reviewed agent execution, measured performance, admin journeys and separately qualified hosting profiles. It does not claim those planned capabilities are implemented.
