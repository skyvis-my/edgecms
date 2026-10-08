/**
 * @edgecms/runtime — Public entry point
 *
 * Re-exports the EdgeCMS application factory, bootstrap helper, and public types.
 * The `App` type carries the full Elysia route schema needed for Eden Treaty clients.
 *
 * Usage in a Cloudflare Worker consumer:
 *
 * ```ts
 * import { createApp, bootstrapApp } from '@edgecms/runtime'
 * import type { App } from '@edgecms/runtime'
 *
 * const app = createApp()
 *
 * export default {
 *   async fetch(request: Request, env: Env, ctx: ExecutionContext) {
 *     await bootstrapApp({ env })
 *     return app.fetch(request, env, ctx)
 *   }
 * }
 * ```
 */

// Application factory — re-exported from the edgecms-api workspace package subpath exports.
export { createApp } from 'edgecms-api/app'
export type { App, CreateAppOptions } from 'edgecms-api/app'

// Bootstrap and lifecycle
export { bootstrapApp } from 'edgecms-api/runtime/bootstrap'
export type { BootstrapOptions, BootstrapResult } from 'edgecms-api/runtime/bootstrap'

// Environment bindings type
export type { Env } from 'edgecms-api/env'

// Plugin isolation support
export { createPluginRuntime } from 'edgecms-api/plugins/plugin-loader'
export type { PluginRuntime } from 'edgecms-api/plugins/plugin-loader'
export { createPluginRegistry } from 'edgecms-api/plugins/plugin-registry'
export type { PluginRegistry } from 'edgecms-api/plugins/plugin-registry'

// Metrics isolation support
export { createMetricsRegistry } from 'edgecms-api/observability/metrics'
export type { MetricSink, MetricsRegistry } from 'edgecms-api/observability/metrics'

// Worker state management (for testing)
export { ensureWorkerBootstrapped, resetWorkerBootstrapStateForTests } from 'edgecms-api'

