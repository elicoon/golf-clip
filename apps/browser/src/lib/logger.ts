export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

const LOG_LEVEL_METHOD: Record<LogLevel, 'log' | 'info' | 'warn' | 'error'> = {
  debug: 'log',
  info: 'info',
  warn: 'warn',
  error: 'error',
}

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void
  info(message: string, context?: Record<string, unknown>): void
  warn(message: string, context?: Record<string, unknown>): void
  error(message: string, context?: Record<string, unknown>): void
}

/**
 * Check if logging is enabled.
 * In production: silent by default, unless localStorage 'debug' key is set.
 * In development: always enabled.
 */
function isLoggingEnabled(): boolean {
  if (!import.meta.env.PROD) return true
  try {
    return localStorage.getItem('debug') !== null
  } catch {
    return false
  }
}

/**
 * Get the minimum log level.
 * Can be overridden via localStorage 'debug_level' (e.g. 'warn' to only see warn+error).
 * Defaults to 'debug' (show everything when logging is enabled).
 */
function getMinLevel(): LogLevel {
  try {
    const stored = localStorage.getItem('debug_level')
    if (stored && stored in LOG_LEVEL_PRIORITY) return stored as LogLevel
  } catch {
    // localStorage unavailable
  }
  return 'debug'
}

function formatTimestamp(): string {
  const now = new Date()
  const h = String(now.getHours()).padStart(2, '0')
  const m = String(now.getMinutes()).padStart(2, '0')
  const s = String(now.getSeconds()).padStart(2, '0')
  const ms = String(now.getMilliseconds()).padStart(3, '0')
  return `${h}:${m}:${s}.${ms}`
}

/**
 * Create a namespaced logger.
 *
 * Usage:
 *   const log = createLogger('ffmpeg-client')
 *   log.info('Audio extracted', { duration: 3.5 })
 *   // => [12:34:56.789] [INFO] [ffmpeg-client] Audio extracted { duration: 3.5 }
 */
export function createLogger(namespace: string): Logger {
  function log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (!isLoggingEnabled()) return
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[getMinLevel()]) return

    const prefix = `[${formatTimestamp()}] [${level.toUpperCase()}] [${namespace}]`
    const method = LOG_LEVEL_METHOD[level]

    if (context !== undefined) {
      console[method](prefix, message, context)
    } else {
      console[method](prefix, message)
    }
  }

  return {
    debug: (message, context?) => log('debug', message, context),
    info: (message, context?) => log('info', message, context),
    warn: (message, context?) => log('warn', message, context),
    error: (message, context?) => log('error', message, context),
  }
}
