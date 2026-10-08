import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'

const LINK_PATTERN = /\[[^\]]+\]\(([^)]+)\)/g

export function listMarkdownFiles(root: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(root)) {
    const path = join(root, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) files.push(...listMarkdownFiles(path))
    if (stat.isFile() && path.endsWith('.md')) files.push(path)
  }
  return files
}

export function findBrokenLocalLinks(root: string): string[] {
  const broken: string[] = []
  for (const file of listMarkdownFiles(root)) {
    const content = readFileSync(file, 'utf8')
    for (const match of content.matchAll(LINK_PATTERN)) {
      const target = match[1] ?? ''
      if (!target || target.startsWith('http') || target.startsWith('#') || target.startsWith('mailto:')) {
        continue
      }
      const cleanTarget = target.split('#')[0] ?? target
      const resolved = normalize(join(dirname(file), cleanTarget))
      if (!existsSync(resolved)) broken.push(`${file} -> ${target}`)
    }
  }
  return broken
}

if (import.meta.main) {
  const root = process.argv[2] ?? 'docs/public'
  const broken = findBrokenLocalLinks(root)
  if (broken.length > 0) {
    console.error(broken.join('\n'))
    process.exit(1)
  }
  console.log(`Docs link check passed: ${root}`)
}
