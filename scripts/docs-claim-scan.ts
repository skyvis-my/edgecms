import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const CLAIM_PATTERNS = [
  /published\s+to\s+npm/i,
  /installable\s+outside\s+this\s+repo/i,
  /deployed\s+proof\s+complete/i,
  /cold[- ]start\s+proof/i,
  /production\s+cache\s+purge\s+proof/i,
  /remote\s+performance\s+proof\s+complete/i,
  /full\s+OpenAPI\s+generation/i,
  /GraphQL\s+parity\s+(is\s+)?(available|complete|shipped|supported)/i,
  /production\s+migration\s+proof\s+complete/i,
  /production\s+backup\s+proof\s+complete/i,
  /marketplace\s+(support|listing|plugin)\s+(is\s+)?(available|complete|shipped|supported)/i,
  /arbitrary\s+query\s+engine/i,
  /autonomous\s+AI\s+execution\s+(is\s+)?(available|complete|shipped|supported)/i,
  /unreviewed\s+(AI\s+)?mutation\s+(is\s+)?(available|complete|shipped|supported)/i,
  /(anonymous|public)\s+draft\s+(preview\s+)?route\s+(is\s+)?(available|complete|shipped|supported)/i,
  /production\s+security[- ]header\s+(rollout|proof)\s+(is\s+)?(available|complete|shipped|supported)/i,
  /full\s+autosave\s+(is\s+)?(available|complete|shipped|supported)/i,
  /destructive\s+import\s+apply\s+(is\s+)?(available|complete|shipped|supported)/i,
  /data[- ]portability\s+parity\s+(is\s+)?(available|complete|shipped|supported)/i,
]

const NEGATED_CLAIM_PATTERNS = [
  /not\s+published\s+to\s+npm/i,
  /not\s+published\s+or\s+installable\s+outside\s+this\s+repo/i,
  /not\s+installable\s+outside\s+this\s+repo/i,
  /no\s+production\s+cache\s+purge\s+proof/i,
  /no\s+remote\s+performance\s+proof/i,
  /no\s+full\s+OpenAPI\s+generation/i,
  /no\s+GraphQL\s+parity\s+claim/i,
  /no\s+production\s+migration\s+(run|proof|claim)/i,
  /no\s+production\s+backup\s+(run|proof|claim)/i,
  /no\s+marketplace\s+(support|listing|plugin)\s+claim/i,
  /no\s+arbitrary\s+query\s+engine/i,
  /no\s+autonomous\s+AI\s+execution\s+claim/i,
  /no\s+unreviewed\s+(AI\s+)?mutation\s+claim/i,
  /no\s+(anonymous|public)\s+draft\s+(preview\s+)?route\s+claim/i,
  /no\s+production\s+security[- ]header\s+(rollout|proof|claim)/i,
  /no\s+full\s+autosave\s+claim/i,
  /no\s+destructive\s+import\s+apply\s+claim/i,
  /no\s+data[- ]portability\s+parity\s+claim/i,
]

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

export function scanClaims(root: string): string[] {
  const findings: string[] = []
  for (const file of listMarkdownFiles(root)) {
    const lines = readFileSync(file, 'utf8').split('\n')
    for (const [index, line] of lines.entries()) {
      if (NEGATED_CLAIM_PATTERNS.some((pattern) => pattern.test(line))) continue
      for (const pattern of CLAIM_PATTERNS) {
        if (pattern.test(line)) findings.push(`${file}:${index + 1}: ${pattern.source}`)
      }
    }
  }
  return findings
}

if (import.meta.main) {
  const root = process.argv[2] ?? 'docs/public'
  const findings = scanClaims(root)
  if (findings.length > 0) {
    console.error(findings.join('\n'))
    process.exit(1)
  }
  console.log(`Docs claim scan passed: ${root}`)
}
