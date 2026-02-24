// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getExportOptions, GpuCapabilities } from './gpu-detection'

describe('getExportOptions', () => {
  it('recommends browser export when hardware acceleration is enabled', () => {
    const capabilities: GpuCapabilities = {
      hardwareAccelerationEnabled: true,
      webglAvailable: true,
      renderer: 'ANGLE (NVIDIA GeForce GTX 1080)',
      vendor: 'Google Inc. (NVIDIA)',
      isSoftwareRenderer: false,
      estimatedDecodeCapability: 'hardware',
    }

    const options = getExportOptions(capabilities)

    const browserOption = options.find((o) => o.id === 'browser-accelerated')
    expect(browserOption).toBeDefined()
    expect(browserOption!.available).toBe(true)
    expect(browserOption!.recommended).toBe(true)
    expect(browserOption!.unavailableReason).toBeUndefined()
  })

  it('disables browser export when hardware acceleration is off', () => {
    const capabilities: GpuCapabilities = {
      hardwareAccelerationEnabled: false,
      webglAvailable: false,
      renderer: null,
      vendor: null,
      isSoftwareRenderer: false,
      estimatedDecodeCapability: 'software',
    }

    const options = getExportOptions(capabilities)

    const browserOption = options.find((o) => o.id === 'browser-accelerated')
    expect(browserOption!.available).toBe(false)
    expect(browserOption!.recommended).toBe(false)
    expect(browserOption!.unavailableReason).toBeDefined()
  })

  it('recommends offline export when hardware acceleration is off', () => {
    const capabilities: GpuCapabilities = {
      hardwareAccelerationEnabled: false,
      webglAvailable: true,
      renderer: 'SwiftShader',
      vendor: 'Google Inc.',
      isSoftwareRenderer: true,
      estimatedDecodeCapability: 'software',
    }

    const options = getExportOptions(capabilities)

    const offlineOption = options.find((o) => o.id === 'offline-export')
    expect(offlineOption!.available).toBe(true)
    expect(offlineOption!.recommended).toBe(true)
  })

  it('marks cloud processing as unavailable', () => {
    const capabilities: GpuCapabilities = {
      hardwareAccelerationEnabled: true,
      webglAvailable: true,
      renderer: null,
      vendor: null,
      isSoftwareRenderer: false,
      estimatedDecodeCapability: 'hardware',
    }

    const options = getExportOptions(capabilities)

    const cloudOption = options.find((o) => o.id === 'cloud-processing')
    expect(cloudOption!.available).toBe(false)
    expect(cloudOption!.unavailableReason).toBe('Coming soon')
  })

  it('always returns exactly 3 export options', () => {
    const capabilities: GpuCapabilities = {
      hardwareAccelerationEnabled: true,
      webglAvailable: true,
      renderer: null,
      vendor: null,
      isSoftwareRenderer: false,
      estimatedDecodeCapability: 'hardware',
    }

    const options = getExportOptions(capabilities)
    expect(options).toHaveLength(3)
  })
})

describe('detectGpuCapabilities', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('returns defaults when WebGL is not available', async () => {
    const mockCanvas = {
      getContext: vi.fn(() => null),
    }
    vi.spyOn(document, 'createElement').mockReturnValue(mockCanvas as unknown as HTMLElement)

    const { detectGpuCapabilities } = await import('./gpu-detection')
    const result = await detectGpuCapabilities()

    expect(result.webglAvailable).toBe(false)
    expect(result.hardwareAccelerationEnabled).toBe(false)
    expect(result.estimatedDecodeCapability).toBe('software')
  })

  it('handles error when accessing WebGL context', async () => {
    const mockCanvas = {
      getContext: vi.fn(() => {
        throw new Error('WebGL not supported')
      }),
    }
    vi.spyOn(document, 'createElement').mockReturnValue(mockCanvas as unknown as HTMLElement)

    const { detectGpuCapabilities } = await import('./gpu-detection')
    const result = await detectGpuCapabilities()

    expect(result.webglAvailable).toBe(false)
    expect(result.hardwareAccelerationEnabled).toBe(false)
  })
})
