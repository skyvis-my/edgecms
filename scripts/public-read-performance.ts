import { PUBLIC_READ_PERFORMANCE_GOALS } from '../apps/api/src/observability/performance-goals'

export type PublicReadPerformanceMode = 'local' | 'remote'
export type PublicReadProofType = 'local' | 'deployed' | 'remote'
export type PublicReadWorkloadKind = 'detail' | 'list' | 'singleton'

export type PublicReadWorkloadExpectation = {
  kind: PublicReadWorkloadKind
  expectedId?: string
  expectedSlug?: string
  expectedCollection?: string
  tenantMarker?: string
  allowEmpty?: boolean
}

export type PublicReadPerformanceOptions = {
  mode: PublicReadPerformanceMode
  baseURL: string
  path: string
  samples: number
  warmup: number
  timeoutMs?: number
  deploymentIdentity?: string
  expectation?: PublicReadWorkloadExpectation
}

export type PublicReadTimingSummary = {
  count: number
  minMs: number
  maxMs: number
  p50Ms: number
  p95Ms: number
}

export type PublicReadCounts = {
  attempted: number
  completed: number
  valid: number
  failed: number
}

export type PublicReadFailure = {
  iteration: number
  phase: 'warmup' | 'sample'
  error: string
  status?: number
  durationMs?: number
  timedOut: boolean
}

export type PublicReadPerformanceResult = {
  proof: PublicReadProofType
  goal: string
  url: string
  thresholdMs: number
  summary: PublicReadTimingSummary
  validationSummary?: PublicReadTimingSummary
  counts: PublicReadCounts
  failures?: PublicReadFailure[]
  deploymentIdentity?: string
  deploymentVerified: boolean
  passed: boolean
}

export type RemotePublicReadReceiptTemplate = {
  url: string
  command: string
  measuredAt: string
  p95Ms: number
  proof: 'deployed'
  deploymentIdentity?: string
}

export type TimedRequestResult = {
  durationMs: number
  validationMs: number
  status: number
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export type PublicReadResponseValidator = (response: Response, bodyText: string) => void

export type RunPublicReadPerformanceDependencies = {
  fetchFn?: FetchLike
  validator?: PublicReadResponseValidator
}

const localDefaultBaseURL = 'http://127.0.0.1:8787'
const localDefaultPath = '/api/public/posts'

function getArg(args: string[], name: string) {
  const inline = args.find((arg) => arg.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)

  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

function parsePositiveInteger(value: string | undefined, fallback: number, label: string) {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`)
  }
  return parsed
}

function parseNonNegativeInteger(value: string | undefined, fallback: number, label: string) {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer`)
  }
  return parsed
}

export function parsePublicReadPerformanceOptions(
  args: string[],
  env: Record<string, string | undefined> = process.env
): PublicReadPerformanceOptions {
  const mode = (getArg(args, '--mode') ?? 'local') as PublicReadPerformanceMode
  if (!['local', 'remote'].includes(mode)) {
    throw new Error(`Unsupported public read performance mode: ${mode}`)
  }

  const baseURL =
    getArg(args, '--base-url') ??
    env.EDGE_CMS_URL ??
    env.BASE_URL ??
    (mode === 'local' ? localDefaultBaseURL : undefined)
  const path =
    getArg(args, '--path') ??
    env.EDGE_CMS_PUBLIC_READ_PATH ??
    (mode === 'local' ? localDefaultPath : undefined)

  if (!baseURL) {
    throw new Error('Remote public read performance proof requires --base-url, EDGE_CMS_URL, or BASE_URL')
  }
  if (!path) {
    throw new Error('Public read performance proof requires --path or EDGE_CMS_PUBLIC_READ_PATH')
  }

  const expectedKind = (getArg(args, '--expected-kind') ?? env.EDGE_CMS_EXPECTED_KIND) as
    | PublicReadWorkloadKind
    | undefined
  if (expectedKind && !['detail', 'list', 'singleton'].includes(expectedKind)) {
    throw new Error(`Unsupported expected kind: ${expectedKind}`)
  }

  const expectedId = getArg(args, '--expected-id') ?? env.EDGE_CMS_EXPECTED_ID
  const expectedSlug = getArg(args, '--expected-slug') ?? env.EDGE_CMS_EXPECTED_SLUG
  const expectedCollection = getArg(args, '--expected-collection') ?? env.EDGE_CMS_EXPECTED_COLLECTION
  const tenantMarker = getArg(args, '--tenant-marker') ?? env.EDGE_CMS_TENANT_MARKER

  const allowEmptyRaw = getArg(args, '--allow-empty') ?? env.EDGE_CMS_ALLOW_EMPTY
  const hasAllowEmptyFlag = args.includes('--allow-empty')
  const allowEmpty = allowEmptyRaw !== undefined ? allowEmptyRaw !== 'false' : hasAllowEmptyFlag ? true : undefined

  let expectation: PublicReadWorkloadExpectation | undefined = undefined
  if (expectedKind || expectedId || expectedSlug || expectedCollection || tenantMarker || allowEmpty !== undefined) {
    if (!expectedKind) {
      throw new Error('--expected-kind (detail, list, or singleton) is required when configuring workload expectations')
    }
    expectation = {
      kind: expectedKind,
      ...(expectedId ? { expectedId } : {}),
      ...(expectedSlug ? { expectedSlug } : {}),
      ...(expectedCollection ? { expectedCollection } : {}),
      ...(tenantMarker ? { tenantMarker } : {}),
      allowEmpty: allowEmpty ?? false,
    }
  }

  const timeoutMsRaw = getArg(args, '--timeout-ms') ?? env.EDGE_CMS_REQUEST_TIMEOUT_MS
  const timeoutMs =
    timeoutMsRaw !== undefined
      ? parsePositiveInteger(timeoutMsRaw, 5000, '--timeout-ms')
      : undefined
  const deploymentIdentity =
    getArg(args, '--deployment-id') ??
    getArg(args, '--deployment-identity') ??
    env.EDGE_CMS_DEPLOYMENT_ID ??
    env.EDGE_CMS_DEPLOYMENT_IDENTITY

  const parsed: PublicReadPerformanceOptions = {
    mode,
    baseURL,
    path,
    samples: parsePositiveInteger(getArg(args, '--samples'), 20, '--samples'),
    warmup: parseNonNegativeInteger(getArg(args, '--warmup'), 3, '--warmup'),
  }
  if (timeoutMs !== undefined) {
    parsed.timeoutMs = timeoutMs
  }
  if (deploymentIdentity) {
    parsed.deploymentIdentity = deploymentIdentity
  }
  if (expectation) {
    parsed.expectation = expectation
  }
  return parsed
}

export function buildBenchmarkURL(baseURL: string, path: string) {
  return new URL(path, baseURL.endsWith('/') ? baseURL : `${baseURL}/`).toString()
}

export function percentile(durationsMs: number[], rank: number) {
  if (durationsMs.length === 0) return 0
  const sorted = [...durationsMs].sort((a, b) => a - b)
  const index = Math.max(0, Math.ceil((rank / 100) * sorted.length) - 1)
  return sorted[index] ?? 0
}

function roundMs(value: number) {
  return Number(value.toFixed(2))
}

export function summarizeDurations(durationsMs: number[]): PublicReadTimingSummary {
  if (durationsMs.length === 0) {
    return { count: 0, minMs: 0, maxMs: 0, p50Ms: 0, p95Ms: 0 }
  }

  return {
    count: durationsMs.length,
    minMs: roundMs(Math.min(...durationsMs)),
    maxMs: roundMs(Math.max(...durationsMs)),
    p50Ms: roundMs(percentile(durationsMs, 50)),
    p95Ms: roundMs(percentile(durationsMs, 95)),
  }
}

export function evaluatePublicReadTimings(options: {
  mode: PublicReadPerformanceMode
  baseURL: string
  path: string
  durationsMs: number[]
  validationDurationsMs?: number[]
  counts?: PublicReadCounts
  failures?: PublicReadFailure[]
  deploymentIdentity?: string
}): PublicReadPerformanceResult {
  if (options.durationsMs.some((d) => typeof d !== 'number' || !Number.isFinite(d))) {
    throw new Error('Evaluation rejected: measured durations must be finite numbers')
  }
  if (options.durationsMs.length === 0 && (!options.counts || options.counts.valid > 0)) {
    throw new Error('Evaluation rejected: measured durations cannot be empty')
  }

  const deploymentVerified = options.mode === 'remote' && Boolean(options.deploymentIdentity)
  const proof: PublicReadProofType =
    options.mode === 'local'
      ? 'local'
      : deploymentVerified
        ? 'deployed'
        : 'remote'

  const thresholdMs =
    options.mode === 'local'
      ? PUBLIC_READ_PERFORMANCE_GOALS.localP95Ms
      : PUBLIC_READ_PERFORMANCE_GOALS.deployedP95Ms

  const summary = summarizeDurations(options.durationsMs)
  const validationSummary =
    options.validationDurationsMs && options.validationDurationsMs.length > 0
      ? summarizeDurations(options.validationDurationsMs)
      : undefined

  const counts: PublicReadCounts = options.counts ?? {
    attempted: options.durationsMs.length,
    completed: options.durationsMs.length,
    valid: options.durationsMs.length,
    failed: 0,
  }

  const goal =
    options.mode === 'local'
      ? 'Local public read p95'
      : deploymentVerified
        ? 'Deployed public read p95'
        : 'Remote (unverified) public read p95'

  const passed =
    counts.failed === 0 &&
    counts.valid > 0 &&
    options.durationsMs.length > 0 &&
    summary.p95Ms <= thresholdMs

  const result: PublicReadPerformanceResult = {
    proof,
    goal,
    url: buildBenchmarkURL(options.baseURL, options.path),
    thresholdMs,
    summary,
    counts,
    deploymentVerified,
    passed,
  }
  if (validationSummary) {
    result.validationSummary = validationSummary
  }
  if (options.failures && options.failures.length > 0) {
    result.failures = options.failures
  }
  if (options.deploymentIdentity) {
    result.deploymentIdentity = options.deploymentIdentity
  }
  return result
}

export function buildRemotePublicReadReceiptTemplate(
  result: PublicReadPerformanceResult,
  command: string,
  measuredAt: string
): RemotePublicReadReceiptTemplate {
  if (result.proof !== 'deployed' || !result.deploymentVerified) {
    throw new Error('Remote public-read receipt requires deployed proof with verified deployment identity')
  }
  const template: RemotePublicReadReceiptTemplate = {
    url: result.url,
    command,
    measuredAt,
    p95Ms: result.summary.p95Ms,
    proof: 'deployed',
  }
  if (result.deploymentIdentity) {
    template.deploymentIdentity = result.deploymentIdentity
  }
  return template
}

export function validatePublicReadResponse(
  response: Response,
  bodyText: string,
  expectation: PublicReadWorkloadExpectation
): void {
  if (response.redirected) {
    throw new Error(`Unexpected redirect response: redirected to ${response.url || 'unintended endpoint'}`)
  }
  if (response.status >= 300 && response.status < 400) {
    throw new Error(`Unexpected redirect response with HTTP ${response.status}`)
  }
  if (response.status !== 200) {
    throw new Error(`Expected HTTP 200, received HTTP ${response.status}`)
  }

  const contentType = response.headers.get('content-type') ?? ''
  const mimeType = contentType.split(';')[0]?.trim().toLowerCase()
  if (mimeType !== 'application/json') {
    throw new Error(`Expected application/json content-type, received ${contentType || 'none'}`)
  }

  let payload: any
  try {
    payload = JSON.parse(bodyText)
  } catch (err) {
    throw new Error(`Malformed JSON response: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (typeof payload !== 'object' || payload === null) {
    throw new Error('Expected JSON object payload in public response')
  }

  if ('error' in payload && Boolean(payload.error)) {
    const errorMsg = typeof payload.error === 'string' ? payload.error : JSON.stringify(payload.error)
    throw new Error(`Business error in public response: ${errorMsg}`)
  }
  if ('success' in payload && payload.success === false) {
    throw new Error(`Business error in public response: ${payload.error ?? 'unsuccessful'}`)
  }

  const collectionSlugOrId = payload.collection?.slug ?? payload.collection?.id
  if (expectation.expectedCollection !== undefined && collectionSlugOrId !== expectation.expectedCollection) {
    throw new Error(
      `Fixture mismatch: expected collection '${expectation.expectedCollection}', received '${collectionSlugOrId}'`
    )
  }

  if (expectation.kind === 'detail' || expectation.kind === 'singleton') {
    if (!payload.entry || typeof payload.entry !== 'object') {
      throw new Error(`Expected ${expectation.kind} payload to contain 'entry' object`)
    }
    if (expectation.expectedId !== undefined && payload.entry.id !== expectation.expectedId) {
      throw new Error(
        `Fixture mismatch: expected entry ID '${expectation.expectedId}', received '${payload.entry.id}'`
      )
    }
    if (expectation.expectedSlug !== undefined && payload.entry.slug !== expectation.expectedSlug) {
      throw new Error(
        `Fixture mismatch: expected entry slug '${expectation.expectedSlug}', received '${payload.entry.slug}'`
      )
    }
  } else if (expectation.kind === 'list') {
    if (!Array.isArray(payload.entries)) {
      throw new Error("List payload missing 'entries' array")
    }
    if (typeof payload.total !== 'number') {
      throw new Error("List payload missing 'total' count")
    }

    if (payload.entries.length === 0) {
      if (!expectation.allowEmpty) {
        throw new Error('Unexpected empty list in public read response')
      }
    } else {
      if (
        expectation.expectedId !== undefined &&
        !payload.entries.some((entry: any) => entry?.id === expectation.expectedId)
      ) {
        throw new Error(`Expected entry fixture ID '${expectation.expectedId}' not found in list response`)
      }
      if (
        expectation.expectedSlug !== undefined &&
        !payload.entries.some((entry: any) => entry?.slug === expectation.expectedSlug)
      ) {
        throw new Error(`Expected entry slug '${expectation.expectedSlug}' not found in list response`)
      }
    }
  }

  if (expectation.tenantMarker !== undefined) {
    if (typeof payload.tenantId === 'string') {
      if (payload.tenantId !== expectation.tenantMarker) {
        throw new Error(
          `Tenant mismatch: expected tenant '${expectation.tenantMarker}', received '${payload.tenantId}'`
        )
      }
    } else {
      const payloadString = JSON.stringify(payload)
      if (!payloadString.includes(expectation.tenantMarker)) {
        throw new Error(`Tenant marker '${expectation.tenantMarker}' not found in public read response`)
      }
    }
  }
}

export function createWorkloadValidator(expectation: PublicReadWorkloadExpectation): PublicReadResponseValidator {
  return (response: Response, bodyText: string) => {
    validatePublicReadResponse(response, bodyText, expectation)
  }
}

export async function timeAndValidateRequest(options: {
  url: string
  validator: PublicReadResponseValidator
  fetchFn?: FetchLike
  timeoutMs?: number
}): Promise<TimedRequestResult> {
  const fetchFn = options.fetchFn ?? fetch
  const timeoutMs = options.timeoutMs ?? 5000

  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const timeoutErr = new Error(`Request timed out after ${timeoutMs}ms`)
      timeoutErr.name = 'TimeoutError'
      controller.abort(timeoutErr)
      reject(timeoutErr)
    }, timeoutMs)
  })

  const startedAt = performance.now()
  let response: Response
  let bodyText: string
  try {
    const executePromise = (async () => {
      const res = await fetchFn(options.url, { signal: controller.signal })
      const text = await res.text()
      return { res, text }
    })()

    const outcome = await Promise.race([executePromise, timeoutPromise])
    response = outcome.res
    bodyText = outcome.text
  } catch (err: any) {
    if (controller.signal.aborted || err?.name === 'TimeoutError') {
      const timeoutErr = new Error(`Request timed out after ${timeoutMs}ms`)
      timeoutErr.name = 'TimeoutError'
      throw timeoutErr
    }
    throw err
  } finally {
    if (timer) clearTimeout(timer)
  }

  const durationMs = roundMs(performance.now() - startedAt)

  const validationStartedAt = performance.now()
  options.validator(response, bodyText)
  const validationMs = roundMs(performance.now() - validationStartedAt)

  return {
    durationMs,
    validationMs,
    status: response.status,
  }
}

export async function runPublicReadPerformance(
  options: PublicReadPerformanceOptions,
  dependencies: RunPublicReadPerformanceDependencies = {}
): Promise<PublicReadPerformanceResult> {
  const validator =
    dependencies.validator ??
    (options.expectation ? createWorkloadValidator(options.expectation) : undefined)

  if (!validator) {
    throw new Error('Public read performance proof requires workload expectation or validator')
  }

  const fetchFn = dependencies.fetchFn ?? fetch
  const url = buildBenchmarkURL(options.baseURL, options.path)
  const timeoutMs = options.timeoutMs ?? 5000

  for (let index = 0; index < options.warmup; index += 1) {
    await timeAndValidateRequest({ url, validator, fetchFn, timeoutMs })
  }

  const durationsMs: number[] = []
  const validationDurationsMs: number[] = []
  const failures: PublicReadFailure[] = []
  let completed = 0

  for (let index = 0; index < options.samples; index += 1) {
    try {
      const timed = await timeAndValidateRequest({ url, validator, fetchFn, timeoutMs })
      completed += 1
      durationsMs.push(timed.durationMs)
      validationDurationsMs.push(timed.validationMs)
    } catch (err: any) {
      const timedOut = err?.name === 'TimeoutError' || /timed out/i.test(err?.message ?? '')
      if (err?.status !== undefined) {
        completed += 1
      }
      failures.push({
        iteration: index,
        phase: 'sample',
        error: err instanceof Error ? err.message : String(err),
        timedOut,
        status: err?.status,
      })
    }
  }

  const counts: PublicReadCounts = {
    attempted: options.samples,
    completed,
    valid: durationsMs.length,
    failed: failures.length,
  }

  return evaluatePublicReadTimings({
    ...options,
    durationsMs,
    validationDurationsMs: durationsMs.length > 0 ? validationDurationsMs : undefined,
    counts,
    failures: failures.length > 0 ? failures : undefined,
  })
}

export async function main(args = Bun.argv.slice(2)) {
  const result = await runPublicReadPerformance(parsePublicReadPerformanceOptions(args))
  console.log(JSON.stringify(result, null, 2))
  if (!result.passed) process.exit(1)
}

if (import.meta.main) {
  await main()
}

