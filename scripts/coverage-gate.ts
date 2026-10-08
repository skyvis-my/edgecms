import { readFileSync } from 'node:fs'

type MetricName = 'lines' | 'functions' | 'branches'

export interface CoverageSummary {
  lines: CoverageMetric
  functions: CoverageMetric
  branches: CoverageMetric
}

interface CoverageMetric {
  covered: number
  found: number
  percent: number
}

interface CoverageTarget {
  label: string
  path: string
}

interface CoverageOptions {
  targets: CoverageTarget[]
  minimums: Record<MetricName, number>
}

const DEFAULT_MINIMUMS: Record<MetricName, number> = {
  lines: 100,
  functions: 100,
  branches: 100,
}

function percent(covered: number, found: number) {
  if (found === 0) return 100
  return Number(((covered / found) * 100).toFixed(2))
}

export function parseLcov(content: string): CoverageSummary {
  const summary: CoverageSummary = {
    lines: { covered: 0, found: 0, percent: 100 },
    functions: { covered: 0, found: 0, percent: 100 },
    branches: { covered: 0, found: 0, percent: 100 },
  }

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    const [key, value] = line.split(':', 2)
    if (!key || value === undefined) continue

    const count = Number.parseInt(value, 10)
    if (!Number.isFinite(count)) continue

    if (key === 'LF') summary.lines.found += count
    if (key === 'LH') summary.lines.covered += count
    if (key === 'FNF') summary.functions.found += count
    if (key === 'FNH') summary.functions.covered += count
    if (key === 'BRF') summary.branches.found += count
    if (key === 'BRH') summary.branches.covered += count
  }

  for (const metric of Object.values(summary)) {
    metric.percent = percent(metric.covered, metric.found)
  }

  return summary
}

function parseTarget(value: string): CoverageTarget {
  const separator = value.indexOf(':')
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error(`Invalid --target value: ${value}. Use label:path/to/lcov.info`)
  }

  return {
    label: value.slice(0, separator),
    path: value.slice(separator + 1),
  }
}

export function parseCoverageOptions(args: string[]): CoverageOptions {
  const options: CoverageOptions = {
    targets: [],
    minimums: { ...DEFAULT_MINIMUMS },
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    const readValue = (name: string) => {
      const next = args[index + 1]
      if (!next) throw new Error(`${name} requires a value`)
      index += 1
      return next
    }

    if (arg === '--target') {
      options.targets.push(parseTarget(readValue('--target')))
      continue
    }
    if (arg.startsWith('--target=')) {
      options.targets.push(parseTarget(arg.slice('--target='.length)))
      continue
    }
    if (arg === '--min-lines') {
      options.minimums.lines = Number(readValue('--min-lines'))
      continue
    }
    if (arg.startsWith('--min-lines=')) {
      options.minimums.lines = Number(arg.slice('--min-lines='.length))
      continue
    }
    if (arg === '--min-functions') {
      options.minimums.functions = Number(readValue('--min-functions'))
      continue
    }
    if (arg.startsWith('--min-functions=')) {
      options.minimums.functions = Number(arg.slice('--min-functions='.length))
      continue
    }
    if (arg === '--min-branches') {
      options.minimums.branches = Number(readValue('--min-branches'))
      continue
    }
    if (arg.startsWith('--min-branches=')) {
      options.minimums.branches = Number(arg.slice('--min-branches='.length))
      continue
    }

    throw new Error(`Unsupported coverage gate option: ${arg}`)
  }

  if (options.targets.length === 0) {
    throw new Error('Coverage gate requires at least one --target label:path/to/lcov.info')
  }

  for (const [metric, minimum] of Object.entries(options.minimums)) {
    if (!Number.isFinite(minimum) || minimum < 0 || minimum > 100) {
      throw new Error(`Invalid ${metric} minimum: ${minimum}`)
    }
  }

  return options
}

export function formatCoverageSummary(label: string, summary: CoverageSummary) {
  return [
    `${label}:`,
    `  lines ${summary.lines.percent}% (${summary.lines.covered}/${summary.lines.found})`,
    `  functions ${summary.functions.percent}% (${summary.functions.covered}/${summary.functions.found})`,
    `  branches ${summary.branches.percent}% (${summary.branches.covered}/${summary.branches.found})`,
  ].join('\n')
}

function assertMinimums(label: string, summary: CoverageSummary, minimums: Record<MetricName, number>) {
  const failures = (Object.entries(minimums) as Array<[MetricName, number]>)
    .flatMap(([metric, minimum]) => {
      if (minimum > 0 && summary[metric].found === 0) {
        return [`${label} ${metric} has no coverage counters`]
      }
      if (summary[metric].percent < minimum) {
        return [`${label} ${metric} ${summary[metric].percent}% < ${minimum}%`]
      }
      return []
    })

  return failures
}

export function runCoverageGate(args: string[]) {
  const options = parseCoverageOptions(args)
  const failures: string[] = []

  for (const target of options.targets) {
    const summary = parseLcov(readFileSync(target.path, 'utf8'))
    console.log(formatCoverageSummary(target.label, summary))
    failures.push(...assertMinimums(target.label, summary, options.minimums))
  }

  if (failures.length > 0) {
    console.error(failures.map((failure) => `[FAIL] ${failure}`).join('\n'))
    return 1
  }

  console.log('[PASS] coverage gate')
  return 0
}

if (import.meta.main) {
  process.exitCode = runCoverageGate(Bun.argv.slice(2))
}
