import { describe, it, expect, vi, beforeEach } from 'vitest'

// Note: FFmpeg.wasm requires a real browser environment with SharedArrayBuffer
// These tests verify the module interface and error handling without browser APIs

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
