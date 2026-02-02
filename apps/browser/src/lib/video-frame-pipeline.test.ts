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
    const execPromise = new Promise<void>(resolve => {
      // Simulate 3 seconds of extraction
      setTimeout(resolve, 3000)
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
