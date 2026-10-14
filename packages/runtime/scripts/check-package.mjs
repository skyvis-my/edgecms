import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))

const requiredFiles = [
  'dist/index.js',
  'dist/index.d.ts',
  'README.md',
]
const missingFiles = requiredFiles.filter((file) => !existsSync(join(packageRoot, file)))

if (missingFiles.length > 0) {
  throw new Error(`Missing package files: ${missingFiles.join(', ')}`)
}

if (packageJson.private !== true) {
  throw new Error('Package must stay private until publish approval.')
}

if (packageJson.types !== './dist/index.d.ts') {
  throw new Error('Package types must point to ./dist/index.d.ts.')
}

const rootExport = packageJson.exports?.['.']
if (rootExport?.import !== './dist/index.js' || rootExport?.types !== './dist/index.d.ts') {
  throw new Error('Root export must point to dist JS and declaration files.')
}

// Ensure the index.d.ts re-exports the App type (Eden contract preserved)
const indexDts = readFileSync(join(packageRoot, 'dist', 'index.d.ts'), 'utf8')
if (!indexDts.includes('App') && !indexDts.includes('createApp')) {
  throw new Error('dist/index.d.ts must export App type and createApp (Eden contract check).')
}

// Ensure the dist does not embed workspace alias paths that would break external consumers
const indexJs = readFileSync(join(packageRoot, 'dist', 'index.js'), 'utf8')
if (indexJs.includes('edgecms-api/src/') || indexJs.includes("from '@/")) {
  throw new Error('dist/index.js must not contain unresolved workspace alias paths.')
}

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

console.log('runtime package checks passed')
