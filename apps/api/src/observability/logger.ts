type LogLevel = 'debug' | 'info' | 'warn' | 'error'

function buildContext(level: LogLevel, context: Record<string, unknown>) {
  return {
    level,
    timestamp: new Date().toISOString(),
    ...context,
  } satisfies Record<string, unknown>
}

export const logger = {
  debug(message: string, context: Record<string, unknown> = {}) {
    if (process.env.DEBUG || process.env.NODE_ENV === 'development') {
      console.debug(message, buildContext('debug', context))
    }
  },
  info(message: string, context: Record<string, unknown> = {}) {
    console.log(message, buildContext('info', context))
  },
  warn(message: string, context: Record<string, unknown> = {}) {
    console.warn(message, buildContext('warn', context))
  },
  error(message: string, context: Record<string, unknown> = {}) {
    console.error(message, buildContext('error', context))
  },
}
