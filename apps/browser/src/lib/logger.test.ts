/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
describe('logger', () => {
  let consoleSpy: {
    log: ReturnType<typeof vi.spyOn>
    info: ReturnType<typeof vi.spyOn>
    warn: ReturnType<typeof vi.spyOn>
    error: ReturnType<typeof vi.spyOn>
  }

  beforeEach(() => {
    vi.resetModules()
    consoleSpy = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      info: vi.spyOn(console, 'info').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    }
    // Clear localStorage between tests
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  describe('dev mode (default)', () => {
    it('logs messages with structured prefix', async () => {
      const { createLogger } = await import('./logger')
      const log = createLogger('test-ns')

      log.info('hello world')

      expect(consoleSpy.info).toHaveBeenCalledOnce()
      const [prefix, message] = consoleSpy.info.mock.calls[0]
      expect(prefix).toMatch(/\[\d{2}:\d{2}:\d{2}\.\d{3}\] \[INFO\] \[test-ns\]/)
      expect(message).toBe('hello world')
    })

    it('logs at all levels', async () => {
      const { createLogger } = await import('./logger')
      const log = createLogger('multi')

      log.debug('d')
      log.info('i')
      log.warn('w')
      log.error('e')

      expect(consoleSpy.log).toHaveBeenCalledOnce() // debug uses console.log
      expect(consoleSpy.info).toHaveBeenCalledOnce()
      expect(consoleSpy.warn).toHaveBeenCalledOnce()
      expect(consoleSpy.error).toHaveBeenCalledOnce()
    })

    it('includes context object when provided', async () => {
      const { createLogger } = await import('./logger')
      const log = createLogger('ctx')

      const context = { duration: 3.5, codec: 'h264' }
      log.info('exported', context)

      expect(consoleSpy.info).toHaveBeenCalledOnce()
      const args = consoleSpy.info.mock.calls[0]
      expect(args).toHaveLength(3) // prefix, message, context
      expect(args[2]).toEqual(context)
    })

    it('omits context argument when not provided', async () => {
      const { createLogger } = await import('./logger')
      const log = createLogger('no-ctx')

      log.info('simple message')

      const args = consoleSpy.info.mock.calls[0]
      expect(args).toHaveLength(2) // prefix, message only
    })

    it('uses correct console method for each level', async () => {
      const { createLogger } = await import('./logger')
      const log = createLogger('methods')

      log.debug('d')
      expect(consoleSpy.log).toHaveBeenCalledOnce()

      log.info('i')
      expect(consoleSpy.info).toHaveBeenCalledOnce()

      log.warn('w')
      expect(consoleSpy.warn).toHaveBeenCalledOnce()

      log.error('e')
      expect(consoleSpy.error).toHaveBeenCalledOnce()
    })
  })

  describe('production mode', () => {
    it('is silent in production by default', async () => {
      vi.stubEnv('PROD', true as unknown as string)

      const { createLogger } = await import('./logger')
      const log = createLogger('prod')

      log.debug('d')
      log.info('i')
      log.warn('w')
      log.error('e')

      expect(consoleSpy.log).not.toHaveBeenCalled()
      expect(consoleSpy.info).not.toHaveBeenCalled()
      expect(consoleSpy.warn).not.toHaveBeenCalled()
      expect(consoleSpy.error).not.toHaveBeenCalled()
    })

    it('logs in production when localStorage debug flag is set', async () => {
      vi.stubEnv('PROD', true as unknown as string)
      localStorage.setItem('debug', '1')

      const { createLogger } = await import('./logger')
      const log = createLogger('prod-debug')

      log.info('visible in prod')

      expect(consoleSpy.info).toHaveBeenCalledOnce()
    })
  })

  describe('log level filtering', () => {
    it('respects debug_level from localStorage', async () => {
      localStorage.setItem('debug_level', 'warn')

      const { createLogger } = await import('./logger')
      const log = createLogger('filtered')

      log.debug('hidden')
      log.info('hidden')
      log.warn('visible')
      log.error('visible')

      expect(consoleSpy.log).not.toHaveBeenCalled()
      expect(consoleSpy.info).not.toHaveBeenCalled()
      expect(consoleSpy.warn).toHaveBeenCalledOnce()
      expect(consoleSpy.error).toHaveBeenCalledOnce()
    })

    it('defaults to debug level when debug_level is not set', async () => {
      const { createLogger } = await import('./logger')
      const log = createLogger('all')

      log.debug('visible')
      log.info('visible')

      expect(consoleSpy.log).toHaveBeenCalledOnce()
      expect(consoleSpy.info).toHaveBeenCalledOnce()
    })

    it('ignores invalid debug_level values', async () => {
      localStorage.setItem('debug_level', 'invalid')

      const { createLogger } = await import('./logger')
      const log = createLogger('fallback')

      log.debug('visible')

      expect(consoleSpy.log).toHaveBeenCalledOnce()
    })
  })

  describe('namespace isolation', () => {
    it('different namespaces produce different prefixes', async () => {
      const { createLogger } = await import('./logger')
      const logA = createLogger('module-a')
      const logB = createLogger('module-b')

      logA.info('from A')
      logB.info('from B')

      const prefixA = consoleSpy.info.mock.calls[0][0] as string
      const prefixB = consoleSpy.info.mock.calls[1][0] as string

      expect(prefixA).toContain('[module-a]')
      expect(prefixB).toContain('[module-b]')
    })
  })

  describe('timestamp format', () => {
    it('includes HH:MM:SS.mmm timestamp', async () => {
      const { createLogger } = await import('./logger')
      const log = createLogger('time')

      log.info('check time')

      const prefix = consoleSpy.info.mock.calls[0][0] as string
      // Match [HH:MM:SS.mmm]
      expect(prefix).toMatch(/\[\d{2}:\d{2}:\d{2}\.\d{3}\]/)
    })
  })
})
