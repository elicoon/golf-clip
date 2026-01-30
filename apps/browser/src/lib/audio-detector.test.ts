import { describe, it, expect, vi, beforeEach } from 'vitest'

// Note: Essentia.js requires a browser environment with WebAssembly support.
// These tests verify the module interface and error handling without browser APIs,
// following the same pattern as ffmpeg-client.test.ts

describe('AudioDetector', () => {
  beforeEach(() => {
    // Reset module state between tests
    vi.resetModules()
  })

  it('throws when detecting without loading Essentia first', async () => {
    const { detectStrikes } = await import('./audio-detector')
    const silence = new Float32Array(22050).fill(0)

    await expect(detectStrikes(silence, 22050)).rejects.toThrow(
      'Essentia not loaded. Call loadEssentia() first.'
    )
  })

  it('reports not loaded initially', async () => {
    const { isEssentiaLoaded } = await import('./audio-detector')
    expect(isEssentiaLoaded()).toBe(false)
  })

  it('exports all required functions', async () => {
    const module = await import('./audio-detector')

    expect(typeof module.loadEssentia).toBe('function')
    expect(typeof module.detectStrikes).toBe('function')
    expect(typeof module.isEssentiaLoaded).toBe('function')
  })

  it('exports StrikeDetection interface structure', async () => {
    const module = await import('./audio-detector')

    // Verify DEFAULT_CONFIG is exported and has expected shape
    expect(module.DEFAULT_CONFIG).toBeDefined()
    expect(typeof module.DEFAULT_CONFIG.frequencyLow).toBe('number')
    expect(typeof module.DEFAULT_CONFIG.frequencyHigh).toBe('number')
    expect(typeof module.DEFAULT_CONFIG.minStrikeInterval).toBe('number')
    expect(typeof module.DEFAULT_CONFIG.sensitivity).toBe('number')
  })

  it('validates audio data is not empty', async () => {
    const { detectStrikes } = await import('./audio-detector')
    const emptyAudio = new Float32Array(0)

    await expect(detectStrikes(emptyAudio, 22050)).rejects.toThrow(
      'Audio data cannot be empty'
    )
  })

  it('validates sample rate is positive', async () => {
    const { detectStrikes } = await import('./audio-detector')
    const audio = new Float32Array(1000).fill(0)

    await expect(detectStrikes(audio, 0)).rejects.toThrow(
      'Sample rate must be positive'
    )
    await expect(detectStrikes(audio, -44100)).rejects.toThrow(
      'Sample rate must be positive'
    )
  })
})
