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

  it('throws when extracting video segment without loading FFmpeg first', async () => {
    vi.resetModules()
    const { extractVideoSegment } = await import('./ffmpeg-client')
    const testBlob = new Blob(['test'], { type: 'video/mp4' })

    await expect(extractVideoSegment(testBlob, 0, 10)).rejects.toThrow(
      'FFmpeg not loaded. Call loadFFmpeg() first.'
    )
  })
})
