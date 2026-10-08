import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))

const requiredFiles = ['dist/index.js', 'dist/index.d.ts', 'README.md']
const missingFiles = requiredFiles.filter((file) => !existsSync(join(packageRoot, file)))

if (missingFiles.length > 0) {
  throw new Error(`Missing package files: ${missingFiles.join(', ')}`)
}

if (packageJson.private !== true) {
  throw new Error('Package must stay private until publish approval.')
}

if (packageJson.dependencies && Object.keys(packageJson.dependencies).length > 0) {
  throw new Error('Plugin SDK must remain dependency-free.')
}

if (packageJson.types !== './dist/index.d.ts') {
  throw new Error('Package types must point to ./dist/index.d.ts.')
}

const rootExport = packageJson.exports?.['.']
if (rootExport?.import !== './dist/index.js' || rootExport?.types !== './dist/index.d.ts') {
  throw new Error('Root export must point to dist JS and declaration files.')
}

const source = readFileSync(join(packageRoot, 'src/index.ts'), 'utf8')
if (source.includes('apps/api') || source.includes('@/') || source.includes('@edgecms/api')) {
  throw new Error('Plugin SDK must not import API runtime modules.')
}

console.log('plugin-sdk package checks passed')
