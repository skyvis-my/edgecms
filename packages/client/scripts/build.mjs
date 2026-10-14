import { existsSync, rmSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const repoRoot = dirname(dirname(packageRoot))
const noEmit = process.argv.includes('--noEmit')

if (!noEmit) {
  rmSync(join(packageRoot, 'dist'), { force: true, recursive: true })

  if (typeof globalThis.Bun !== 'undefined') {
    const bundleResult = await Bun.build({
      entrypoints: [
        join(packageRoot, 'src', 'index.ts'),
        join(packageRoot, 'src', 'react.tsx'),
      ],
      outdir: join(packageRoot, 'dist'),
      target: 'browser',
      format: 'esm',
      external: ['react', 'react-dom', 'react/*'],
      splitting: false,
      minify: true,
    })

    if (!bundleResult.success) {
      console.error('Client bundle failed:')
      for (const log of bundleResult.logs) console.error(log)
      process.exit(1)
    }
  } else {
    const bunBin = [
      'bun',
      join(process.env.HOME ?? '', '.bun/bin/bun'),
    ]
    let bunBuilt = false
    for (const bin of bunBin) {
      const res = spawnSync(bin, [
        'build',
        join(packageRoot, 'src', 'index.ts'),
        join(packageRoot, 'src', 'react.tsx'),
        '--outdir',
        join(packageRoot, 'dist'),
        '--target',
        'browser',
        '--format',
        'esm',
        '--minify',
        '--external',
        'react',
        '--external',
        'react-dom',
        '--external',
        'react/*',
      ], {
        cwd: packageRoot,
        stdio: 'inherit',
      })
      if (res.status === 0) {
        bunBuilt = true
        break
      }
    }
    if (!bunBuilt) {
      console.error('Failed to bundle with bun')
      process.exit(1)
    }
  }
}

const tscArgs = ['-p', 'tsconfig.json', ...(noEmit ? ['--noEmit'] : ['--emitDeclarationOnly'])]
const localTsc = [
  join(packageRoot, 'node_modules/.bin/tsc'),
  join(repoRoot, 'node_modules/.bin/tsc'),
].find((candidate) => candidate && existsSync(candidate))

const candidates = localTsc
  ? [{ command: localTsc, args: tscArgs }]
  : [
      { command: 'bunx', args: ['tsc', ...tscArgs] },
      { command: join(process.env.HOME ?? '', '.bun/bin/bunx'), args: ['tsc', ...tscArgs] },
    ]

for (const candidate of candidates) {
  const result = spawnSync(candidate.command, candidate.args, {
    cwd: packageRoot,
    env: {
      ...process.env,
      PATH: [join(process.env.HOME ?? '', '.bun/bin'), process.env.PATH ?? ''].join(delimiter),
    },
    stdio: 'inherit',
  })

  if (result.error?.code === 'ENOENT') {
    continue
  }

  process.exit(result.status ?? 1)
}

throw new Error('Unable to find tsc. Install dependencies or make bunx available.')
