import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))

const requiredFiles = ['dist/index.js', 'dist/index.d.ts', 'dist/react.js', 'dist/react.d.ts', 'README.md']
const missingFiles = requiredFiles.filter((file) => !existsSync(join(packageRoot, file)))

if (missingFiles.length > 0) {
  throw new Error(`Missing package files: ${missingFiles.join(', ')}`)
}

if (packageJson.private !== true) {
  throw new Error('Package must stay private until publish approval.')
}

if (packageJson.dependencies && Object.keys(packageJson.dependencies).length > 0) {
  throw new Error('EdgeCMS Client must remain zero-dependency (dependencies must be empty).')
}

if (packageJson.types !== './dist/index.d.ts') {
  throw new Error('Package types must point to ./dist/index.d.ts.')
}

const rootExport = packageJson.exports?.['.']
if (rootExport?.import !== './dist/index.js' || rootExport?.types !== './dist/index.d.ts') {
  throw new Error('Root export must point to dist JS and declaration files.')
}

const source = readFileSync(join(packageRoot, 'src/index.ts'), 'utf8')
if (source.includes('apps/api') || source.includes('@/') || source.includes('@edgecms/api') || source.includes('@edgecms/runtime')) {
  throw new Error('Client package must not import API runtime or backend modules.')
}

// Verify that dist/index.js can be imported cleanly
await import(join(packageRoot, 'dist/index.js'))
await import(join(packageRoot, 'dist/react.js'))

// Qualify package tarball manifest via npm pack --dry-run
const packResult = spawnSync('npm', ['pack', '--dry-run', '--json'], {
  cwd: packageRoot,
  encoding: 'utf8',
})

if (packResult.status !== 0) {
  throw new Error(`npm pack --dry-run failed:\n${packResult.stderr || packResult.stdout}`)
}

const jsonStartIndex = packResult.stdout.indexOf('[')
if (jsonStartIndex === -1) {
  throw new Error(`npm pack --dry-run did not output JSON array:\n${packResult.stdout}`)
}
const [pack] = JSON.parse(packResult.stdout.slice(jsonStartIndex))
const packedFiles = pack.files?.map((file) => file.path) ?? []
for (const required of requiredFiles) {
  if (!packedFiles.includes(required)) {
    throw new Error(`Tarball manifest missing required file: ${required}`)
  }
}

const testFiles = packedFiles.filter((file) => file.includes('.test.'))
if (testFiles.length > 0) {
  throw new Error(`Tarball manifest included test files: ${testFiles.join(', ')}`)
}

const srcFiles = packedFiles.filter((file) => file.startsWith('src/'))
if (srcFiles.length > 0) {
  throw new Error(`Tarball manifest included source files: ${srcFiles.join(', ')}`)
}

console.log('client package checks passed')
