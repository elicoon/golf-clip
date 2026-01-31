// apps/browser/src/lib/video-frame-pipeline.test.ts
import { describe, it, expect, vi } from 'vitest'

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
