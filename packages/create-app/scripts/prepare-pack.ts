import { existsSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyTemplate } from '../src/index'

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)))
const repoTemplateDir = resolve(packageDir, '..', '..', 'templates', 'starter')
const bundledTemplateDir = resolve(packageDir, 'templates', 'starter')

if (!existsSync(repoTemplateDir)) {
  throw new Error(`Missing starter template source: ${repoTemplateDir}`)
}

rmSync(bundledTemplateDir, { recursive: true, force: true })
copyTemplate(repoTemplateDir, bundledTemplateDir)
