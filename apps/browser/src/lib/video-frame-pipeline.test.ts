// apps/browser/src/lib/video-frame-pipeline.test.ts
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'

// Mock ffmpeg-client module
vi.mock('./ffmpeg-client', async () => {
  const actual = await vi.importActual('./ffmpeg-client')
  return {
    ...actual,
    isHevcCodec: vi.fn(),
  }
})

// Mock @ffmpeg/util to avoid FileReader issues in test environment
vi.mock('@ffmpeg/util', () => ({
  fetchFile: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
}))

// Mock ImageData for Node environment
class MockImageData {
  width: number
  height: number
  data: Uint8ClampedArray

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    this.data = new Uint8ClampedArray(width * height * 4)
  }
}

// Mock OffscreenCanvas
class MockOffscreenCanvas {
  width: number
  height: number

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
  }

  getContext(): CanvasRenderingContext2D {
    return {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      putImageData: vi.fn(),
      getImageData: vi.fn(() => new MockImageData(this.width, this.height)),
      fillText: vi.fn(),
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      lineCap: 'butt',
      lineJoin: 'miter',
      shadowColor: '',
      shadowBlur: 0,
      font: '',
    } as unknown as CanvasRenderingContext2D
  }

  convertToBlob(): Promise<Blob> {
    return Promise.resolve(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }))
  }
}

// Mock ImageBitmap
class MockImageBitmap {
  width = 100
  height = 100
  close = vi.fn()
}

beforeAll(() => {
  // @ts-expect-error - polyfilling for tests
  globalThis.OffscreenCanvas = MockOffscreenCanvas
  // @ts-expect-error - polyfilling for tests
  globalThis.ImageData = MockImageData
  globalThis.createImageBitmap = vi.fn(() => Promise.resolve(new MockImageBitmap())) as typeof createImageBitmap
})

describe('VideoFramePipeline', () => {
  it('should calculate frame count correctly', async () => {
    const { VideoFramePipeline } = await import('./video-frame-pipeline')

    // Mock FFmpeg - we can't test actual video processing in unit tests
    const mockFFmpeg = {
      writeFile: vi.fn(),
      readFile: vi.fn(),
      exec: vi.fn(),
      deleteFile: vi.fn(),
    }

    const pipeline = new VideoFramePipeline(mockFFmpeg as any)

    // 2 seconds at 30fps = 60 frames
    const frameCount = pipeline.calculateFrameCount(2.0, 30)
    expect(frameCount).toBe(60)
  })

  it('should calculate frame count for fractional duration', async () => {
    const { VideoFramePipeline } = await import('./video-frame-pipeline')

    const mockFFmpeg = {
      writeFile: vi.fn(),
      readFile: vi.fn(),
      exec: vi.fn(),
      deleteFile: vi.fn(),
    }

    const pipeline = new VideoFramePipeline(mockFFmpeg as any)

    // 1.5 seconds at 30fps = 45 frames
    const frameCount = pipeline.calculateFrameCount(1.5, 30)
    expect(frameCount).toBe(45)
  })

  it('should handle 60fps video', async () => {
    const { VideoFramePipeline } = await import('./video-frame-pipeline')

    const mockFFmpeg = {
      writeFile: vi.fn(),
      readFile: vi.fn(),
      exec: vi.fn(),
      deleteFile: vi.fn(),
    }

    const pipeline = new VideoFramePipeline(mockFFmpeg as any)

    // 1 second at 60fps = 60 frames
    const frameCount = pipeline.calculateFrameCount(1.0, 60)
    expect(frameCount).toBe(60)
  })

  it('should ceil frame count for partial frames', async () => {
    const { VideoFramePipeline } = await import('./video-frame-pipeline')

    const mockFFmpeg = {
      writeFile: vi.fn(),
      readFile: vi.fn(),
      exec: vi.fn(),
      deleteFile: vi.fn(),
    }

    const pipeline = new VideoFramePipeline(mockFFmpeg as any)

    // 0.1 seconds at 30fps = 3 frames (ceil of 3)
    const frameCount = pipeline.calculateFrameCount(0.1, 30)
    expect(frameCount).toBe(3)
  })
})

describe('VideoFramePipeline extraction progress fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should emit periodic progress updates during extraction even when FFmpeg is silent', async () => {
    const { isHevcCodec } = await import('./ffmpeg-client')
    vi.mocked(isHevcCodec).mockResolvedValue(false)

    const progressUpdates: { phase: string; progress: number }[] = []

    // Create a mock that delays exec to simulate slow extraction
    // Returns exit code 0 (success) after delay
    const execPromise = new Promise<number>(resolve => {
      // Simulate 3 seconds of extraction
      setTimeout(() => resolve(0), 3000)
    })

    const mockFFmpeg = {
      writeFile: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockImplementation((name: string) => {
        if (name === 'frame_0001.png') {
          return Promise.resolve(new Uint8Array([
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG header
            0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk start
            0x00, 0x00, 0x00, 0x64, // width: 100
            0x00, 0x00, 0x00, 0x64, // height: 100
            0x08, 0x02, 0x00, 0x00, 0x00, // bit depth, color type, etc
          ]))
        }
        if (name === 'output.mp4') {
          return Promise.resolve(new Uint8Array([1, 2, 3]))
        }
        return Promise.resolve(new Uint8Array([1, 2, 3]))
      }),
      exec: vi.fn().mockImplementation(() => execPromise),
      deleteFile: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(), // No progress events emitted
      off: vi.fn(),
    }

    const { VideoFramePipeline } = await import('./video-frame-pipeline')
    const pipeline = new VideoFramePipeline(mockFFmpeg as any)

    const exportPromise = pipeline.exportWithTracer({
      videoBlob: new Blob(['video'], { type: 'video/mp4' }),
      trajectory: [{ x: 0.5, y: 0.5, timestamp: 0 }],
      startTime: 0,
      endTime: 0.1,
      fps: 10,
      tracerStyle: {
        color: '#ff0000',
        thickness: 2,
        glowEnabled: false,
        glowColor: '#ffffff',
        glowIntensity: 0.5,
        shadowEnabled: false,
        shadowColor: '#000000',
        shadowBlur: 4,
      },
      onProgress: (p) => progressUpdates.push({ phase: p.phase, progress: p.progress }),
    })

    // Advance timers to trigger fallback progress updates
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(1000)

    await exportPromise

    // Should have extraction updates (either indeterminate -1 or fallback values)
    const extractionUpdates = progressUpdates.filter(p => p.phase === 'extracting')
    expect(extractionUpdates.length).toBeGreaterThan(0)
  })
})

describe('VideoFramePipeline 100% progress', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should report exactly 100% progress when export completes', async () => {
    const { isHevcCodec } = await import('./ffmpeg-client')
    vi.mocked(isHevcCodec).mockResolvedValue(false)

    const progressUpdates: { phase: string; progress: number }[] = []

    const mockFFmpeg = {
      writeFile: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockImplementation((name: string) => {
        if (name === 'frame_0001.png') {
          // Minimal valid PNG header for dimension extraction
          return Promise.resolve(new Uint8Array([
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
            0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
            0x00, 0x00, 0x00, 0x64,
            0x00, 0x00, 0x00, 0x64,
            0x08, 0x02, 0x00, 0x00, 0x00,
          ]))
        }
        return Promise.resolve(new Uint8Array([1, 2, 3]))
      }),
      exec: vi.fn().mockResolvedValue(0),
      deleteFile: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      off: vi.fn(),
    }

    const { VideoFramePipeline } = await import('./video-frame-pipeline')
    const pipeline = new VideoFramePipeline(mockFFmpeg as any)

    await pipeline.exportWithTracer({
      videoBlob: new Blob(['video'], { type: 'video/mp4' }),
      trajectory: [{ x: 0.5, y: 0.5, timestamp: 0 }],
      startTime: 0,
      endTime: 0.1,
      fps: 10,
      tracerStyle: {
        color: '#ff0000',
        thickness: 2,
        glowEnabled: false,
        glowColor: '#ffffff',
        glowIntensity: 0.5,
        shadowEnabled: false,
        shadowColor: '#000000',
        shadowBlur: 4,
      },
      onProgress: (p) => progressUpdates.push({ phase: p.phase, progress: p.progress }),
    })

    // Must have 100% for each phase that completes
    const has100Extracting = progressUpdates.some(p => p.phase === 'extracting' && p.progress === 100)
    const has100Encoding = progressUpdates.some(p => p.phase === 'encoding' && p.progress === 100)
    const hasComplete = progressUpdates.some(p => p.phase === 'complete' && p.progress === 100)

    expect(has100Extracting).toBe(true)
    expect(has100Encoding).toBe(true)
    expect(hasComplete).toBe(true)

    // Should NOT have any phase stuck at 99% as final value
    const extractingUpdates = progressUpdates.filter(p => p.phase === 'extracting')
    const encodingUpdates = progressUpdates.filter(p => p.phase === 'encoding')

    // Last extracting update should be 100, not 99
    const lastExtracting = extractingUpdates[extractingUpdates.length - 1]
    expect(lastExtracting?.progress).toBe(100)

    // Last encoding update should be 100, not 99
    const lastEncoding = encodingUpdates[encodingUpdates.length - 1]
    expect(lastEncoding?.progress).toBe(100)
  })
})

describe('VideoFramePipeline HEVC detection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should throw HevcExportError when video is HEVC encoded', async () => {
    const { isHevcCodec } = await import('./ffmpeg-client')
    const { VideoFramePipeline, HevcExportError } = await import('./video-frame-pipeline')

    const mockedIsHevc = vi.mocked(isHevcCodec)
    mockedIsHevc.mockResolvedValue(true)

    const mockFFmpeg = {
      writeFile: vi.fn(),
      readFile: vi.fn(),
      exec: vi.fn(),
      deleteFile: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    }

    const pipeline = new VideoFramePipeline(mockFFmpeg as any)
    const hevcBlob = new Blob(['hevc-video-data'], { type: 'video/mp4' })

    await expect(pipeline.exportWithTracer({
      videoBlob: hevcBlob,
      trajectory: [{ x: 0.5, y: 0.5, time: 0 }],
      startTime: 0,
      endTime: 1,
      fps: 30,
      quality: 'draft',
      tracerStyle: {
        color: '#ff0000',
        thickness: 2,
        glowEnabled: false,
        glowColor: '#ffffff',
        glowIntensity: 0.5,
        shadowEnabled: false,
        shadowColor: '#000000',
        shadowBlur: 4,
      },
    })).rejects.toThrow(HevcExportError)

    expect(mockedIsHevc).toHaveBeenCalledWith(hevcBlob)
  })

  it('should proceed with export when video is not HEVC', async () => {
    const { isHevcCodec } = await import('./ffmpeg-client')
    const { VideoFramePipeline } = await import('./video-frame-pipeline')

    const mockedIsHevc = vi.mocked(isHevcCodec)
    mockedIsHevc.mockResolvedValue(false)

    // Mock FFmpeg to simulate frame extraction failure (not HEVC related)
    const mockFFmpeg = {
      writeFile: vi.fn(),
      readFile: vi.fn().mockRejectedValue(new Error('frame_0001.png not found')),
      exec: vi.fn().mockResolvedValue(0),
      deleteFile: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    }

    const pipeline = new VideoFramePipeline(mockFFmpeg as any)
    const h264Blob = new Blob(['h264-video-data'], { type: 'video/mp4' })

    // Should throw a different error (frame extraction error), not HevcExportError
    await expect(pipeline.exportWithTracer({
      videoBlob: h264Blob,
      trajectory: [{ x: 0.5, y: 0.5, time: 0 }],
      startTime: 0,
      endTime: 1,
      fps: 30,
      quality: 'draft',
      tracerStyle: {
        color: '#ff0000',
        thickness: 2,
        glowEnabled: false,
        glowColor: '#ffffff',
        glowIntensity: 0.5,
        shadowEnabled: false,
        shadowColor: '#000000',
        shadowBlur: 4,
      },
    })).rejects.toThrow('Frame extraction produced no frames')

    expect(mockedIsHevc).toHaveBeenCalledWith(h264Blob)
  })
})

/**
 * Tests for FFmpeg exit code handling bug.
 *
 * BUG: The current implementation does NOT check FFmpeg's exit code after frame extraction.
 * FFmpeg.exec() returns an exit code, but lines 109-117 only catch exceptions - they don't
 * verify exec() returned 0.
 *
 * When FFmpeg fails to decode a video (e.g., HEVC without decoder), it:
 * 1. Does NOT throw an exception
 * 2. Returns a non-zero exit code
 * 3. Produces no output frames
 *
 * The current code falls through to line 130 which checks for frame_0001.png,
 * finds nothing, and throws a generic "Frame extraction produced no frames" error
 * that doesn't mention the actual cause (codec/exit code).
 *
 * These tests verify the fix:
 * 1. FFmpeg exit code MUST be checked after exec()
 * 2. Non-zero exit code MUST throw a descriptive error (not generic)
 * 3. Error message SHOULD include exit code and ideally codec info
 */
describe('VideoFramePipeline FFmpeg exit code handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should throw descriptive error when FFmpeg returns non-zero exit code during frame extraction', async () => {
    /**
     * This test will FAIL with current buggy code because:
     * - Current code doesn't check exec() return value (lines 110-117)
     * - FFmpeg returning exit code 1 doesn't throw, just silently fails
     * - Error is caught later as generic "Frame extraction produced no frames"
     *
     * After fix, this should pass because:
     * - exec() return value is checked
     * - Non-zero exit code throws error with exit code in message
     */
    const { isHevcCodec } = await import('./ffmpeg-client')
    const { VideoFramePipeline } = await import('./video-frame-pipeline')

    vi.mocked(isHevcCodec).mockResolvedValue(false) // Bypasses HEVC check

    // FFmpeg returns exit code 1 (failure) but doesn't throw
    const mockFFmpeg = {
      writeFile: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockRejectedValue(new Error('file not found')), // No frames produced
      exec: vi.fn().mockResolvedValue(1), // <-- Non-zero exit code!
      deleteFile: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      off: vi.fn(),
    }

    const pipeline = new VideoFramePipeline(mockFFmpeg as any)

    // This should throw an error that mentions the exit code, not just "no frames"
    await expect(pipeline.exportWithTracer({
      videoBlob: new Blob(['video'], { type: 'video/mp4' }),
      trajectory: [{ x: 0.5, y: 0.5, timestamp: 0 }],
      startTime: 0,
      endTime: 1,
      fps: 30,
      tracerStyle: {
        color: '#ff0000',
        thickness: 2,
        glowEnabled: false,
        glowColor: '#ffffff',
        glowIntensity: 0.5,
        shadowEnabled: false,
        shadowColor: '#000000',
        shadowBlur: 4,
      },
    })).rejects.toThrow(/exit code/i)

    // Verify exec was called (frame extraction attempt)
    expect(mockFFmpeg.exec).toHaveBeenCalled()
  })

  it('should include exit code value in error message when FFmpeg fails', async () => {
    /**
     * This test verifies the error message is actionable, not generic.
     * Current code: "Frame extraction produced no frames. The video may be corrupted..."
     * Expected: Error message that includes "exit code 1" or similar
     */
    const { isHevcCodec } = await import('./ffmpeg-client')
    const { VideoFramePipeline } = await import('./video-frame-pipeline')

    vi.mocked(isHevcCodec).mockResolvedValue(false)

    const mockFFmpeg = {
      writeFile: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockRejectedValue(new Error('file not found')),
      exec: vi.fn().mockResolvedValue(1), // Exit code 1
      deleteFile: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      off: vi.fn(),
    }

    const pipeline = new VideoFramePipeline(mockFFmpeg as any)

    let thrownError: Error | null = null
    try {
      await pipeline.exportWithTracer({
        videoBlob: new Blob(['video'], { type: 'video/mp4' }),
        trajectory: [{ x: 0.5, y: 0.5, timestamp: 0 }],
        startTime: 0,
        endTime: 1,
        fps: 30,
        tracerStyle: {
          color: '#ff0000',
          thickness: 2,
          glowEnabled: false,
          glowColor: '#ffffff',
          glowIntensity: 0.5,
          shadowEnabled: false,
          shadowColor: '#000000',
          shadowBlur: 4,
        },
      })
    } catch (e) {
      thrownError = e as Error
    }

    expect(thrownError).not.toBeNull()
    // Error message should contain the actual exit code value
    expect(thrownError!.message).toMatch(/1/) // Contains "1" (the exit code)
    // Should NOT be the generic message
    expect(thrownError!.message).not.toMatch(/may be corrupted/i)
  })

  it('should succeed when FFmpeg returns exit code 0', async () => {
    /**
     * Sanity check: When FFmpeg succeeds (exit code 0), export should work.
     */
    const { isHevcCodec } = await import('./ffmpeg-client')
    const { VideoFramePipeline } = await import('./video-frame-pipeline')

    vi.mocked(isHevcCodec).mockResolvedValue(false)

    const mockFFmpeg = {
      writeFile: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockImplementation((name: string) => {
        if (name === 'frame_0001.png') {
          return Promise.resolve(new Uint8Array([
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
            0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
            0x00, 0x00, 0x00, 0x64,
            0x00, 0x00, 0x00, 0x64,
            0x08, 0x02, 0x00, 0x00, 0x00,
          ]))
        }
        return Promise.resolve(new Uint8Array([1, 2, 3]))
      }),
      exec: vi.fn().mockResolvedValue(0), // <-- Exit code 0 = success
      deleteFile: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      off: vi.fn(),
    }

    const pipeline = new VideoFramePipeline(mockFFmpeg as any)

    // Should NOT throw
    const result = await pipeline.exportWithTracer({
      videoBlob: new Blob(['video'], { type: 'video/mp4' }),
      trajectory: [{ x: 0.5, y: 0.5, timestamp: 0 }],
      startTime: 0,
      endTime: 0.1,
      fps: 10,
      tracerStyle: {
        color: '#ff0000',
        thickness: 2,
        glowEnabled: false,
        glowColor: '#ffffff',
        glowIntensity: 0.5,
        shadowEnabled: false,
        shadowColor: '#000000',
        shadowBlur: 4,
      },
    })

    expect(result).toBeInstanceOf(Blob)
  })

  it('should check exit code for frame extraction specifically, not just encoding', async () => {
    /**
     * Verify that exit code is checked after the FIRST exec call (frame extraction),
     * not just the second one (encoding). This is critical because:
     * - Frame extraction is where codec incompatibility manifests
     * - Current code only has try/catch, not exit code check
     */
    const { isHevcCodec } = await import('./ffmpeg-client')
    const { VideoFramePipeline } = await import('./video-frame-pipeline')

    vi.mocked(isHevcCodec).mockResolvedValue(false)

    let execCallCount = 0
    const mockFFmpeg = {
      writeFile: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockRejectedValue(new Error('file not found')),
      exec: vi.fn().mockImplementation(() => {
        execCallCount++
        if (execCallCount === 1) {
          // First call = frame extraction - return failure
          return Promise.resolve(1)
        }
        // Second call would be encoding (shouldn't reach here)
        return Promise.resolve(0)
      }),
      deleteFile: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      off: vi.fn(),
    }

    const pipeline = new VideoFramePipeline(mockFFmpeg as any)

    await expect(pipeline.exportWithTracer({
      videoBlob: new Blob(['video'], { type: 'video/mp4' }),
      trajectory: [{ x: 0.5, y: 0.5, timestamp: 0 }],
      startTime: 0,
      endTime: 1,
      fps: 30,
      tracerStyle: {
        color: '#ff0000',
        thickness: 2,
        glowEnabled: false,
        glowColor: '#ffffff',
        glowIntensity: 0.5,
        shadowEnabled: false,
        shadowColor: '#000000',
        shadowBlur: 4,
      },
    })).rejects.toThrow()

    // Should fail on FIRST exec call, not proceed to second
    expect(execCallCount).toBe(1)
  })
})

/**
 * Integration tests for HEVC codec handling in export flow.
 *
 * These tests verify the complete flow when dealing with HEVC videos,
 * including proper error propagation and recovery options.
 */
describe('VideoFramePipeline HEVC codec integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should throw HevcExportError that can be caught by type for UI handling', async () => {
    /**
     * UI components need to catch HevcExportError specifically to show
     * the transcode modal instead of a generic error message.
     */
    const { isHevcCodec } = await import('./ffmpeg-client')
    const { VideoFramePipeline, HevcExportError } = await import('./video-frame-pipeline')

    vi.mocked(isHevcCodec).mockResolvedValue(true)

    const mockFFmpeg = {
      writeFile: vi.fn(),
      readFile: vi.fn(),
      exec: vi.fn(),
      deleteFile: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    }

    const pipeline = new VideoFramePipeline(mockFFmpeg as any)

    let caughtError: Error | null = null
    try {
      await pipeline.exportWithTracer({
        videoBlob: new Blob(['hevc'], { type: 'video/mp4' }),
        trajectory: [{ x: 0.5, y: 0.5, timestamp: 0 }],
        startTime: 0,
        endTime: 1,
        fps: 30,
        tracerStyle: {
          color: '#ff0000',
          thickness: 2,
          glowEnabled: false,
          glowColor: '#ffffff',
          glowIntensity: 0.5,
          shadowEnabled: false,
          shadowColor: '#000000',
          shadowBlur: 4,
        },
      })
    } catch (e) {
      caughtError = e as Error
    }

    // Must be catchable as HevcExportError for UI to show transcode modal
    expect(caughtError).toBeInstanceOf(HevcExportError)
    expect(caughtError!.name).toBe('HevcExportError')
  })

  it('should detect HEVC before attempting frame extraction (fail fast)', async () => {
    /**
     * HEVC check should happen BEFORE any heavy FFmpeg operations.
     * This ensures fast feedback to user and avoids wasted processing.
     */
    const { isHevcCodec } = await import('./ffmpeg-client')
    const { VideoFramePipeline, HevcExportError } = await import('./video-frame-pipeline')

    vi.mocked(isHevcCodec).mockResolvedValue(true)

    const mockFFmpeg = {
      writeFile: vi.fn(),
      readFile: vi.fn(),
      exec: vi.fn(),
      deleteFile: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    }

    const pipeline = new VideoFramePipeline(mockFFmpeg as any)

    await expect(pipeline.exportWithTracer({
      videoBlob: new Blob(['hevc'], { type: 'video/mp4' }),
      trajectory: [{ x: 0.5, y: 0.5, timestamp: 0 }],
      startTime: 0,
      endTime: 1,
      fps: 30,
      tracerStyle: {
        color: '#ff0000',
        thickness: 2,
        glowEnabled: false,
        glowColor: '#ffffff',
        glowIntensity: 0.5,
        shadowEnabled: false,
        shadowColor: '#000000',
        shadowBlur: 4,
      },
    })).rejects.toThrow(HevcExportError)

    // exec should NOT have been called because HEVC was detected first
    expect(mockFFmpeg.exec).not.toHaveBeenCalled()
  })
})

/**
 * Tests for FFmpeg diagnostic logging during frame extraction failures.
 *
 * When frame extraction fails, FFmpeg's log output (stderr) contains valuable
 * information about why (e.g., "Stream #0: Video: hevc, cannot decode").
 * These tests verify that we capture and log this information.
 */
describe('VideoFramePipeline - Diagnostic Logging (Bug Fix)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  const defaultTracerStyle = {
    color: '#FF4444',
    lineWidth: 3,
    glowEnabled: true,
    glowColor: '#FF6666',
    glowRadius: 8,
    showApexMarker: true,
    showLandingMarker: true,
    showOriginMarker: true,
    styleMode: 'solid' as const,
    tailLengthSeconds: 0.4,
    tailFade: true,
  }

  /**
   * Test that FFmpeg log output is captured and logged when extraction fails.
   * This helps debug codec issues without requiring users to understand FFmpeg.
   */
  it('should capture FFmpeg log output when frame extraction fails', async () => {
    const { isHevcCodec } = await import('./ffmpeg-client')
    const { VideoFramePipeline } = await import('./video-frame-pipeline')

    vi.mocked(isHevcCodec).mockResolvedValue(false)

    const consoleSpy = vi.spyOn(console, 'error')
    const logListeners: Array<(data: { message: string }) => void> = []

    const mockFFmpeg = {
      writeFile: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockRejectedValue(new Error('File not found')),
      exec: vi.fn().mockImplementation(async () => {
        // Simulate FFmpeg log output during execution
        for (const listener of logListeners) {
          listener({ message: 'Stream #0: Video: hevc, cannot decode' })
          listener({ message: 'Error decoding video stream' })
        }
        return 1 // Non-zero exit code
      }),
      deleteFile: vi.fn(),
      on: vi.fn().mockImplementation((event: string, callback: (data: { message: string }) => void) => {
        if (event === 'log') {
          logListeners.push(callback)
        }
      }),
      off: vi.fn().mockImplementation((event: string, callback: (data: { message: string }) => void) => {
        if (event === 'log') {
          const index = logListeners.indexOf(callback)
          if (index !== -1) logListeners.splice(index, 1)
        }
      }),
    }

    const pipeline = new VideoFramePipeline(mockFFmpeg as any)
    const videoBlob = new Blob(['video-data'], { type: 'video/mp4' })

    try {
      await pipeline.exportWithTracer({
        videoBlob,
        trajectory: [{ x: 0.5, y: 0.5, timestamp: 0 }],
        startTime: 0,
        endTime: 1,
        fps: 30,
        quality: 'draft',
        tracerStyle: defaultTracerStyle,
      })
      expect.fail('Expected error to be thrown')
    } catch {
      // Expected
    }

    // Should have logged diagnostic info from FFmpeg
    expect(consoleSpy).toHaveBeenCalled()
    const logCalls = consoleSpy.mock.calls.map(call => call.join(' ')).join('\n')
    expect(logCalls).toContain('FFmpeg')

    consoleSpy.mockRestore()
  })

  /**
   * Test that log listeners are cleaned up after failure.
   */
  it('should clean up log listeners when frame extraction fails', async () => {
    const { isHevcCodec } = await import('./ffmpeg-client')
    const { VideoFramePipeline } = await import('./video-frame-pipeline')

    vi.mocked(isHevcCodec).mockResolvedValue(false)

    const onCalls: string[] = []
    const offCalls: string[] = []

    const mockFFmpeg = {
      writeFile: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockRejectedValue(new Error('File not found')),
      exec: vi.fn().mockResolvedValue(1),
      deleteFile: vi.fn(),
      on: vi.fn().mockImplementation((event: string) => {
        onCalls.push(event)
      }),
      off: vi.fn().mockImplementation((event: string) => {
        offCalls.push(event)
      }),
    }

    const pipeline = new VideoFramePipeline(mockFFmpeg as any)
    const videoBlob = new Blob(['video-data'], { type: 'video/mp4' })

    try {
      await pipeline.exportWithTracer({
        videoBlob,
        trajectory: [{ x: 0.5, y: 0.5, timestamp: 0 }],
        startTime: 0,
        endTime: 1,
        fps: 30,
        quality: 'draft',
        tracerStyle: defaultTracerStyle,
      })
    } catch {
      // Expected
    }

    // Every 'on' call for log should have a corresponding 'off' call
    const logOnCount = onCalls.filter(e => e === 'log').length
    const logOffCount = offCalls.filter(e => e === 'log').length
    expect(logOffCount).toBeGreaterThanOrEqual(logOnCount)
  })
})
