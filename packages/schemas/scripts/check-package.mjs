import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))

const requiredFiles = ['src/index.ts', 'src/commands.ts', 'README.md']
const missingFiles = requiredFiles.filter((file) => !existsSync(join(packageRoot, file)))

if (missingFiles.length > 0) {
  throw new Error(`Missing package files: ${missingFiles.join(', ')}`)
}

if (packageJson.private === true) {
  throw new Error('Publishable package must not set private: true.')
}

if (packageJson.publishConfig?.access !== 'public') {
  throw new Error('publishConfig.access must be public.')
}

if (packageJson.exports?.['.'] !== './src/index.ts') {
  throw new Error('Root export must point to ./src/index.ts.')
}

if (packageJson.exports?.['./commands'] !== './src/commands.ts') {
  throw new Error('./commands export must point to ./src/commands.ts.')
}

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

const testFiles = packedFiles.filter(
  (file) => file.includes('__tests__/') || file.includes('.test.')
)
if (testFiles.length > 0) {
  throw new Error(`Tarball manifest included test files: ${testFiles.join(', ')}`)
}

console.log('schemas package checks passed')
