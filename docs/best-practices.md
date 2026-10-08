# EdgeCMS Best Practices

This document serves as the authoritative guide for architectural patterns, coding standards, and performance optimizations for EdgeCMS.

# AGENTS
**Instruction for AI Agents:**
*   **Context First:** Before proposing changes, strictly adhere to the `GEMINI.md` and `CLAUDE.md` context files.
*   **Documentation:** Maintain this file (`docs/best-practices.md`) as a living document. If you identify a recurring pattern or a specific fix that prevents future errors, append it here.
*   **Intentional Deviations:** If you must deviate from a standard pattern (e.g., ArkType + TypeBox coexistence), explicitly document the *why* in the code and here to prevent "cleanup" refactors from breaking the design.

---

## Frontend (Admin)

### Architecture & Components
*   **Shared Layout Abstractions:** Apply shared layout abstractions incrementally. Verify feature-level tests after each group of pages. If a shared abstraction causes broad regressions, scope it to proven-safe routes first rather than forcing a global migration.
*   **Router Dependency:** When adding route-change focus management, avoid hard dependencies on router hooks in shared layout components. This ensures isolated tests and non-router renders (e.g., Storybook or unit tests) continue to work without mocking the entire router stack.
*   **Status Tokens:** Replace hardcoded status colors with semantic tokens (`--destructive`, `--success`, `--warning`, `--info`) to maintain consistency between light and dark themes.

### Accessibility (a11y)
*   **Central Fixes First:** Prioritize accessibility fixes in core components (e.g., `/components/ui/form.tsx`) over patching individual screens. Fixing `aria-invalid`, `aria-describedby`, and live error announcements at the root scales immediately across the app.
*   **Focus Management:** Use `:focus-visible` for close/utility controls to avoid showing visual focus rings on mouse click while preserving them for keyboard navigation.
*   **Destructive Actions:** Enforce a single confirmation pattern across all trigger paths (keyboard shortcuts, bulk buttons, context menus) to prevent accidental data loss.

### State Management (TanStack Query)
*   **Key Factories:** Standardize query key naming to plural forms (`tenantsKeys`, `versionsKeys`). Create centralized "Key Factories" (objects) to manage these keys to ensure consistency and simplify invalidation.
*   **Stale Time:** Set explicit `staleTime` based on domain volatility:
    *   **Reference Data (e.g., Locales, Permissions):** High `staleTime` (minutes).
    *   **Transactional Data (e.g., Entry Lists):** Low `staleTime` (seconds).
    *   **Avoid Redundant Invalidation:** Do not invalidate narrow keys when broader parent keys are already being invalidated.
*   **Loading vs. Empty:** Always separate loading states from empty states. Never render "No results" while data is still fetching; show a skeleton or spinner instead.

### Performance
*   **Virtualization:** For large tables, enable row windowing/virtualization (e.g., `tanstack-virtual`) behind an explicit threshold rather than rendering all rows in the DOM.
*   **Debouncing:** Debounce high-frequency filter inputs and cache synchronous storage lookups (like tenant slug reads) to reduce per-keystroke re-renders and request overhead.

---

## Backend (API)

### Architecture (ElysiaJS + Workers)
*   **Thin Controllers:** Keep controller orchestration thin. Move parsing, branching, and population workflows into **Service** methods (e.g., AI command execution, entry relation population).
    *   *Test Impact:* Update controller tests to assert service contracts (inputs/outputs) rather than testing internal orchestration logic.
*   **Error Handling:** Distinguish between `throw` (caught by `onError` middleware) and `return` for control flow. Use `throw` for operational errors (4xx/5xx).
*   **Request Isolation:** Avoid duplicate repository lookups in the same request path. Fetch once, cache in a local variable (or RequestContext), and reuse for subsequent logic like TTL/tag calculations.

### Async & Background Jobs
*   **Non-Blocking Webhooks:** Webhook and event dispatch **must not** block the command response. Emit events asynchronously (using Cloudflare Queues or `context.waitUntil`) and isolate listener errors so request latency is not coupled to downstream I/O.
*   **Durable Objects:** Handle "Overloaded" exceptions with exponential backoff. Do not reuse a `DurableObjectStub` after an exception; create a new one.

---

## Database (Drizzle + D1)

### Performance & Indexing
*   **Targeted Indexing:** Add indexes for all hot-path foreign key lookups and tenant-scoped sync queries *before* optimizing application code.
    *   *Critical Keys:* `userId`, `tenantScope`, composite cursor indexes.
*   **Batching:** Prefer batched reads/writes (`IN (...)`, bulk inserts) over sequential loops.
*   **Bounded Concurrency:** Use bounded concurrency (`p-limit` or similar) for storage/network operations to avoid `Promise.all` spikes that hit Worker CPU/Memory limits.

### Query Patterns
*   **N+1 Prevention:** D1 latency can be higher than local DBs. Aggressively avoid N+1 queries by using Drizzle's `with` relation fetching or explicit batching services.
*   **Replica Reads:** (Future) Utilize read replication for public/cached endpoints to reduce latency for global users.

---

## Testing & Quality Assurance

### Bun & Vitest
*   **Isolation:** For Bun test stability in this workspace, prefer isolated suite execution for admin tests. Mixed-suite runs can intermittently fail with false module export errors (e.g., `edenPostForTenant`). Treat combined-run failures as suspect until confirmed by an isolated rerun.
*   **E2E Testing:** Focus Playwright tests on critical "Smoke" paths (Login -> Create Entry -> Publish) rather than exhaustive component permutation testing.