export interface Logger {
  debug: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

type LogLevel = keyof Logger

const shouldLog = (level: LogLevel): boolean => {
  if (import.meta.env.MODE === 'test' || import.meta.env.VITEST) {
    return false
  }

  if (import.meta.env.DEV) {
    return true
  }

  return level === 'warn' || level === 'error'
}

const write = (level: LogLevel, args: unknown[]) => {
  if (!shouldLog(level)) return

  const target = level === 'debug' ? console.debug : console[level]
  target(...args)
}

export const logger: Logger = {
  debug: (...args) => write('debug', args),
  info: (...args) => write('info', args),
  warn: (...args) => write('warn', args),
  error: (...args) => write('error', args),
}
