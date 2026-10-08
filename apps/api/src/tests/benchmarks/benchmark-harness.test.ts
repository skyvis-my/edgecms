import { describe, expect, it } from 'bun:test'
import { PUBLIC_READ_PERFORMANCE_GOALS } from '@/observability/performance-goals'
import {
  evaluateBenchmarkDurations,
  percentile,
  roundMs,
  runBenchmarkCase,
} from './benchmark-harness'

describe('benchmark harness deterministic evaluation (F03)', () => {
  describe('helper durability and empty sample rejection', () => {
    it('retains general helper behavior on empty arrays without crashing', () => {
      expect(percentile([], 0.5)).toBe(0)
      expect(percentile([], 0.95)).toBe(0)
      expect(roundMs(0)).toBe(0)
    })

    it('rejects empty durations at evaluation', () => {
      expect(() => evaluateBenchmarkDurations([])).toThrow(
        /benchmark evaluation rejected: measured durations cannot be empty/i
      )
    })

    it('rejects non-finite durations at evaluation', () => {
      expect(() => evaluateBenchmarkDurations([NaN])).toThrow(
        /benchmark evaluation rejected: measured durations must be finite numbers/i
      )
      expect(() => evaluateBenchmarkDurations([1.2, Infinity])).toThrow(
        /benchmark evaluation rejected: measured durations must be finite numbers/i
      )
      expect(() => evaluateBenchmarkDurations([1.2, -Infinity])).toThrow(
        /benchmark evaluation rejected: measured durations must be finite numbers/i
      )
    })

    it('rejects benchmark cases configured with zero or negative samples', async () => {
      const mockApp = {
        handle: () => new Response('ok', { status: 200 }),
      }

      await expect(
        runBenchmarkCase(mockApp, {
          name: 'zero sample check',
          request: () => new Request('http://localhost/test'),
          expectedStatus: 200,
          samples: 0,
        })
      ).rejects.toThrow(/requires at least 1 sample/i)
    })
  })

  describe('median and p95 budget separation', () => {
    it('does not describe a low median with a high p95 as a p95 pass', () => {
      // 18 samples at 0.4ms, 2 samples at 2.5ms (10% high) -> median is 0.4ms, p95 is 2.5ms
      const durations = [
        0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4,
        0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 2.5, 2.5,
      ]

      const evaluation = evaluateBenchmarkDurations(durations, { budgetMs: 1.0 })

      expect(evaluation.medianMs).toBe(0.4)
      expect(evaluation.p95Ms).toBe(2.5)

      // Legacy overBudget tracks medianMs > budgetMs
      expect(evaluation.overBudget).toBe(false)
      expect(evaluation.medianPassed).toBe(true)

      // Separately named p95 outcome MUST fail
      expect(evaluation.overP95Budget).toBe(true)
      expect(evaluation.p95Passed).toBe(false)
      expect(evaluation.passed).toBe(false)
    })

    it('passes both median and p95 when all samples are within budget', () => {
      const durations = [0.2, 0.3, 0.4, 0.5, 0.6]
      const evaluation = evaluateBenchmarkDurations(durations, { budgetMs: 1.0 })

      expect(evaluation.overBudget).toBe(false)
      expect(evaluation.overMedianBudget).toBe(false)
      expect(evaluation.overP95Budget).toBe(false)
      expect(evaluation.medianPassed).toBe(true)
      expect(evaluation.p95Passed).toBe(true)
      expect(evaluation.passed).toBe(true)
    })

    it('supports distinct medianBudgetMs and p95BudgetMs thresholds', () => {
      const durations = [0.6, 0.7, 0.8, 0.9, 1.8]
      const evaluation = evaluateBenchmarkDurations(durations, {
        medianBudgetMs: 1.0,
        p95BudgetMs: 2.0,
      })

      expect(evaluation.medianMs).toBe(0.8)
      expect(evaluation.p95Ms).toBe(1.8)
      expect(evaluation.medianPassed).toBe(true)
      expect(evaluation.p95Passed).toBe(true)
      expect(evaluation.passed).toBe(true)
    })
  })

  describe('timeout recording and failure preservation', () => {
    it('records a timeout as a failure in summary and fails evaluation', async () => {
      const slowApp = {
        handle: async () => {
          // Sleep longer than timeoutMs
          await new Promise((resolve) => setTimeout(resolve, 80))
          return new Response('ok', { status: 200 })
        },
      }

      const summary = await runBenchmarkCase(slowApp, {
        name: 'timeout benchmark',
        request: () => new Request('http://localhost/slow'),
        expectedStatus: 200,
        warmup: 0,
        samples: 2,
        timeoutMs: 20,
      })

      expect(summary.attempted).toBe(2)
      expect(summary.valid).toBe(0)
      expect(summary.failed).toBe(2)
      expect(summary.failures).toBeDefined()
      expect(summary.failures).toHaveLength(2)
      expect(summary.failures?.[0]?.timedOut).toBe(true)
      expect(summary.failures?.[0]?.error).toContain('timed out')

      // A run with timeouts cannot pass
      expect(summary.passed).toBe(false)
      expect(summary.p95Passed).toBe(false)
      expect(summary.overBudget).toBe(true)
    })
  })

  describe('scoped latency target preservation (50ms local, 100ms deployed)', () => {
    it('preserves the 50ms local and 100ms deployed goals as scoped targets', () => {
      expect(PUBLIC_READ_PERFORMANCE_GOALS.localP95Ms).toBe(50)
      expect(PUBLIC_READ_PERFORMANCE_GOALS.deployedP95Ms).toBe(100)
    })

    it('evaluates against scoped 50ms local target', () => {
      const passingLocalDurations = [20, 25, 30, 45]
      const passing = evaluateBenchmarkDurations(passingLocalDurations, {
        p95BudgetMs: PUBLIC_READ_PERFORMANCE_GOALS.localP95Ms,
      })
      expect(passing.p95Ms).toBe(45)
      expect(passing.p95Passed).toBe(true)

      const failingLocalDurations = [20, 30, 40, 55]
      const failing = evaluateBenchmarkDurations(failingLocalDurations, {
        p95BudgetMs: PUBLIC_READ_PERFORMANCE_GOALS.localP95Ms,
      })
      expect(failing.p95Ms).toBe(55)
      expect(failing.p95Passed).toBe(false)
    })

    it('evaluates against scoped 100ms deployed target', () => {
      const passingDeployedDurations = [60, 70, 80, 95]
      const passing = evaluateBenchmarkDurations(passingDeployedDurations, {
        p95BudgetMs: PUBLIC_READ_PERFORMANCE_GOALS.deployedP95Ms,
      })
      expect(passing.p95Ms).toBe(95)
      expect(passing.p95Passed).toBe(true)

      const failingDeployedDurations = [60, 70, 80, 110]
      const failing = evaluateBenchmarkDurations(failingDeployedDurations, {
        p95BudgetMs: PUBLIC_READ_PERFORMANCE_GOALS.deployedP95Ms,
      })
      expect(failing.p95Ms).toBe(110)
      expect(failing.p95Passed).toBe(false)
    })
  })
})
