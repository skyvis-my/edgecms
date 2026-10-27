import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const repoRoot = dirname(dirname(packageRoot))
const distDir = join(packageRoot, 'dist')

// 1. Clean and recreate dist directory
if (existsSync(distDir)) {
  rmSync(distDir, { recursive: true, force: true })
}
mkdirSync(distDir, { recursive: true })

// 2. Bundle with Bun targeting Node
if (typeof globalThis.Bun !== 'undefined') {
  const bundleResult = await Bun.build({
    entrypoints: [join(packageRoot, 'src', 'index.ts')],
    outdir: distDir,
    target: 'node',
    format: 'esm',
    minify: false,
    sourcemap: 'none',
  })

  if (!bundleResult.success) {
    console.error('Bundle failed:')
    for (const log of bundleResult.logs) {
      console.error(log)
    }
    process.exit(1)
  }
} else {
  const res = spawnSync('bun', [
    'build',
    join(packageRoot, 'src', 'index.ts'),
    '--outdir',
    distDir,
    '--target',
    'node',
    '--format',
    'esm',
  ], {
    cwd: packageRoot,
    stdio: 'inherit',
  })
  if (res.status !== 0) {
    console.error('Failed to bundle with bun')
    process.exit(1)
  }
}

// 3. Ensure executable shebang and permissions
const outFile = join(distDir, 'index.js')
let code = readFileSync(outFile, 'utf8')
if (!code.startsWith('#!/usr/bin/env node')) {
  if (code.startsWith('#!')) {
    code = code.replace(/^#![^\n]+/, '#!/usr/bin/env node')
  } else {
    code = `#!/usr/bin/env node\n${code}`
  }
  writeFileSync(outFile, code, 'utf8')
}
chmodSync(outFile, 0o755)

// 4. Emit type declarations via tsc
const tsconfigBuildPath = join(packageRoot, 'tsconfig.build.json')
writeFileSync(
  tsconfigBuildPath,
  JSON.stringify(
    {
      extends: './tsconfig.json',
      compilerOptions: {
        noEmit: false,
        declaration: true,
        emitDeclarationOnly: true,
        outDir: 'dist',
      },
      include: ['src/index.ts'],
    },
    null,
    2,
  ),
)

try {
  const localTsc = [
    join(packageRoot, 'node_modules', '.bin', 'tsc'),
    join(repoRoot, 'node_modules', '.bin', 'tsc'),
  ].find((f) => existsSync(f))

  const tscArgs = ['-p', tsconfigBuildPath]
  const candidates = localTsc
    ? [{ command: localTsc, args: tscArgs }]
    : [
        { command: 'bunx', args: ['tsc', ...tscArgs] },
        { command: join(process.env.HOME ?? '', '.bun', 'bin', 'bunx'), args: ['tsc', ...tscArgs] },
      ]

  let tscSuccess = false
  for (const candidate of candidates) {
    const res = spawnSync(candidate.command, candidate.args, {
      cwd: packageRoot,
      encoding: 'utf8',
      env: { ...process.env },
    })
    if (res.error?.code === 'ENOENT') continue
    if (res.status === 0) {
      tscSuccess = true
      break
    }
  }

  if (!tscSuccess) {
    console.error('Declaration emit failed with tsc')
    process.exit(1)
  }
} finally {
  rmSync(tsconfigBuildPath, { force: true })
}

// 5. Strip shebang from declaration file if emitted
const dtsFile = join(distDir, 'index.d.ts')
if (existsSync(dtsFile)) {
  let dtsContent = readFileSync(dtsFile, 'utf8')
  if (dtsContent.startsWith('#!')) {
    dtsContent = dtsContent.replace(/^#![^\n]*\n?/, '')
    writeFileSync(dtsFile, dtsContent, 'utf8')
  }
}

// 6. Ensure bundled templates exist if building in repo context
const repoTemplateDir = join(repoRoot, 'templates', 'starter')
const bundledTemplateDir = join(packageRoot, 'templates', 'starter')
if (existsSync(repoTemplateDir) && !existsSync(bundledTemplateDir)) {
  const prepScript = join(packageRoot, 'scripts', 'prepare-pack.ts')
  if (existsSync(prepScript)) {
    spawnSync('bun', [prepScript], { cwd: packageRoot, stdio: 'inherit' })
  }
}

console.log('Build complete: dist/index.js and dist/index.d.ts')
