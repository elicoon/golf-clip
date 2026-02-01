// apps/browser/src/lib/video-frame-pipeline.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

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
