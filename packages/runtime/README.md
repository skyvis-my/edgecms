# @edgecms/runtime

Private internal package providing the EdgeCMS runtime as a consumable artifact for external Worker consumers.

> **Private package.** Not published to npm. Available only within the EdgeCMS monorepo for local tarball qualification tests.

## What this package provides

- `createApp(options?)` — Elysia application factory that serves all EdgeCMS routes
- `bootstrapApp(options?)` — Worker lifecycle bootstrap (env validation, plugin loading, metric config)
- `type App` — full Eden Treaty route type contract for typed admin API clients
- `type Env` — Cloudflare Worker environment bindings type
- `type CreateAppOptions`, `type BootstrapOptions` — composition option types
- Plugin isolation: `createPluginRuntime`, `createPluginRegistry`
- Metrics isolation: `createMetricsRegistry`, `type MetricSink`

## Usage in a Cloudflare Worker

```ts
import { createApp, bootstrapApp } from '@edgecms/runtime'
import type { App, Env } from '@edgecms/runtime'

const app = createApp()

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    await bootstrapApp({ env })
    return app.fetch(request, env, ctx)
  }
}
```

## Eden Treaty client (admin)

```ts
import { treaty } from '@elysiajs/eden'
import type { App } from '@edgecms/runtime'

const eden = treaty<App>('http://localhost:8787')
const { data } = await eden.api.health.get()
```

## Build

```bash
bun run --filter @edgecms/runtime build
```

## Status

Package shape is qualified locally. Registry publication requires explicit release approval.
