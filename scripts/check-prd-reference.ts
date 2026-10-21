import { readFileSync } from 'node:fs'

const PRD_LINE = /^\s*PRD:\s*(.+?)\s*$/im
const ID_PATTERN = /\b(?:P\d+|NG\d+|G\d+|[A-Z]{2,3}-\d{2})\b/g

export function listPrdIds(prd: string): Set<string> {
  const ids = new Set<string>()
  for (const match of prd.matchAll(/\*\*([A-Z]{1,3}-?\d+)(?:\s[^*]*)?\*\*/g)) ids.add(match[1])
  return ids
}

export function checkPrdReference(body: string, prd: string): string[] {
  const line = body.match(PRD_LINE)
  if (!line) return ['PR description is missing a "PRD:" line (use requirement IDs or "n/a").']

  const value = line[1].replace(/<!--.*?-->/g, '').trim()
  if (/^n\/?a\b/i.test(value)) return []

  const cited = value.match(ID_PATTERN) ?? []
  if (cited.length === 0) return [`"PRD: ${value}" names no requirement IDs (for example DL-08, P5).`]

  const known = listPrdIds(prd)
  return cited.filter((id) => !known.has(id)).map((id) => `${id} is not defined in PRD.md.`)
}

if (import.meta.main) {
  const body = process.env.PR_BODY ?? ''
  const prd = readFileSync(process.argv[2] ?? 'PRD.md', 'utf8')
  const errors = checkPrdReference(body, prd)
  if (errors.length > 0) {
    console.error(errors.join('\n'))
    console.error('See PRD.md §12 Change control, or run /prd-check in Claude Code.')
    process.exit(1)
  }
  console.log('PRD reference check passed')
}
