import { mock } from 'bun:test'
mock.module('cloudflare:workers', () => ({ env: {} }))
import { aot } from 'elysia/plugin/aot/bun'

console.log('Building API Worker with Elysia AOT for Cloudflare Workers (workerd)...')

const result = await Bun.build({
  entrypoints: ['./src/main.ts'],
  outdir: './dist',
  naming: 'worker.js',
  target: 'browser',
  format: 'esm',
  minify: true,
  external: ['cloudflare:workers'],
  plugins: [aot('./src/main.ts', { target: 'workerd' })],
})

if (!result.success) {
  for (const log of result.logs) {
    console.error(log)
  }
  process.exit(1)
}

console.log(`✓ API Worker build complete: ${result.outputs[0]?.path} (${result.outputs[0]?.size} bytes)`)
