import { defineWranglerConfig } from "wrangler/experimental-config";

export default defineWranglerConfig((ctx) => {
	switch (ctx.mode) {
		case "staging": {
			return {
				build: {
					command: "bun scripts/build-worker.ts",
				},
				types: {
					generate: false,
				},
				assetsDirectory: "../admin/dist",
			};
		}
		case "production": {
			return {
				build: {
					command: "bun scripts/build-worker.ts",
				},
				types: {
					generate: false,
				},
				assetsDirectory: "../admin/dist",
			};
		}
		default: {
			return {
				build: {
					command: "bun scripts/build-worker.ts",
				},
				types: {
					generate: false,
				},
				assetsDirectory: "../admin/dist",
			};
		}
	}
});
