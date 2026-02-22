import { describe, it, expect, vi, beforeEach } from 'vitest'

// Note: FFmpeg.wasm requires a real browser environment with SharedArrayBuffer
// These tests verify the module interface and error handling without browser APIs

describe('transcodeHevcToH264', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  // Removed test that only verified AbortController works, not our implementation

  it('throws when transcoding without loading FFmpeg first', async () => {
    const { transcodeHevcToH264 } = await import('./ffmpeg-client')
    const testBlob = new Blob(['test'], { type: 'video/mp4' })

    await expect(transcodeHevcToH264(testBlob)).rejects.toThrow(
      'FFmpeg not loaded. Call loadFFmpeg() first.'
    )
  })

  it('throws AbortError when signal is already aborted', async () => {
    // Mock FFmpeg as loaded to test abort behavior
    vi.doMock('@ffmpeg/ffmpeg', () => ({
      FFmpeg: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
        this.load = vi.fn().mockResolvedValue(undefined)
        this.on = vi.fn()
        this.off = vi.fn()
        this.writeFile = vi.fn().mockResolvedValue(undefined)
        this.exec = vi.fn().mockResolvedValue(0)
        this.readFile = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]))
        this.deleteFile = vi.fn().mockResolvedValue(undefined)
      }),
    }))

    vi.doMock('@ffmpeg/util', () => ({
      toBlobURL: vi.fn().mockResolvedValue('blob:mock'),
      fetchFile: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    }))

    const { loadFFmpeg, transcodeHevcToH264 } = await import('./ffmpeg-client')
    await loadFFmpeg()

    const testBlob = new Blob(['test'], { type: 'video/mp4' })
    const abortController = new AbortController()
    abortController.abort()

    await expect(transcodeHevcToH264(testBlob, undefined, abortController.signal)).rejects.toThrow('Transcoding cancelled')
  })
})

describe('muxAudioIntoClip', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('throws when FFmpeg is not loaded', async () => {
    const { muxAudioIntoClip } = await import('./ffmpeg-client')
    const videoBlob = new Blob(['video'], { type: 'video/mp4' })
    const sourceBlob = new Blob(['source'], { type: 'video/mp4' })

    await expect(muxAudioIntoClip(videoBlob, sourceBlob, 0, 5)).rejects.toThrow(
      'FFmpeg not loaded. Call loadFFmpeg() first.'
    )
  })

  it('exports muxAudioIntoClip function', async () => {
    const module = await import('./ffmpeg-client')
    expect(typeof module.muxAudioIntoClip).toBe('function')
  })

  it('returns video-only blob when audio extraction fails', async () => {
    // Mock FFmpeg where audio extraction returns non-zero exit code
    const mockDeleteFile = vi.fn().mockResolvedValue(undefined)
    vi.doMock('@ffmpeg/ffmpeg', () => ({
      FFmpeg: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
        this.load = vi.fn().mockResolvedValue(undefined)
        this.on = vi.fn()
        this.off = vi.fn()
        this.writeFile = vi.fn().mockResolvedValue(undefined)
        this.exec = vi.fn().mockResolvedValue(1) // Non-zero = failure
        this.readFile = vi.fn().mockResolvedValue(new Uint8Array(0))
        this.deleteFile = mockDeleteFile
      }),
    }))

    vi.doMock('@ffmpeg/util', () => ({
      toBlobURL: vi.fn().mockResolvedValue('blob:mock'),
      fetchFile: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    }))

    const { loadFFmpeg, muxAudioIntoClip } = await import('./ffmpeg-client')
    await loadFFmpeg()

    const videoBlob = new Blob(['video-only-content'], { type: 'video/mp4' })
    const sourceBlob = new Blob(['source-with-audio'], { type: 'video/mp4' })

    const result = await muxAudioIntoClip(videoBlob, sourceBlob, 0, 5)

    // Should return the original video-only blob (graceful fallback)
    expect(result).toBe(videoBlob)
  })

  it('returns muxed blob when audio extraction and muxing succeed', async () => {
    const muxedData = new Uint8Array(200)
    muxedData.fill(42)

    let execCallCount = 0
    vi.doMock('@ffmpeg/ffmpeg', () => ({
      FFmpeg: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
        this.load = vi.fn().mockResolvedValue(undefined)
        this.on = vi.fn()
        this.off = vi.fn()
        this.writeFile = vi.fn().mockResolvedValue(undefined)
        this.exec = vi.fn().mockImplementation(() => {
          execCallCount++
          return Promise.resolve(0) // Success
        })
        this.readFile = vi.fn().mockImplementation((name: string) => {
          if (name === 'mux_audio.aac') {
            return Promise.resolve(new Uint8Array(150)) // > 100 bytes = valid audio
          }
          if (name === 'mux_output.mp4') {
            return Promise.resolve(muxedData)
          }
          return Promise.resolve(new Uint8Array(0))
        })
        this.deleteFile = vi.fn().mockResolvedValue(undefined)
      }),
    }))

    vi.doMock('@ffmpeg/util', () => ({
      toBlobURL: vi.fn().mockResolvedValue('blob:mock'),
      fetchFile: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    }))

    const { loadFFmpeg, muxAudioIntoClip } = await import('./ffmpeg-client')
    await loadFFmpeg()

    const videoBlob = new Blob(['video-only'], { type: 'video/mp4' })
    const sourceBlob = new Blob(['source-audio'], { type: 'video/mp4' })

    const result = await muxAudioIntoClip(videoBlob, sourceBlob, 2.5, 7.5)

    // Should return a NEW blob (not the original), with video/mp4 type
    expect(result).not.toBe(videoBlob)
    expect(result.type).toBe('video/mp4')
    // Two exec calls: audio extraction + muxing
    expect(execCallCount).toBe(2)
  })

  it('returns video-only blob when audio file is too small', async () => {
    vi.doMock('@ffmpeg/ffmpeg', () => ({
      FFmpeg: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
        this.load = vi.fn().mockResolvedValue(undefined)
        this.on = vi.fn()
        this.off = vi.fn()
        this.writeFile = vi.fn().mockResolvedValue(undefined)
        this.exec = vi.fn().mockResolvedValue(0)
        this.readFile = vi.fn().mockImplementation((name: string) => {
          if (name === 'mux_audio.aac') {
            return Promise.resolve(new Uint8Array(10)) // < 100 bytes = too small
          }
          return Promise.resolve(new Uint8Array(0))
        })
        this.deleteFile = vi.fn().mockResolvedValue(undefined)
      }),
    }))

    vi.doMock('@ffmpeg/util', () => ({
      toBlobURL: vi.fn().mockResolvedValue('blob:mock'),
      fetchFile: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    }))

    const { loadFFmpeg, muxAudioIntoClip } = await import('./ffmpeg-client')
    await loadFFmpeg()

    const videoBlob = new Blob(['video-only'], { type: 'video/mp4' })
    const sourceBlob = new Blob(['source'], { type: 'video/mp4' })

    const result = await muxAudioIntoClip(videoBlob, sourceBlob, 0, 5)
    expect(result).toBe(videoBlob)
  })
})

describe('FFmpegClient', () => {
  beforeEach(() => {
    // Reset module state between tests
    vi.resetModules()
  })

  it('throws when extracting without loading FFmpeg first', async () => {
    const { extractAudioFromSegment } = await import('./ffmpeg-client')
    const testBlob = new Blob(['test'], { type: 'video/mp4' })

    await expect(extractAudioFromSegment(testBlob)).rejects.toThrow(
      'FFmpeg not loaded. Call loadFFmpeg() first.'
    )
  })

  it('reports not loaded initially', async () => {
    const { isFFmpegLoaded } = await import('./ffmpeg-client')
    expect(isFFmpegLoaded()).toBe(false)
  })

  it('exports all required functions', async () => {
    const module = await import('./ffmpeg-client')

    expect(typeof module.loadFFmpeg).toBe('function')
    expect(typeof module.extractAudioFromSegment).toBe('function')
    expect(typeof module.isFFmpegLoaded).toBe('function')
  })

  it('exports extractVideoSegment function', async () => {
    const module = await import('./ffmpeg-client')
    expect(typeof module.extractVideoSegment).toBe('function')
  })

  it('throws friendly error when video has no audio track', async () => {
    const listeners: Record<string, ((...args: unknown[]) => void)[]> = {}
    vi.doMock('@ffmpeg/ffmpeg', () => ({
      FFmpeg: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
        this.load = vi.fn().mockResolvedValue(undefined)
        this.on = vi.fn().mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
          if (!listeners[event]) listeners[event] = []
          listeners[event].push(handler)
        })
        this.off = vi.fn().mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
          listeners[event] = (listeners[event] || []).filter(h => h !== handler)
        })
        this.writeFile = vi.fn().mockResolvedValue(undefined)
        this.exec = vi.fn().mockImplementation(() => {
          // Simulate FFmpeg logging a no-audio error before returning non-zero
          for (const h of listeners['log'] || []) {
            h({ message: 'Output file #0 does not contain any stream' })
          }
          return Promise.resolve(1)
        })
        this.readFile = vi.fn()
        this.deleteFile = vi.fn().mockResolvedValue(undefined)
      }),
    }))
    vi.doMock('@ffmpeg/util', () => ({
      toBlobURL: vi.fn().mockResolvedValue('blob:mock'),
      fetchFile: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    }))

    const { loadFFmpeg, extractAudioFromSegment } = await import('./ffmpeg-client')
    await loadFFmpeg()

    const testBlob = new Blob(['test'], { type: 'video/mp4' })
    await expect(extractAudioFromSegment(testBlob)).rejects.toThrow(
      'This video has no audio track. GolfClip needs audio to detect golf shots.'
    )
  })

  it('throws generic error for non-audio FFmpeg failures', async () => {
    vi.doMock('@ffmpeg/ffmpeg', () => ({
      FFmpeg: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
        this.load = vi.fn().mockResolvedValue(undefined)
        this.on = vi.fn()
        this.off = vi.fn()
        this.writeFile = vi.fn().mockResolvedValue(undefined)
        this.exec = vi.fn().mockResolvedValue(1) // Non-zero but no audio-related logs
        this.readFile = vi.fn()
        this.deleteFile = vi.fn().mockResolvedValue(undefined)
      }),
    }))
    vi.doMock('@ffmpeg/util', () => ({
      toBlobURL: vi.fn().mockResolvedValue('blob:mock'),
      fetchFile: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    }))

    const { loadFFmpeg, extractAudioFromSegment } = await import('./ffmpeg-client')
    await loadFFmpeg()

    const testBlob = new Blob(['test'], { type: 'video/mp4' })
    await expect(extractAudioFromSegment(testBlob)).rejects.toThrow(
      'FFmpeg failed with exit code 1'
    )
  })

  it('cleans up log listener after audio extraction (even on error)', async () => {
    const listeners: Record<string, ((...args: unknown[]) => void)[]> = {}
    const mockOff = vi.fn().mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
      listeners[event] = (listeners[event] || []).filter(h => h !== handler)
    })
    vi.doMock('@ffmpeg/ffmpeg', () => ({
      FFmpeg: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
        this.load = vi.fn().mockResolvedValue(undefined)
        this.on = vi.fn().mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
          if (!listeners[event]) listeners[event] = []
          listeners[event].push(handler)
        })
        this.off = mockOff
        this.writeFile = vi.fn().mockResolvedValue(undefined)
        this.exec = vi.fn().mockResolvedValue(1)
        this.readFile = vi.fn()
        this.deleteFile = vi.fn().mockResolvedValue(undefined)
      }),
    }))
    vi.doMock('@ffmpeg/util', () => ({
      toBlobURL: vi.fn().mockResolvedValue('blob:mock'),
      fetchFile: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    }))

    const { loadFFmpeg, extractAudioFromSegment } = await import('./ffmpeg-client')
    await loadFFmpeg()

    const testBlob = new Blob(['test'], { type: 'video/mp4' })
    await expect(extractAudioFromSegment(testBlob)).rejects.toThrow()

    // Verify log listener was cleaned up
    expect(mockOff).toHaveBeenCalledWith('log', expect.any(Function))
  })

  it('throws when extracting video segment without loading FFmpeg first', async () => {
    vi.resetModules()
    const { extractVideoSegment } = await import('./ffmpeg-client')
    const testBlob = new Blob(['test'], { type: 'video/mp4' })

    await expect(extractVideoSegment(testBlob, 0, 10)).rejects.toThrow(
      'FFmpeg not loaded. Call loadFFmpeg() first.'
    )
  })

  it('sets initError in store when FFmpeg WASM load fails', async () => {
    vi.doMock('@ffmpeg/ffmpeg', () => ({
      FFmpeg: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
        this.load = vi.fn().mockRejectedValue(new Error('Failed to fetch WASM'))
      }),
    }))
    vi.doMock('@ffmpeg/util', () => ({
      toBlobURL: vi.fn().mockResolvedValue('blob:mock'),
      fetchFile: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    }))

    const { loadFFmpeg } = await import('./ffmpeg-client')
    const { useProcessingStore } = await import('../stores/processingStore')

    // Ensure initError is null before
    useProcessingStore.getState().setInitError(null)
    expect(useProcessingStore.getState().initError).toBeNull()

    // loadFFmpeg should throw AND set initError in the store
    await expect(loadFFmpeg()).rejects.toThrow('Failed to fetch WASM')

    const initError = useProcessingStore.getState().initError
    expect(initError).not.toBeNull()
    expect(initError).toContain('Failed to load video processing engine')
    expect(initError).toContain('Failed to fetch WASM')
  })

  it('sets initError with SharedArrayBuffer hint when relevant', async () => {
    vi.doMock('@ffmpeg/ffmpeg', () => ({
      FFmpeg: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
        this.load = vi.fn().mockRejectedValue(new Error('SharedArrayBuffer is not defined'))
      }),
    }))
    vi.doMock('@ffmpeg/util', () => ({
      toBlobURL: vi.fn().mockResolvedValue('blob:mock'),
      fetchFile: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    }))

    const { loadFFmpeg } = await import('./ffmpeg-client')
    const { useProcessingStore } = await import('../stores/processingStore')

    useProcessingStore.getState().setInitError(null)

    await expect(loadFFmpeg()).rejects.toThrow('SharedArrayBuffer')

    const initError = useProcessingStore.getState().initError
    expect(initError).toContain('SharedArrayBuffer')
    expect(initError).toContain('Chrome or Edge')
  })
})
