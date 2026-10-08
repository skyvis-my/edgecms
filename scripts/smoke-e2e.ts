export type SmokeMode = 'local' | 'local-live' | 'remote'

export type SmokeOptions = {
  mode: SmokeMode
  full: boolean
  livePersisted: boolean
  baseURL?: string
}

type CommandResult = {
  name: string
  command: string
  status: 'passed' | 'failed'
  exitCode: number
  durationMs: number
}

type HealthStatus = {
  url: string
  ok: boolean
  statusCode?: number
  status?: string
  error?: string
}

const repoRoot = new URL('..', import.meta.url).pathname
const adminDir = new URL('../apps/admin', import.meta.url).pathname
const apiDir = new URL('../apps/api', import.meta.url).pathname
const localAdminUrl = 'http://127.0.0.1:4173'
const localApiHealthUrl = 'http://127.0.0.1:8787/api/health'
const defaultSmokeAdminEmail = 'smoke.admin@example.com'
const artifactPaths = ['apps/admin/.playwright/test-results']

function getArg(args: string[], name: string) {
  const inline = args.find((arg) => arg.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)

  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

export function parseSmokeOptions(
  args: string[],
  env: Record<string, string | undefined> = process.env
): SmokeOptions {
  const mode = (getArg(args, '--mode') ?? 'local') as SmokeMode
  const full = args.includes('--full')
  const livePersisted = args.includes('--live-persisted') || env.E2E_LIVE_PERSISTED === '1'
  const baseURL = getArg(args, '--base-url') ?? env.BASE_URL

  if (!['local', 'local-live', 'remote'].includes(mode)) {
    throw new Error(`Unsupported smoke mode: ${mode}`)
  }

  if (mode === 'remote' && !baseURL) {
    throw new Error('Remote smoke requires --base-url or BASE_URL')
  }

  return { mode, full, livePersisted, baseURL }
}

export function commandText(cmd: string[]) {
  return cmd.map((part) => (part.includes(' ') ? JSON.stringify(part) : part)).join(' ')
}

export function isHealthyStatus(status: unknown) {
  return status === 'ok' || status === 'degraded'
}

const runSmoke = async (options: SmokeOptions) => {
  const commands: CommandResult[] = []
  const failedSpecNames: string[] = []

  const runCommand = async (
    name: string,
    cmd: string[],
    commandOptions: { cwd?: string; env?: Record<string, string | undefined> } = {}
  ) => {
    const startedAt = Date.now()
    const proc = Bun.spawn(cmd, {
      cwd: commandOptions.cwd ?? repoRoot,
      env: {
        ...process.env,
        ...commandOptions.env,
      },
      stdout: 'inherit',
      stderr: 'inherit',
    })

    const exitCode = await proc.exited
    const result: CommandResult = {
      name,
      command: commandText(cmd),
      status: exitCode === 0 ? 'passed' : 'failed',
      exitCode,
      durationMs: Date.now() - startedAt,
    }
    commands.push(result)

    if (exitCode !== 0) {
      throw new Error(`${name} failed with exit code ${exitCode}`)
    }
  }

  const ensureChromium = async () => {
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    if (executablePath) {
      if (!(await Bun.file(executablePath).exists())) {
        throw new Error(`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH does not exist: ${executablePath}`)
      }
      return
    }

    await runCommand('ensure playwright chromium', [
      'bunx',
      'playwright',
      'install',
      ...(process.env.CI ? ['--with-deps'] : []),
      'chromium',
    ])
  }

  const fetchHealth = async (url: string): Promise<HealthStatus> => {
    try {
      const response = await fetch(url)
      const body = (await response.json().catch(() => ({}))) as { status?: string }
      const health = {
        url,
        ok: response.ok,
        statusCode: response.status,
        status: body.status,
      }

      if (!response.ok) return health
      if (!isHealthyStatus(body.status)) {
        return { ...health, ok: false }
      }
      return health
    } catch (error) {
      return {
        url,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  const waitForHealth = async (url: string) => {
    const deadline = Date.now() + 120_000
    let lastHealth: HealthStatus = { url, ok: false, error: 'not checked' }

    while (Date.now() < deadline) {
      lastHealth = await fetchHealth(url)
      if (lastHealth.ok) return lastHealth
      await Bun.sleep(1_000)
    }

    return lastHealth
  }

  const waitForPage = async (url: string) => {
    const deadline = Date.now() + 120_000
    let lastError = 'not checked'

    while (Date.now() < deadline) {
      try {
        const response = await fetch(url)
        if (response.ok) return
        lastError = `HTTP ${response.status}`
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
      }
      await Bun.sleep(1_000)
    }

    throw new Error(`Timed out waiting for ${url}: ${lastError}`)
  }

  const startServer = (
    name: string,
    cmd: string[],
    commandOptions: { cwd: string; env?: Record<string, string | undefined> }
  ) => {
    const proc = Bun.spawn(cmd, {
      cwd: commandOptions.cwd,
      env: {
        ...process.env,
        ...commandOptions.env,
      },
      stdout: 'inherit',
      stderr: 'inherit',
    })

    commands.push({
      name,
      command: commandText(cmd),
      status: 'passed',
      exitCode: 0,
      durationMs: 0,
    })

    return proc
  }

  const stopServer = async (proc: Bun.Subprocess<'inherit', 'inherit', 'pipe'>) => {
    proc.kill()
    await Promise.race([proc.exited, Bun.sleep(5_000)])
  }

  const runStaticPreflight = async () => {
    await runCommand('check merge markers', ['bun', 'run', 'check:merge-markers'])
    await runCommand('api public route tests', [
      'bun',
      'run',
      '--filter',
      'edgecms-api',
      'test',
      'src/tests/public',
    ])
    await runCommand('admin typecheck', ['bun', 'run', '--filter', 'edgecms-admin', 'typecheck'])
    await runCommand('admin build', ['bun', 'run', '--filter', 'edgecms-admin', 'build'])
  }

  const runPrdSmoke = async (env: Record<string, string | undefined> = {}) => {
    const specArgs = ['e2e/prd-smoke.spec.ts']
    if (options.full) specArgs.push('e2e/comprehensive-e2e.spec.ts')

    try {
      await runCommand('playwright prd smoke', ['bunx', 'playwright', 'test', ...specArgs], {
        cwd: adminDir,
        env,
      })
    } catch (error) {
      failedSpecNames.push(...specArgs)
      throw error
    }
  }

  const runLiveApiSmoke = async () => {
    try {
      await runCommand('playwright live api smoke', ['bunx', 'playwright', 'test', 'e2e/live-api.integration.spec.ts'], {
        cwd: adminDir,
        env: {
          BASE_URL: localAdminUrl,
          E2E_LIVE_API: '1',
        },
      })
    } catch (error) {
      failedSpecNames.push('e2e/live-api.integration.spec.ts')
      throw error
    }
  }

  const runLivePersistedSmoke = async (baseURL: string) => {
    const localDefaults: Record<string, string> = {
      E2E_ADMIN_EMAIL: defaultSmokeAdminEmail,
      E2E_ADMIN_PASSWORD: 'SmokePassw0rd!',
      E2E_TENANT_SLUG: 'smoke',
      E2E_COLLECTION_SLUG: 'smoke-posts',
    }
    const effectiveEnv: Record<string, string> = {}
    const requiredEnv = [
      'E2E_ADMIN_EMAIL',
      'E2E_ADMIN_PASSWORD',
      'E2E_TENANT_SLUG',
      'E2E_COLLECTION_SLUG',
    ]
    for (const key of requiredEnv) {
      const val = process.env[key] ?? (options.mode === 'local-live' ? localDefaults[key] : undefined)
      if (val) {
        effectiveEnv[key] = val
      }
    }
    const missingEnv = requiredEnv.filter((key) => !effectiveEnv[key])
    if (missingEnv.length > 0) {
      throw new Error(`Live persisted smoke requires seed env: ${missingEnv.join(', ')}`)
    }

    try {
      await runCommand(
        'playwright live persisted smoke',
        ['bunx', 'playwright', 'test', 'e2e/live-persisted.spec.ts'],
        {
          cwd: adminDir,
          env: {
            BASE_URL: baseURL,
            E2E_LIVE_PERSISTED: '1',
            ...effectiveEnv,
          },
        }
      )
    } catch (error) {
      failedSpecNames.push('e2e/live-persisted.spec.ts')
      throw error
    }
  }

  let healthStatus: HealthStatus | undefined
  let apiServer: ReturnType<typeof startServer> | undefined
  let adminServer: ReturnType<typeof startServer> | undefined
  let failed = false
  let failureMessage: string | undefined

  try {
    await runStaticPreflight()
    if (options.mode === 'local-live') {
      await runCommand('api typecheck', ['bun', 'run', '--filter', 'edgecms-api', 'typecheck'])
    }

    await ensureChromium()

    if (options.mode === 'remote') {
      healthStatus = await fetchHealth(new URL('/api/health', options.baseURL).toString())
      if (!healthStatus.ok) {
        throw new Error(`Health check failed: ${JSON.stringify(healthStatus)}`)
      }
      await runPrdSmoke({ BASE_URL: options.baseURL })
      if (options.livePersisted) {
        await runLivePersistedSmoke(options.baseURL)
      }
    }

    if (options.mode === 'local') {
      await runPrdSmoke()
    }

    if (options.mode === 'local-live') {
      if (options.livePersisted) {
        await runCommand('seed local d1 smoke db', ['bun', 'run', 'scripts/seed-smoke-db.ts'])
      }
      apiServer = startServer(
        'start local api',
        [
          'bun',
          'run',
          'dev',
          '--port',
          '8787',
          '--var',
          'BETTER_AUTH_SECRET:test-secret-at-least-32-characters',
          '--var',
          `SUPER_ADMIN_EMAILS:${process.env.E2E_ADMIN_EMAIL ?? defaultSmokeAdminEmail}`,
        ],
        { cwd: apiDir }
      )
      healthStatus = await waitForHealth(localApiHealthUrl)
      if (!healthStatus.ok) {
        throw new Error(`Local health check failed: ${JSON.stringify(healthStatus)}`)
      }

      adminServer = startServer('start local admin', ['bun', 'run', 'dev', '--host', '127.0.0.1', '--port', '4173'], {
        cwd: adminDir,
      })
      await waitForPage(localAdminUrl)
      await runLiveApiSmoke()
      if (options.livePersisted) {
        await runLivePersistedSmoke(localAdminUrl)
      }
    }
  } catch (error) {
    failed = true
    failureMessage = error instanceof Error ? error.message : String(error)
  } finally {
    if (adminServer) await stopServer(adminServer)
    if (apiServer) await stopServer(apiServer)
  }

  return {
    mode: options.mode,
    baseURL: options.mode === 'remote' ? options.baseURL : options.mode === 'local-live' ? localAdminUrl : undefined,
    commands,
    pass: !failed,
    failedSpecNames,
    healthStatus,
    artifactPaths: failed ? artifactPaths : [],
    error: failureMessage,
  }
}

export async function main(args = Bun.argv.slice(2)) {
  const summary = await runSmoke(parseSmokeOptions(args))
  console.log(JSON.stringify(summary, null, 2))
  if (!summary.pass) process.exit(1)
}

if (import.meta.main) {
  await main()
}
