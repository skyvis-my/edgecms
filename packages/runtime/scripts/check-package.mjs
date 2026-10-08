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

console.log('runtime package checks passed')
