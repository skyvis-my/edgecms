import { bindings, defineConfig, triggers } from "cf/config";

/**
 * Wrangler environments are selected through ctx.mode and the cf --mode flag.
 * @see https://developers.cloudflare.com/workers/wrangler/environments/
 */


export default defineConfig((ctx) => {
	switch (ctx.mode) {
		case "staging": {
			return {
				accountId: "STAGING_CLOUDFLARE_ACCOUNT_ID",
				worker: {
					name: "edgecms-api-staging",
					compatibilityDate: "2025-06-02",
					compatibilityFlags: [
						"nodejs_compat",
					],
					entrypoint: "dist/worker.js",
					assets: {
						notFoundHandling: "single-page-application",
						runWorkerFirst: [
							"/api",
							"/api/*",
						],
					},
					triggers: [
						triggers.queue({
							maxBatchSize: 10,
							maxBatchTimeout: 5,
							maxRetries: 5,
							name: "edgecms-webhook-queue-staging",
						}),
					],
					env: {
						DB: bindings.d1({
							name: "edgecms-db-staging",
							id: "STAGING_D1_DATABASE_ID",
						}),
						CACHE: bindings.kv({
							id: "STAGING_KV_NAMESPACE_ID",
						}),
						MEDIA: bindings.r2({
							name: "edgecms-media-staging",
						}),
						ASSET_VECTORS: bindings.vectorize({
							name: "edgecms-assets-vectors-staging",
						}),
						WEBHOOK_QUEUE: bindings.queue({
							name: "edgecms-webhook-queue-staging",
						}),
						PUBLISH_SCHEDULER: bindings.durableObject({
							worker: "edgecms-api-staging",
							exportName: "PublishScheduler",
						}),
						ASSETS: bindings.assets(),
					},
					/**
					 * TODO(@cloudflare): cf migrate: The options `migrations_dir` at `env.staging.d1_databases.0` require manual migration.
					 */
					/**
					 * TODO(@cloudflare): cf migrate: Durable Object bindings require manual review after migration.
					 * @see https://developers.cloudflare.com/workers/runtime-apis/context/#exports
					 */
					/**
					 * TODO(@cloudflare): cf migrate: Wrangler Durable Object migrations are unsupported. Replace them with an exports lifecycle declaration, for example `exports: { MyDurableObject: exports.durableObject({ storage: "sqlite" }) }`.
					 * @see https://developers.cloudflare.com/workers/runtime-apis/context/#exports
					 */
				},
			};
		}
		case "production": {
			return {
				accountId: "PRODUCTION_CLOUDFLARE_ACCOUNT_ID",
				worker: {
					name: "edgecms-api-production",
					compatibilityDate: "2025-06-02",
					compatibilityFlags: [
						"nodejs_compat",
					],
					entrypoint: "dist/worker.js",
					assets: {
						notFoundHandling: "single-page-application",
						runWorkerFirst: [
							"/api",
							"/api/*",
						],
					},
					triggers: [
						triggers.queue({
							maxBatchSize: 10,
							maxBatchTimeout: 5,
							maxRetries: 5,
							name: "edgecms-webhook-queue-production",
						}),
					],
					env: {
						DB: bindings.d1({
							name: "edgecms-db-production",
							id: "PRODUCTION_D1_DATABASE_ID",
						}),
						CACHE: bindings.kv({
							id: "PRODUCTION_KV_NAMESPACE_ID",
						}),
						MEDIA: bindings.r2({
							name: "edgecms-media-production",
						}),
						ASSET_VECTORS: bindings.vectorize({
							name: "edgecms-assets-vectors-production",
						}),
						WEBHOOK_QUEUE: bindings.queue({
							name: "edgecms-webhook-queue-production",
						}),
						PUBLISH_SCHEDULER: bindings.durableObject({
							worker: "edgecms-api-production",
							exportName: "PublishScheduler",
						}),
						ASSETS: bindings.assets(),
					},
					/**
					 * TODO(@cloudflare): cf migrate: The options `migrations_dir` at `env.production.d1_databases.0` require manual migration.
					 */
					/**
					 * TODO(@cloudflare): cf migrate: Durable Object bindings require manual review after migration.
					 * @see https://developers.cloudflare.com/workers/runtime-apis/context/#exports
					 */
					/**
					 * TODO(@cloudflare): cf migrate: Wrangler Durable Object migrations are unsupported. Replace them with an exports lifecycle declaration, for example `exports: { MyDurableObject: exports.durableObject({ storage: "sqlite" }) }`.
					 * @see https://developers.cloudflare.com/workers/runtime-apis/context/#exports
					 */
				},
			};
		}
		default: {
			return {
				worker: {
					name: "edgecms-api",
					compatibilityDate: "2025-06-02",
					compatibilityFlags: [
						"nodejs_compat",
					],
					entrypoint: "dist/worker.js",
					assets: {
						notFoundHandling: "single-page-application",
						runWorkerFirst: [
							"/api",
							"/api/*",
						],
					},
					triggers: [
						triggers.queue({
							maxBatchSize: 10,
							maxBatchTimeout: 5,
							maxRetries: 5,
							name: "edgecms-webhook-queue",
						}),
					],
					env: {
						DB: bindings.d1({
							name: "edgecms-db",
							id: "LOCAL_DATABASE_ID",
						}),
						CACHE: bindings.kv({
							id: "LOCAL_KV_NAMESPACE_ID",
						}),
						MEDIA: bindings.r2({
							name: "edgecms-media",
						}),
						ASSET_VECTORS: bindings.vectorize({
							name: "edgecms-assets-vectors",
						}),
						WEBHOOK_QUEUE: bindings.queue({
							name: "edgecms-webhook-queue",
						}),
						PUBLISH_SCHEDULER: bindings.durableObject({
							worker: "edgecms-api",
							exportName: "PublishScheduler",
						}),
						ASSETS: bindings.assets(),
					},
					/**
					 * TODO(@cloudflare): cf migrate: The options `migrations_dir` at `d1_databases.0` require manual migration.
					 */
					/**
					 * TODO(@cloudflare): cf migrate: Durable Object bindings require manual review after migration.
					 * @see https://developers.cloudflare.com/workers/runtime-apis/context/#exports
					 */
					/**
					 * TODO(@cloudflare): cf migrate: Wrangler Durable Object migrations are unsupported. Replace them with an exports lifecycle declaration, for example `exports: { MyDurableObject: exports.durableObject({ storage: "sqlite" }) }`.
					 * @see https://developers.cloudflare.com/workers/runtime-apis/context/#exports
					 */
				},
			};
		}
	}
});
