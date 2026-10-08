import { spawnSync } from 'node:child_process'

type PackedFile = {
  path: string
}

type PackResult = {
  files?: PackedFile[]
  name?: string
  version?: string
}

const result = spawnSync('npm', ['pack', '--dry-run', '--json'], {
  cwd: import.meta.dir + '/..',
  encoding: 'utf8',
})

if (result.status !== 0) {
  throw new Error(`npm pack --dry-run failed:\n${result.stderr || result.stdout}`)
}

const [pack] = JSON.parse(result.stdout) as PackResult[]
const files = pack.files?.map((file) => file.path).sort() ?? []
const starterFiles = files.filter((file) => file.startsWith('templates/starter/'))
const testFiles = files.filter((file) => file.includes('.test.'))

if (!starterFiles.length) {
  throw new Error('Package dry-run did not include templates/starter/**')
}

if (testFiles.length) {
  throw new Error(`Package dry-run included test files: ${testFiles.join(', ')}`)
}

for (const requiredFile of [
  'README.md',
  'src/index.ts',
  'scripts/prepare-pack.ts',
  'templates/starter/README.md',
  'templates/starter/scripts/smoke.ts',
]) {
  if (!files.includes(requiredFile)) {
    throw new Error(`Package dry-run missing required file: ${requiredFile}`)
  }
}

console.log(
  JSON.stringify(
    {
      package: `${pack.name}@${pack.version}`,
      totalFiles: files.length,
      starterFiles: starterFiles.length,
      testFiles: testFiles.length,
    },
    null,
    2,
  ),
)
