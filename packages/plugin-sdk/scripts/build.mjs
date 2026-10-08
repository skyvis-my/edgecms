import { existsSync, rmSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const repoRoot = dirname(dirname(packageRoot))
const noEmit = process.argv.includes('--noEmit')

if (!noEmit) {
  rmSync(join(packageRoot, 'dist'), { force: true, recursive: true })
}

const tscArgs = ['-p', 'tsconfig.json', ...(noEmit ? ['--noEmit'] : [])]
const localTsc = [
  join(packageRoot, 'node_modules/.bin/tsc'),
  join(repoRoot, 'node_modules/.bin/tsc'),
].find((candidate) => existsSync(candidate))

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
