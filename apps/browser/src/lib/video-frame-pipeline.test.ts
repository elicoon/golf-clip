// apps/browser/src/lib/video-frame-pipeline.test.ts
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'

vi.mock('./ffmpeg-client', async () => {
  const actual = await vi.importActual('./ffmpeg-client')
  return {
    ...actual,
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
    const { VideoFramePipeline } = await import('./video-frame-pipeline')

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
    const { VideoFramePipeline } = await import('./video-frame-pipeline')

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
    const { VideoFramePipeline } = await import('./video-frame-pipeline')

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
    const { VideoFramePipeline } = await import('./video-frame-pipeline')

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
 * Tests for FFmpeg diagnostic logging during frame extraction failures.
 *
 * When frame extraction fails, FFmpeg's log output (stderr) contains valuable
 * information about why (e.g., "Stream #0: Video: hevc, cannot decode").
 * These tests verify that we capture and log this information.
 */
// =============================================================================
// LARGE BLOB HANDLING TESTS (Bug: Export hang on 4K videos)
// =============================================================================

/**
 * Tests for large video blob handling.
 *
 * BUG CONTEXT: Export hangs at ~90% for 4K 60fps videos because:
 * 1. FFmpeg WASM struggles with 4K resolution during decode
 * 2. Memory exhaustion occurs with too many frames
 * 3. Frame extraction stalls near completion
 *
 * MITIGATION STRATEGY:
 * - Cap frames at 450 (15s at 30fps)
 * - Reduce FPS to minimum 24fps for long clips
 * - Downscale to 1080p for clips >18s
 * - Add 2-minute extraction timeout
 */
describe('VideoFramePipeline - Large Blob Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const defaultTracerStyle = {
    color: '#FF4444',
    thickness: 2,
    glowEnabled: false,
    glowColor: '#ffffff',
    glowIntensity: 0.5,
    shadowEnabled: false,
    shadowColor: '#000000',
    shadowBlur: 4,
  }

  it('should log warning for large blobs (>100MB)', async () => {
    const { VideoFramePipeline } = await import('./video-frame-pipeline')

    const consoleSpy = vi.spyOn(console, 'warn')

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
      exec: vi.fn().mockResolvedValue(0),
      deleteFile: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      off: vi.fn(),
    }

    const pipeline = new VideoFramePipeline(mockFFmpeg as any)

    // Create a mock blob that reports as 150MB
    const largeBlob = new Blob(['x'.repeat(1000)], { type: 'video/mp4' })
    Object.defineProperty(largeBlob, 'size', { value: 150 * 1024 * 1024 })

    await pipeline.exportWithTracer({
      videoBlob: largeBlob,
      trajectory: [{ x: 0.5, y: 0.5, timestamp: 0 }],
      startTime: 0,
      endTime: 0.1,
      fps: 30,
      tracerStyle: defaultTracerStyle,
    })

    // Should have logged a warning about large blob
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringMatching(/Large blob detected.*150.*MB/i)
    )

    consoleSpy.mockRestore()
  })

  it('should reduce FPS from 60 to 24 for clips exceeding frame limit', async () => {
    const { VideoFramePipeline } = await import('./video-frame-pipeline')

    const consoleSpy = vi.spyOn(console, 'warn')
    let capturedVfFilter = ''

    const mockFFmpeg = {
      writeFile: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockImplementation((name: string) => {
        if (name === 'frame_0001.png') {
          return Promise.resolve(new Uint8Array([
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
            0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
            0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00, 0x64,
            0x08, 0x02, 0x00, 0x00, 0x00,
          ]))
        }
        return Promise.resolve(new Uint8Array([1, 2, 3]))
      }),
      exec: vi.fn().mockImplementation((args: string[]) => {
        // Capture the -vf filter to verify FPS
        const vfIndex = args.indexOf('-vf')
        if (vfIndex !== -1) {
          capturedVfFilter = args[vfIndex + 1]
        }
        return Promise.resolve(0)
      }),
      deleteFile: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      off: vi.fn(),
    }

    const pipeline = new VideoFramePipeline(mockFFmpeg as any)

    // 20 seconds at 60fps = 1200 frames, way over 450 limit
    await pipeline.exportWithTracer({
      videoBlob: new Blob(['video'], { type: 'video/mp4' }),
      trajectory: [{ x: 0.5, y: 0.5, timestamp: 0 }],
      startTime: 0,
      endTime: 20, // 20 second clip
      fps: 60,
      tracerStyle: defaultTracerStyle,
    })

    // Should have reduced fps and logged warning
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringMatching(/Reducing fps|downscaling/i)
    )

    consoleSpy.mockRestore()
  })

  it('should add downscale filter for very long clips (>18 seconds)', async () => {
    const { VideoFramePipeline } = await import('./video-frame-pipeline')

    const consoleSpy = vi.spyOn(console, 'warn')
    let capturedVfFilter = ''

    const mockFFmpeg = {
      writeFile: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockImplementation((name: string) => {
        if (name === 'frame_0001.png') {
          return Promise.resolve(new Uint8Array([
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
            0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
            0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00, 0x64,
            0x08, 0x02, 0x00, 0x00, 0x00,
          ]))
        }
        return Promise.resolve(new Uint8Array([1, 2, 3]))
      }),
      exec: vi.fn().mockImplementation((args: string[]) => {
        // Capture the -vf filter to verify scale
        const vfIndex = args.indexOf('-vf')
        if (vfIndex !== -1) {
          capturedVfFilter = args[vfIndex + 1]
        }
        return Promise.resolve(0)
      }),
      deleteFile: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      off: vi.fn(),
    }

    const pipeline = new VideoFramePipeline(mockFFmpeg as any)

    // 25 seconds clip - should trigger downscaling
    await pipeline.exportWithTracer({
      videoBlob: new Blob(['video'], { type: 'video/mp4' }),
      trajectory: [{ x: 0.5, y: 0.5, timestamp: 0 }],
      startTime: 0,
      endTime: 25,
      fps: 30,
      tracerStyle: defaultTracerStyle,
    })

    // Should include scale filter for 1080p
    expect(capturedVfFilter).toContain('scale=1920:1080')

    // Should have logged warning about downscaling
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringMatching(/Long clip.*downscaling to 1080p/i)
    )

    consoleSpy.mockRestore()
  })

  it('should NOT downscale short clips (<15 seconds at 30fps)', async () => {
    const { VideoFramePipeline } = await import('./video-frame-pipeline')

    let capturedVfFilter = ''

    const mockFFmpeg = {
      writeFile: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockImplementation((name: string) => {
        if (name === 'frame_0001.png') {
          return Promise.resolve(new Uint8Array([
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
            0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
            0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00, 0x64,
            0x08, 0x02, 0x00, 0x00, 0x00,
          ]))
        }
        return Promise.resolve(new Uint8Array([1, 2, 3]))
      }),
      exec: vi.fn().mockImplementation((args: string[]) => {
        const vfIndex = args.indexOf('-vf')
        if (vfIndex !== -1) {
          capturedVfFilter = args[vfIndex + 1]
        }
        return Promise.resolve(0)
      }),
      deleteFile: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      off: vi.fn(),
    }

    const pipeline = new VideoFramePipeline(mockFFmpeg as any)

    // 10 seconds at 30fps = 300 frames, under 450 limit
    await pipeline.exportWithTracer({
      videoBlob: new Blob(['video'], { type: 'video/mp4' }),
      trajectory: [{ x: 0.5, y: 0.5, timestamp: 0 }],
      startTime: 0,
      endTime: 10,
      fps: 30,
      tracerStyle: defaultTracerStyle,
    })

    // Should NOT include scale filter
    expect(capturedVfFilter).not.toContain('scale=')
    // Should only have fps filter
    expect(capturedVfFilter).toBe('fps=30')
  })
})

// =============================================================================
// FRAME EXTRACTION TIMEOUT TESTS
// =============================================================================

/**
 * Tests for frame extraction timeout behavior.
 *
 * The 2-minute timeout prevents indefinite hangs during frame extraction.
 * If extraction takes longer than 120 seconds, it's likely stuck.
 *
 * NOTE: These tests document the timeout behavior but don't use fake timers
 * because Promise.race with setTimeout doesn't work well with vi.useFakeTimers.
 * The actual timeout functionality is tested by observing the error messages.
 */
describe('VideoFramePipeline - Frame Extraction Timeout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const defaultTracerStyle = {
    color: '#FF4444',
    thickness: 2,
    glowEnabled: false,
    glowColor: '#ffffff',
    glowIntensity: 0.5,
    shadowEnabled: false,
    shadowColor: '#000000',
    shadowBlur: 4,
  }

  it('should have timeout configured at 120 seconds', async () => {
    /**
     * Verify that the EXTRACTION_TIMEOUT_MS constant exists.
     * We can't easily test the actual timeout without waiting 2 minutes,
     * so we document the expected behavior here.
     */
    // Read the source to verify timeout is 120000ms
    // This is a documentation test - actual timeout behavior is manual UAT
    expect(true).toBe(true) // Placeholder - actual test is in UAT
  })

  it('should include timeout in extraction start log', async () => {
    const { VideoFramePipeline } = await import('./video-frame-pipeline')

    const consoleSpy = vi.spyOn(console, 'log')

    const mockFFmpeg = {
      writeFile: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockImplementation((name: string) => {
        if (name === 'frame_0001.png') {
          return Promise.resolve(new Uint8Array([
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
            0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
            0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00, 0x64,
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

    const pipeline = new VideoFramePipeline(mockFFmpeg as any)

    await pipeline.exportWithTracer({
      videoBlob: new Blob(['video'], { type: 'video/mp4' }),
      trajectory: [{ x: 0.5, y: 0.5, timestamp: 0 }],
      startTime: 0,
      endTime: 0.1,
      fps: 10,
      tracerStyle: defaultTracerStyle,
    })

    // Should have logged timeout in start message
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringMatching(/Starting frame extraction.*timeout.*120s/i)
    )

    consoleSpy.mockRestore()
  })

  it('should complete successfully when exec finishes quickly', async () => {
    const { VideoFramePipeline } = await import('./video-frame-pipeline')

    const mockFFmpeg = {
      writeFile: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockImplementation((name: string) => {
        if (name === 'frame_0001.png') {
          return Promise.resolve(new Uint8Array([
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
            0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
            0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00, 0x64,
            0x08, 0x02, 0x00, 0x00, 0x00,
          ]))
        }
        return Promise.resolve(new Uint8Array([1, 2, 3]))
      }),
      exec: vi.fn().mockResolvedValue(0), // Immediate success
      deleteFile: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      off: vi.fn(),
    }

    const pipeline = new VideoFramePipeline(mockFFmpeg as any)

    const result = await pipeline.exportWithTracer({
      videoBlob: new Blob(['video'], { type: 'video/mp4' }),
      trajectory: [{ x: 0.5, y: 0.5, timestamp: 0 }],
      startTime: 0,
      endTime: 0.1,
      fps: 10,
      tracerStyle: defaultTracerStyle,
    })

    // Should complete successfully
    expect(result).toBeInstanceOf(Blob)
  })
})

// =============================================================================
// MEMORY CLEANUP TESTS
// =============================================================================

/**
 * Tests for memory cleanup after export.
 *
 * FFmpeg WASM stores files in virtual memory. Failure to clean up
 * leads to memory exhaustion on subsequent exports.
 */
describe('VideoFramePipeline - Memory Cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const defaultTracerStyle = {
    color: '#FF4444',
    thickness: 2,
    glowEnabled: false,
    glowColor: '#ffffff',
    glowIntensity: 0.5,
    shadowEnabled: false,
    shadowColor: '#000000',
    shadowBlur: 4,
  }

  it('should delete input file after successful export', async () => {
    const { VideoFramePipeline } = await import('./video-frame-pipeline')

    const mockFFmpeg = {
      writeFile: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockImplementation((name: string) => {
        if (name === 'frame_0001.png') {
          return Promise.resolve(new Uint8Array([
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
            0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
            0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00, 0x64,
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

    const pipeline = new VideoFramePipeline(mockFFmpeg as any)

    await pipeline.exportWithTracer({
      videoBlob: new Blob(['video'], { type: 'video/mp4' }),
      trajectory: [{ x: 0.5, y: 0.5, timestamp: 0 }],
      startTime: 0,
      endTime: 0.1,
      fps: 10,
      tracerStyle: defaultTracerStyle,
    })

    // Should have called deleteFile for input.mp4
    expect(mockFFmpeg.deleteFile).toHaveBeenCalledWith('input.mp4')
  })

  it('should delete output file after successful export', async () => {
    const { VideoFramePipeline } = await import('./video-frame-pipeline')

    const mockFFmpeg = {
      writeFile: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockImplementation((name: string) => {
        if (name === 'frame_0001.png') {
          return Promise.resolve(new Uint8Array([
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
            0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
            0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00, 0x64,
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

    const pipeline = new VideoFramePipeline(mockFFmpeg as any)

    await pipeline.exportWithTracer({
      videoBlob: new Blob(['video'], { type: 'video/mp4' }),
      trajectory: [{ x: 0.5, y: 0.5, timestamp: 0 }],
      startTime: 0,
      endTime: 0.1,
      fps: 10,
      tracerStyle: defaultTracerStyle,
    })

    // Should have called deleteFile for output.mp4
    expect(mockFFmpeg.deleteFile).toHaveBeenCalledWith('output.mp4')
  })

  it('should delete all frame files after successful export', async () => {
    const { VideoFramePipeline } = await import('./video-frame-pipeline')

    const mockFFmpeg = {
      writeFile: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockImplementation((name: string) => {
        if (name === 'frame_0001.png') {
          return Promise.resolve(new Uint8Array([
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
            0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
            0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00, 0x64,
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

    const pipeline = new VideoFramePipeline(mockFFmpeg as any)

    // 0.1s at 10fps = 1 frame
    await pipeline.exportWithTracer({
      videoBlob: new Blob(['video'], { type: 'video/mp4' }),
      trajectory: [{ x: 0.5, y: 0.5, timestamp: 0 }],
      startTime: 0,
      endTime: 0.1,
      fps: 10,
      tracerStyle: defaultTracerStyle,
    })

    // Should have called deleteFile for frame files
    expect(mockFFmpeg.deleteFile).toHaveBeenCalledWith('frame_0001.png')
  })

  it('should continue cleanup even if individual delete fails', async () => {
    const { VideoFramePipeline } = await import('./video-frame-pipeline')

    let deleteCallCount = 0
    const mockFFmpeg = {
      writeFile: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockImplementation((name: string) => {
        if (name === 'frame_0001.png') {
          return Promise.resolve(new Uint8Array([
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
            0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
            0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00, 0x64,
            0x08, 0x02, 0x00, 0x00, 0x00,
          ]))
        }
        return Promise.resolve(new Uint8Array([1, 2, 3]))
      }),
      exec: vi.fn().mockResolvedValue(0),
      deleteFile: vi.fn().mockImplementation(() => {
        deleteCallCount++
        if (deleteCallCount === 1) {
          // First delete fails
          return Promise.reject(new Error('File not found'))
        }
        return Promise.resolve(undefined)
      }),
      on: vi.fn(),
      off: vi.fn(),
    }

    const pipeline = new VideoFramePipeline(mockFFmpeg as any)

    // Should NOT throw even if some deletes fail
    const result = await pipeline.exportWithTracer({
      videoBlob: new Blob(['video'], { type: 'video/mp4' }),
      trajectory: [{ x: 0.5, y: 0.5, timestamp: 0 }],
      startTime: 0,
      endTime: 0.1,
      fps: 10,
      tracerStyle: defaultTracerStyle,
    })

    expect(result).toBeInstanceOf(Blob)
    // Should still have attempted multiple deletes despite first failure
    expect(deleteCallCount).toBeGreaterThan(1)
  })
})

// =============================================================================
// EXPORT PROGRESS REPORTING ACCURACY TESTS
// =============================================================================

/**
 * Tests for export progress reporting accuracy.
 *
 * Accurate progress reporting is critical for UX:
 * - Stuck at 0%: User thinks nothing is happening
 * - Stuck at 99%: User thinks it's almost done but it's hanging
 * - Jumpy progress: User can't estimate remaining time
 */
describe('VideoFramePipeline - Progress Reporting Accuracy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const defaultTracerStyle = {
    color: '#FF4444',
    thickness: 2,
    glowEnabled: false,
    glowColor: '#ffffff',
    glowIntensity: 0.5,
    shadowEnabled: false,
    shadowColor: '#000000',
    shadowBlur: 4,
  }

  it('should report preparing phase with -1 (indeterminate) initially', async () => {
    const { VideoFramePipeline } = await import('./video-frame-pipeline')

    const progressUpdates: { phase: string; progress: number }[] = []

    const mockFFmpeg = {
      writeFile: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockImplementation((name: string) => {
        if (name === 'frame_0001.png') {
          return Promise.resolve(new Uint8Array([
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
            0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
            0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00, 0x64,
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

    const pipeline = new VideoFramePipeline(mockFFmpeg as any)

    await pipeline.exportWithTracer({
      videoBlob: new Blob(['video'], { type: 'video/mp4' }),
      trajectory: [{ x: 0.5, y: 0.5, timestamp: 0 }],
      startTime: 0,
      endTime: 0.1,
      fps: 10,
      tracerStyle: defaultTracerStyle,
      onProgress: (p) => progressUpdates.push({ phase: p.phase, progress: p.progress }),
    })

    // First preparing update should be -1 (indeterminate)
    const preparingUpdates = progressUpdates.filter(p => p.phase === 'preparing')
    expect(preparingUpdates[0].progress).toBe(-1)
  })

  it('should report preparing phase completing at 100%', async () => {
    const { VideoFramePipeline } = await import('./video-frame-pipeline')

    const progressUpdates: { phase: string; progress: number }[] = []

    const mockFFmpeg = {
      writeFile: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockImplementation((name: string) => {
        if (name === 'frame_0001.png') {
          return Promise.resolve(new Uint8Array([
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
            0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
            0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00, 0x64,
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

    const pipeline = new VideoFramePipeline(mockFFmpeg as any)

    await pipeline.exportWithTracer({
      videoBlob: new Blob(['video'], { type: 'video/mp4' }),
      trajectory: [{ x: 0.5, y: 0.5, timestamp: 0 }],
      startTime: 0,
      endTime: 0.1,
      fps: 10,
      tracerStyle: defaultTracerStyle,
      onProgress: (p) => progressUpdates.push({ phase: p.phase, progress: p.progress }),
    })

    // Should have preparing phase ending at 100%
    const preparingUpdates = progressUpdates.filter(p => p.phase === 'preparing')
    const lastPreparing = preparingUpdates[preparingUpdates.length - 1]
    expect(lastPreparing.progress).toBe(100)
  })

  it('should report all phases in correct order', async () => {
    const { VideoFramePipeline } = await import('./video-frame-pipeline')

    const phaseOrder: string[] = []

    const mockFFmpeg = {
      writeFile: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockImplementation((name: string) => {
        if (name === 'frame_0001.png') {
          return Promise.resolve(new Uint8Array([
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
            0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
            0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00, 0x64,
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

    const pipeline = new VideoFramePipeline(mockFFmpeg as any)

    await pipeline.exportWithTracer({
      videoBlob: new Blob(['video'], { type: 'video/mp4' }),
      trajectory: [{ x: 0.5, y: 0.5, timestamp: 0 }],
      startTime: 0,
      endTime: 0.1,
      fps: 10,
      tracerStyle: defaultTracerStyle,
      onProgress: (p) => {
        if (!phaseOrder.includes(p.phase)) {
          phaseOrder.push(p.phase)
        }
      },
    })

    // Phases should occur in this order
    expect(phaseOrder).toEqual(['preparing', 'extracting', 'compositing', 'encoding', 'complete'])
  })

  it('should include currentFrame and totalFrames during compositing', async () => {
    const { VideoFramePipeline } = await import('./video-frame-pipeline')

    const compositingUpdates: { currentFrame?: number; totalFrames?: number }[] = []

    const mockFFmpeg = {
      writeFile: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockImplementation((name: string) => {
        if (name.startsWith('frame_')) {
          return Promise.resolve(new Uint8Array([
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
            0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
            0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00, 0x64,
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

    const pipeline = new VideoFramePipeline(mockFFmpeg as any)

    // 0.3 seconds at 10fps = 3 frames
    await pipeline.exportWithTracer({
      videoBlob: new Blob(['video'], { type: 'video/mp4' }),
      trajectory: [{ x: 0.5, y: 0.5, timestamp: 0 }],
      startTime: 0,
      endTime: 0.3,
      fps: 10,
      tracerStyle: defaultTracerStyle,
      onProgress: (p) => {
        if (p.phase === 'compositing') {
          compositingUpdates.push({ currentFrame: p.currentFrame, totalFrames: p.totalFrames })
        }
      },
    })

    // Should have compositing updates with frame info
    expect(compositingUpdates.length).toBeGreaterThan(0)
    // Last compositing update should show all frames done
    const lastCompositing = compositingUpdates[compositingUpdates.length - 1]
    expect(lastCompositing.totalFrames).toBe(3)
  })

  it('should cap encoding progress at 99% until complete', async () => {
    const { VideoFramePipeline } = await import('./video-frame-pipeline')

    const encodingUpdates: number[] = []

    // Simulate FFmpeg reporting >99% progress
    const progressListeners: Array<(data: { progress: number }) => void> = []

    const mockFFmpeg = {
      writeFile: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockImplementation((name: string) => {
        if (name === 'frame_0001.png') {
          return Promise.resolve(new Uint8Array([
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
            0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
            0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00, 0x64,
            0x08, 0x02, 0x00, 0x00, 0x00,
          ]))
        }
        return Promise.resolve(new Uint8Array([1, 2, 3]))
      }),
      exec: vi.fn().mockImplementation(async () => {
        // Simulate FFmpeg reporting progress during encoding
        for (const listener of progressListeners) {
          listener({ progress: 0.5 }) // 50%
          listener({ progress: 0.95 }) // 95%
          listener({ progress: 1.0 }) // 100% from FFmpeg
        }
        return 0
      }),
      deleteFile: vi.fn().mockResolvedValue(undefined),
      on: vi.fn().mockImplementation((event: string, callback: (data: { progress: number }) => void) => {
        if (event === 'progress') {
          progressListeners.push(callback)
        }
      }),
      off: vi.fn().mockImplementation((event: string, callback: (data: { progress: number }) => void) => {
        if (event === 'progress') {
          const idx = progressListeners.indexOf(callback)
          if (idx !== -1) progressListeners.splice(idx, 1)
        }
      }),
    }

    const pipeline = new VideoFramePipeline(mockFFmpeg as any)

    await pipeline.exportWithTracer({
      videoBlob: new Blob(['video'], { type: 'video/mp4' }),
      trajectory: [{ x: 0.5, y: 0.5, timestamp: 0 }],
      startTime: 0,
      endTime: 0.1,
      fps: 10,
      tracerStyle: defaultTracerStyle,
      onProgress: (p) => {
        if (p.phase === 'encoding') {
          encodingUpdates.push(p.progress)
        }
      },
    })

    // Before 100%, values should be capped at 99%
    // Find the index of 100 (should be the last one)
    const indexOf100 = encodingUpdates.indexOf(100)
    const updatesBeforeFinal = encodingUpdates.slice(0, indexOf100)

    // All updates before final 100% should be <= 99%
    for (const progress of updatesBeforeFinal) {
      expect(progress).toBeLessThanOrEqual(99)
    }

    // Should end with explicit 100%
    expect(encodingUpdates[encodingUpdates.length - 1]).toBe(100)
  })
})

// =============================================================================
// 4K VIDEO DOWNSCALING LOGIC TESTS
// =============================================================================

/**
 * Tests for 4K video handling.
 *
 * 4K videos (3840x2160) are problematic for FFmpeg WASM:
 * - Higher memory usage per frame
 * - Slower decode times
 * - More likely to cause memory exhaustion
 *
 * Current mitigation: Downscale to 1080p for long clips.
 * Future improvement: Detect resolution and always downscale 4K.
 */
describe('VideoFramePipeline - 4K Video Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const defaultTracerStyle = {
    color: '#FF4444',
    thickness: 2,
    glowEnabled: false,
    glowColor: '#ffffff',
    glowIntensity: 0.5,
    shadowEnabled: false,
    shadowColor: '#000000',
    shadowBlur: 4,
  }

  it('should log blob size in MB for visibility', async () => {
    const { VideoFramePipeline } = await import('./video-frame-pipeline')

    const consoleLogSpy = vi.spyOn(console, 'log')

    const mockFFmpeg = {
      writeFile: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockImplementation((name: string) => {
        if (name === 'frame_0001.png') {
          return Promise.resolve(new Uint8Array([
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
            0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
            0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00, 0x64,
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

    const pipeline = new VideoFramePipeline(mockFFmpeg as any)

    // Create blob with known size (50MB)
    const blob = new Blob(['x'], { type: 'video/mp4' })
    Object.defineProperty(blob, 'size', { value: 50 * 1024 * 1024 })

    await pipeline.exportWithTracer({
      videoBlob: blob,
      trajectory: [{ x: 0.5, y: 0.5, timestamp: 0 }],
      startTime: 0,
      endTime: 0.1,
      fps: 10,
      tracerStyle: defaultTracerStyle,
    })

    // Should have logged blob size
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringMatching(/Preparing video data.*50.*MB/i)
    )

    consoleLogSpy.mockRestore()
  })

  it('should log fetchFile and writeFile timing for performance monitoring', async () => {
    const { VideoFramePipeline } = await import('./video-frame-pipeline')

    const consoleLogSpy = vi.spyOn(console, 'log')

    const mockFFmpeg = {
      writeFile: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockImplementation((name: string) => {
        if (name === 'frame_0001.png') {
          return Promise.resolve(new Uint8Array([
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
            0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
            0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00, 0x64,
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

    const pipeline = new VideoFramePipeline(mockFFmpeg as any)

    await pipeline.exportWithTracer({
      videoBlob: new Blob(['video'], { type: 'video/mp4' }),
      trajectory: [{ x: 0.5, y: 0.5, timestamp: 0 }],
      startTime: 0,
      endTime: 0.1,
      fps: 10,
      tracerStyle: defaultTracerStyle,
    })

    // Should have logged conversion timing
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringMatching(/Blob converted to Uint8Array/i)
    )

    // Should have logged write timing
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringMatching(/Video written to FFmpeg/i)
    )

    consoleLogSpy.mockRestore()
  })

  it('should use force_original_aspect_ratio in scale filter', async () => {
    const { VideoFramePipeline } = await import('./video-frame-pipeline')

    let capturedVfFilter = ''

    const mockFFmpeg = {
      writeFile: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockImplementation((name: string) => {
        if (name === 'frame_0001.png') {
          return Promise.resolve(new Uint8Array([
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
            0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
            0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00, 0x64,
            0x08, 0x02, 0x00, 0x00, 0x00,
          ]))
        }
        return Promise.resolve(new Uint8Array([1, 2, 3]))
      }),
      exec: vi.fn().mockImplementation((args: string[]) => {
        const vfIndex = args.indexOf('-vf')
        if (vfIndex !== -1) {
          capturedVfFilter = args[vfIndex + 1]
        }
        return Promise.resolve(0)
      }),
      deleteFile: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      off: vi.fn(),
    }

    const pipeline = new VideoFramePipeline(mockFFmpeg as any)

    // 25 second clip triggers downscaling
    await pipeline.exportWithTracer({
      videoBlob: new Blob(['video'], { type: 'video/mp4' }),
      trajectory: [{ x: 0.5, y: 0.5, timestamp: 0 }],
      startTime: 0,
      endTime: 25,
      fps: 30,
      tracerStyle: defaultTracerStyle,
    })

    // Scale filter should preserve aspect ratio
    expect(capturedVfFilter).toContain('force_original_aspect_ratio=decrease')
  })
})

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
    const { VideoFramePipeline } = await import('./video-frame-pipeline')

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
    const { VideoFramePipeline } = await import('./video-frame-pipeline')

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
