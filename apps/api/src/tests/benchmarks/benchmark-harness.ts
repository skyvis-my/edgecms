export type BenchmarkRequestFactory = (iteration: number) => Request

export type BenchmarkCase = {
  name: string
  request: BenchmarkRequestFactory
  expectedStatus: number
  budgetMs?: number
  medianBudgetMs?: number
  p95BudgetMs?: number
  timeoutMs?: number
  warmup?: number
  samples?: number
  assertResponse?: (response: Response, body: string) => void | Promise<void>
}

export type BenchmarkFailure = {
  iteration: number
  phase: 'warmup' | 'sample'
  error: string
  timedOut: boolean
}

export type BenchmarkSummary = {
  name: string
  expectedStatus: number
  samples: number
  minMs: number
  medianMs: number
  p95Ms: number
  maxMs: number
  budgetMs: number
  // Legacy compatibility: overBudget reflects median > budgetMs
  overBudget: boolean
  // Separately named median and p95 budget outcomes:
  medianBudgetMs: number
  p95BudgetMs: number
  overMedianBudget: boolean
  overP95Budget: boolean
  medianPassed: boolean
  p95Passed: boolean
  passed: boolean
  // Counts and failures
  attempted?: number
  completed?: number
  valid?: number
  failed?: number
  failures?: BenchmarkFailure[]
}

export type BenchmarkEvaluationOptions = {
  budgetMs?: number
  medianBudgetMs?: number
  p95BudgetMs?: number
}

type AppLike = {
  handle(request: Request): Response | Promise<Response>
}

export const DEFAULT_BENCHMARK_BUDGET_MS = 1
export const DEFAULT_BENCHMARK_TIMEOUT_MS = 5000

async function consumeResponse(response: Response): Promise<string> {
  return response.text()
}

export function percentile(sorted: number[], ratio: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)
  return sorted[index] ?? 0
}

export function roundMs(value: number): number {
  return Number(value.toFixed(3))
}

export function evaluateBenchmarkDurations(
  durations: number[],
  options: BenchmarkEvaluationOptions = {}
): {
  samples: number
  minMs: number
  medianMs: number
  p95Ms: number
  maxMs: number
  budgetMs: number
  medianBudgetMs: number
  p95BudgetMs: number
  overBudget: boolean
  overMedianBudget: boolean
  overP95Budget: boolean
  medianPassed: boolean
  p95Passed: boolean
  passed: boolean
} {
  if (!Array.isArray(durations) || durations.length === 0) {
    throw new Error('Benchmark evaluation rejected: measured durations cannot be empty')
  }
  if (durations.some((d) => typeof d !== 'number' || !Number.isFinite(d))) {
    throw new Error('Benchmark evaluation rejected: measured durations must be finite numbers')
  }

  const sorted = [...durations].sort((a, b) => a - b)
  const minMs = roundMs(sorted[0] ?? 0)
  const maxMs = roundMs(sorted[sorted.length - 1] ?? 0)
  const medianMs = roundMs(percentile(sorted, 0.5))
  const p95Ms = roundMs(percentile(sorted, 0.95))

  const budgetMs = options.budgetMs ?? DEFAULT_BENCHMARK_BUDGET_MS
  const medianBudgetMs = options.medianBudgetMs ?? budgetMs
  const p95BudgetMs = options.p95BudgetMs ?? budgetMs

  // Legacy overBudget meaning: median > budgetMs
  const overBudget = medianMs > budgetMs
  const overMedianBudget = medianMs > medianBudgetMs
  const overP95Budget = p95Ms > p95BudgetMs
  const medianPassed = !overMedianBudget
  const p95Passed = !overP95Budget
  const passed = medianPassed && p95Passed

  return {
    samples: durations.length,
    minMs,
    medianMs,
    p95Ms,
    maxMs,
    budgetMs,
    medianBudgetMs,
    p95BudgetMs,
    overBudget,
    overMedianBudget,
    overP95Budget,
    medianPassed,
    p95Passed,
    passed,
  }
}

async function timedHandle(
  app: AppLike,
  request: Request,
  timeoutMs: number = DEFAULT_BENCHMARK_TIMEOUT_MS
): Promise<{
  status: number
  ms: number
  response: Response
  body: string
}> {
  let timer: ReturnType<typeof setTimeout> | undefined

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`Benchmark request timed out after ${timeoutMs}ms`)
      err.name = 'TimeoutError'
      reject(err)
    }, timeoutMs)
  })

  try {
    const handlePromise = (async () => {
      const start = process.hrtime.bigint()
      const response = await app.handle(request)
      const body = await consumeResponse(response)
      const end = process.hrtime.bigint()
      return {
        response,
        body,
        ms: Number(end - start) / 1_000_000,
      }
    })()

    const { response, body, ms } = await Promise.race([handlePromise, timeoutPromise])
    return {
      status: response.status,
      ms,
      response,
      body,
    }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function runBenchmarkCase(app: AppLike, testCase: BenchmarkCase): Promise<BenchmarkSummary> {
  const warmup = testCase.warmup ?? 10
  const samples = testCase.samples ?? 40
  const budgetMs = testCase.budgetMs ?? DEFAULT_BENCHMARK_BUDGET_MS
  const medianBudgetMs = testCase.medianBudgetMs ?? budgetMs
  const p95BudgetMs = testCase.p95BudgetMs ?? budgetMs
  const timeoutMs = testCase.timeoutMs ?? DEFAULT_BENCHMARK_TIMEOUT_MS

  if (samples <= 0) {
    throw new Error(`Benchmark case ${testCase.name} requires at least 1 sample`)
  }

  for (let i = 0; i < warmup; i++) {
    const result = await timedHandle(app, testCase.request(i), timeoutMs)
    if (result.status !== testCase.expectedStatus) {
      throw new Error(
        `${testCase.name} warmup returned ${result.status}, expected ${testCase.expectedStatus}`
      )
    }
    await testCase.assertResponse?.(result.response, result.body)
  }

  const durations: number[] = []
  const failures: BenchmarkFailure[] = []
  let completed = 0

  for (let i = 0; i < samples; i++) {
    try {
      const result = await timedHandle(app, testCase.request(i + warmup), timeoutMs)
      completed++
      if (result.status !== testCase.expectedStatus) {
        throw new Error(
          `${testCase.name} sample ${i} returned ${result.status}, expected ${testCase.expectedStatus}`
        )
      }
      await testCase.assertResponse?.(result.response, result.body)
      durations.push(result.ms)
    } catch (err: any) {
      const timedOut = err?.name === 'TimeoutError' || /timed out/i.test(err?.message ?? '')
      failures.push({
        iteration: i,
        phase: 'sample',
        error: err instanceof Error ? err.message : String(err),
        timedOut,
      })
    }
  }

  const failed = failures.length
  const valid = durations.length

  if (durations.length === 0) {
    return {
      name: testCase.name,
      expectedStatus: testCase.expectedStatus,
      samples,
      minMs: 0,
      medianMs: 0,
      p95Ms: 0,
      maxMs: 0,
      budgetMs,
      medianBudgetMs,
      p95BudgetMs,
      overBudget: true,
      overMedianBudget: true,
      overP95Budget: true,
      medianPassed: false,
      p95Passed: false,
      passed: false,
      attempted: samples,
      completed,
      valid: 0,
      failed,
      failures,
    }
  }

  const evaluation = evaluateBenchmarkDurations(durations, {
    budgetMs,
    medianBudgetMs,
    p95BudgetMs,
  })

  // If any samples failed, the benchmark case cannot pass overall
  const hasFailures = failed > 0
  const medianPassed = !hasFailures && evaluation.medianPassed
  const p95Passed = !hasFailures && evaluation.p95Passed
  const passed = !hasFailures && evaluation.passed
  const overBudget = hasFailures || evaluation.overBudget
  const overMedianBudget = hasFailures || evaluation.overMedianBudget
  const overP95Budget = hasFailures || evaluation.overP95Budget

  return {
    name: testCase.name,
    expectedStatus: testCase.expectedStatus,
    samples,
    minMs: evaluation.minMs,
    medianMs: evaluation.medianMs,
    p95Ms: evaluation.p95Ms,
    maxMs: evaluation.maxMs,
    budgetMs,
    medianBudgetMs,
    p95BudgetMs,
    overBudget,
    overMedianBudget,
    overP95Budget,
    medianPassed,
    p95Passed,
    passed,
    attempted: samples,
    completed,
    valid,
    failed,
    ...(failures.length > 0 ? { failures } : {}),
  }
}
