#!/usr/bin/env bun
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

type CliOptions = {
  force: boolean
  help: boolean
  template: string
  targetDir?: string
}

const helpText = `create-edgecms-app

Usage:
  create-edgecms-app <target-dir> [--template starter] [--force]

Options:
  --template <name>  Template to generate. Only "starter" is supported.
  --force            Overwrite files in an existing non-empty target directory.
  -h, --help         Show this help message.
`

const requiredStarterEnv = {
  EDGE_CMS_URL: 'http://localhost:8787',
  EDGE_CMS_ADMIN_URL: 'http://localhost:5173',
  EDGE_CMS_TENANT: 'smoke',
  EDGE_CMS_COLLECTION: 'smoke-posts',
}

export function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    force: false,
    help: false,
    template: 'starter',
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]

    if (arg === '-h' || arg === '--help') {
      options.help = true
      continue
    }

    if (arg === '--force') {
      options.force = true
      continue
    }

    if (arg === '--template') {
      const next = args[index + 1]
      if (!next) {
        throw new Error('Missing value for --template.')
      }
      options.template = next
      index += 1
      continue
    }

    if (arg.startsWith('--template=')) {
      options.template = arg.slice('--template='.length)
      continue
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`)
    }

    if (options.targetDir) {
      throw new Error(`Unexpected argument: ${arg}`)
    }

    options.targetDir = arg
  }

  return options
}

export function getTemplateDir(templateName: string): string {
  if (templateName !== 'starter') {
    throw new Error(`Unknown template "${templateName}". Available templates: starter.`)
  }

  const packageDir = dirname(dirname(fileURLToPath(import.meta.url)))
  const bundledTemplateDir = resolve(packageDir, 'templates', templateName)
  if (existsSync(bundledTemplateDir)) {
    return bundledTemplateDir
  }

  return resolve(packageDir, '..', '..', 'templates', templateName)
}

export function assertCanWriteTarget(targetDir: string, force: boolean): void {
  if (!existsSync(targetDir)) {
    return
  }

  const entries = readdirSync(targetDir)
  if (entries.length > 0 && !force) {
    throw new Error(`Target directory exists and is not empty: ${targetDir}. Use --force to overwrite.`)
  }
}

export function copyTemplate(sourceDir: string, targetDir: string): void {
  mkdirSync(targetDir, { recursive: true })

  for (const entry of readdirSync(sourceDir)) {
    const sourcePath = join(sourceDir, entry)
    const targetPath = join(targetDir, entry)
    const stat = statSync(sourcePath)

    if (stat.isDirectory()) {
      copyTemplate(sourcePath, targetPath)
      continue
    }

    copyFileSync(sourcePath, targetPath)
  }
}

export function validateStarterEnvExample(content: string): void {
  for (const [key, expectedValue] of Object.entries(requiredStarterEnv)) {
    const match = content.match(new RegExp(`^${key}=(.*)$`, 'm'))
    if (!match) {
      throw new Error(`Starter env preflight failed: missing ${key}.`)
    }

    const value = match[1]?.trim()
    if (!value) {
      throw new Error(`Starter env preflight failed: ${key} is empty. Expected ${expectedValue}.`)
    }
  }
}

export function runCreateApp(args: string[], cwd = process.cwd()): string {
  const options = parseArgs(args)

  if (options.help) {
    return helpText
  }

  if (!options.targetDir) {
    throw new Error('Missing target directory. Run create-edgecms-app --help for usage.')
  }

  const targetDir = resolve(cwd, options.targetDir)
  const templateDir = getTemplateDir(options.template)

  assertCanWriteTarget(targetDir, options.force)
  copyTemplate(templateDir, targetDir)
  validateStarterEnvExample(readFileSync(join(targetDir, '.env.example'), 'utf8'))

  return `Created EdgeCMS starter app in ${targetDir}

Next steps:
  cd ${options.targetDir}
  bun install
  bun run validate
`
}

if (import.meta.main) {
  try {
    const output = runCreateApp(Bun.argv.slice(2))
    process.stdout.write(output)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`${message}\n`)
    process.exit(1)
  }
}
