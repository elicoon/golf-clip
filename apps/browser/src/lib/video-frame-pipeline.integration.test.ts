// apps/browser/src/lib/video-frame-pipeline.integration.test.ts
/**
 * Integration tests for VideoFramePipeline export flow.
 *
 * These tests verify the full export pipeline including:
 * - Progress callback sequences
 * - FFmpeg command generation
 * - Error handling
 * - Edge cases
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { DEFAULT_TRACER_STYLE } from '../types/tracer'

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
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      lineCap: 'butt',
      lineJoin: 'miter',
      shadowColor: '',
      shadowBlur: 0,
    } as unknown as CanvasRenderingContext2D
  }

  convertToBlob(): Promise<Blob> {
    return Promise.resolve(new Blob(['mock-png'], { type: 'image/png' }))
  }
}

// Mock ImageBitmap
class MockImageBitmap {
  width = 1920
  height = 1080
  close = vi.fn()
}

interface MockFFmpegOptions {
  failOnExec?: boolean
  failOnReadFile?: boolean
  failOnWriteFile?: boolean
}

function createMockFFmpeg(options: MockFFmpegOptions = {}) {
  const files = new Map<string, Uint8Array>()
  let frameCount = 0

  return {
    writeFile: vi.fn(async (name: string, data: Uint8Array) => {
      if (options.failOnWriteFile) {
        throw new Error('FFmpeg writeFile failed')
      }
      files.set(name, data)
    }),

    readFile: vi.fn(async (name: string) => {
      if (options.failOnReadFile) {
        throw new Error('FFmpeg readFile failed')
      }
      // Return mock PNG data for frame files
      if (name.startsWith('frame_') || name === 'output.mp4') {
        return new Uint8Array([0x89, 0x50, 0x4e, 0x47]) // PNG header
      }
      return files.get(name) || new Uint8Array()
    }),

    exec: vi.fn(async (args: string[]) => {
      if (options.failOnExec) {
        throw new Error('FFmpeg exec failed')
      }
      // Simulate frame extraction - create frame files based on fps and duration
      if (args.includes('image2')) {
        const fpsIndex = args.indexOf('-vf')
        const tIndex = args.indexOf('-t')
        let fps = 30
        let duration = 2

        if (fpsIndex !== -1 && args[fpsIndex + 1]) {
          const match = args[fpsIndex + 1].match(/fps=(\d+)/)
          if (match) fps = parseInt(match[1])
        }
        if (tIndex !== -1 && args[tIndex + 1]) {
          duration = parseFloat(args[tIndex + 1])
        }

        frameCount = Math.ceil(fps * duration)
        for (let i = 1; i <= frameCount; i++) {
          const frameName = `frame_${i.toString().padStart(4, '0')}.png`
          files.set(frameName, new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
        }
      }
    }),

    deleteFile: vi.fn(async () => {
      // Silent cleanup
    }),

    _getFrameCount: () => frameCount,
  }
}

beforeAll(() => {
  // @ts-expect-error - polyfilling for tests
  globalThis.OffscreenCanvas = MockOffscreenCanvas
  // @ts-expect-error - polyfilling for tests
  globalThis.ImageData = MockImageData
  globalThis.createImageBitmap = vi.fn(() => Promise.resolve(new MockImageBitmap()))
})

describe('VideoFramePipeline Integration', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  describe('exportWithTracer', () => {
    it('should complete full export pipeline and return MP4 blob', async () => {
      const { VideoFramePipeline } = await import('./video-frame-pipeline')
      const mockFFmpeg = createMockFFmpeg()
      const pipeline = new VideoFramePipeline(mockFFmpeg as any)

      const result = await pipeline.exportWithTracer({
        videoBlob: new Blob(['video'], { type: 'video/mp4' }),
        trajectory: [
          { x: 0.1, y: 0.9, timestamp: 0 },
          { x: 0.5, y: 0.2, timestamp: 1 },
          { x: 0.9, y: 0.3, timestamp: 2 },
        ],
        startTime: 0,
        endTime: 2,
        fps: 30,
        quality: 'preview',
        tracerStyle: DEFAULT_TRACER_STYLE,
      })

      expect(result).toBeInstanceOf(Blob)
      expect(result.type).toBe('video/mp4')
    })

    it('should report progress in correct phase sequence', async () => {
      const { VideoFramePipeline } = await import('./video-frame-pipeline')
      const mockFFmpeg = createMockFFmpeg()
      const pipeline = new VideoFramePipeline(mockFFmpeg as any)

      const progressUpdates: string[] = []

      await pipeline.exportWithTracer({
        videoBlob: new Blob(['video'], { type: 'video/mp4' }),
        trajectory: [
          { x: 0.1, y: 0.9, timestamp: 0 },
          { x: 0.9, y: 0.3, timestamp: 1 },
        ],
        startTime: 0,
        endTime: 1,
        fps: 10,
        quality: 'draft',
        tracerStyle: DEFAULT_TRACER_STYLE,
        onProgress: (p) => {
          if (!progressUpdates.includes(p.phase)) {
            progressUpdates.push(p.phase)
          }
        },
      })

      expect(progressUpdates).toEqual(['extracting', 'compositing', 'encoding', 'complete'])
    })

    it('should report frame progress during compositing', async () => {
      const { VideoFramePipeline } = await import('./video-frame-pipeline')
      const mockFFmpeg = createMockFFmpeg()
      const pipeline = new VideoFramePipeline(mockFFmpeg as any)

      const frameProgress: { current: number; total: number }[] = []

      await pipeline.exportWithTracer({
        videoBlob: new Blob(['video'], { type: 'video/mp4' }),
        trajectory: [
          { x: 0.1, y: 0.9, timestamp: 0 },
          { x: 0.9, y: 0.3, timestamp: 1 },
        ],
        startTime: 0,
        endTime: 1,
        fps: 5,
        quality: 'draft',
        tracerStyle: DEFAULT_TRACER_STYLE,
        onProgress: (p) => {
          if (p.phase === 'compositing' && p.currentFrame !== undefined) {
            frameProgress.push({ current: p.currentFrame, total: p.totalFrames! })
          }
        },
      })

      expect(frameProgress.length).toBeGreaterThan(0)
      expect(frameProgress[frameProgress.length - 1].current).toBe(frameProgress[0].total)
    })

    it('should use correct quality settings for each preset', async () => {
      const { VideoFramePipeline } = await import('./video-frame-pipeline')

      for (const [quality, expected] of [
        ['draft', { crf: '28', preset: 'ultrafast' }],
        ['preview', { crf: '23', preset: 'fast' }],
        ['final', { crf: '18', preset: 'medium' }],
      ] as const) {
        const mockFFmpeg = createMockFFmpeg()
        const pipeline = new VideoFramePipeline(mockFFmpeg as any)

        await pipeline.exportWithTracer({
          videoBlob: new Blob(['video'], { type: 'video/mp4' }),
          trajectory: [{ x: 0.5, y: 0.5, timestamp: 0 }],
          startTime: 0,
          endTime: 0.1,
          fps: 10,
          quality,
          tracerStyle: DEFAULT_TRACER_STYLE,
        })

        const execCalls = mockFFmpeg.exec.mock.calls
        const encodingCall = execCalls.find((call: string[][]) =>
          call[0].includes('-c:v') && call[0].includes('libx264')
        )

        expect(encodingCall).toBeDefined()
        const args = encodingCall![0]
        expect(args[args.indexOf('-crf') + 1]).toBe(expected.crf)
        expect(args[args.indexOf('-preset') + 1]).toBe(expected.preset)
      }
    })

    it('should cleanup temporary files after export', async () => {
      const { VideoFramePipeline } = await import('./video-frame-pipeline')
      const mockFFmpeg = createMockFFmpeg()
      const pipeline = new VideoFramePipeline(mockFFmpeg as any)

      await pipeline.exportWithTracer({
        videoBlob: new Blob(['video'], { type: 'video/mp4' }),
        trajectory: [{ x: 0.5, y: 0.5, timestamp: 0 }],
        startTime: 0,
        endTime: 1,
        fps: 10,
        quality: 'draft',
        tracerStyle: DEFAULT_TRACER_STYLE,
      })

      expect(mockFFmpeg.deleteFile).toHaveBeenCalled()
    })

    it('should handle markers in export', async () => {
      const { VideoFramePipeline } = await import('./video-frame-pipeline')
      const mockFFmpeg = createMockFFmpeg()
      const pipeline = new VideoFramePipeline(mockFFmpeg as any)

      const result = await pipeline.exportWithTracer({
        videoBlob: new Blob(['video'], { type: 'video/mp4' }),
        trajectory: [
          { x: 0.1, y: 0.9, timestamp: 0 },
          { x: 0.9, y: 0.3, timestamp: 1 },
        ],
        startTime: 0,
        endTime: 1,
        fps: 10,
        quality: 'draft',
        tracerStyle: { ...DEFAULT_TRACER_STYLE, showOriginMarker: true, showApexMarker: true, showLandingMarker: true },
        originPoint: { x: 0.1, y: 0.9 },
        apexPoint: { x: 0.5, y: 0.1 },
        landingPoint: { x: 0.9, y: 0.3 },
      })

      expect(result).toBeInstanceOf(Blob)
    })
  })

  describe('error handling', () => {
    it('should propagate FFmpeg exec errors', async () => {
      const { VideoFramePipeline } = await import('./video-frame-pipeline')
      const mockFFmpeg = createMockFFmpeg({ failOnExec: true })
      const pipeline = new VideoFramePipeline(mockFFmpeg as any)

      await expect(
        pipeline.exportWithTracer({
          videoBlob: new Blob(['video'], { type: 'video/mp4' }),
          trajectory: [{ x: 0.5, y: 0.5, timestamp: 0 }],
          startTime: 0,
          endTime: 1,
          tracerStyle: DEFAULT_TRACER_STYLE,
        })
      ).rejects.toThrow('FFmpeg exec failed')
    })

    it('should propagate FFmpeg readFile errors', async () => {
      const { VideoFramePipeline } = await import('./video-frame-pipeline')
      const mockFFmpeg = createMockFFmpeg({ failOnReadFile: true })
      const pipeline = new VideoFramePipeline(mockFFmpeg as any)

      await expect(
        pipeline.exportWithTracer({
          videoBlob: new Blob(['video'], { type: 'video/mp4' }),
          trajectory: [{ x: 0.5, y: 0.5, timestamp: 0 }],
          startTime: 0,
          endTime: 1,
          tracerStyle: DEFAULT_TRACER_STYLE,
        })
      ).rejects.toThrow('FFmpeg readFile failed')
    })

    it('should propagate FFmpeg writeFile errors', async () => {
      const { VideoFramePipeline } = await import('./video-frame-pipeline')
      const mockFFmpeg = createMockFFmpeg({ failOnWriteFile: true })
      const pipeline = new VideoFramePipeline(mockFFmpeg as any)

      await expect(
        pipeline.exportWithTracer({
          videoBlob: new Blob(['video'], { type: 'video/mp4' }),
          trajectory: [{ x: 0.5, y: 0.5, timestamp: 0 }],
          startTime: 0,
          endTime: 1,
          tracerStyle: DEFAULT_TRACER_STYLE,
        })
      ).rejects.toThrow('FFmpeg writeFile failed')
    })

    it('should not report complete phase after error', async () => {
      const { VideoFramePipeline } = await import('./video-frame-pipeline')
      const mockFFmpeg = createMockFFmpeg({ failOnExec: true })
      const pipeline = new VideoFramePipeline(mockFFmpeg as any)

      const phases: string[] = []

      try {
        await pipeline.exportWithTracer({
          videoBlob: new Blob(['video'], { type: 'video/mp4' }),
          trajectory: [{ x: 0.5, y: 0.5, timestamp: 0 }],
          startTime: 0,
          endTime: 1,
          tracerStyle: DEFAULT_TRACER_STYLE,
          onProgress: (p) => phases.push(p.phase),
        })
      } catch {
        // Expected
      }

      expect(phases).not.toContain('complete')
    })
  })

  describe('edge cases', () => {
    it('should handle very short duration', async () => {
      const { VideoFramePipeline } = await import('./video-frame-pipeline')
      const mockFFmpeg = createMockFFmpeg()
      const pipeline = new VideoFramePipeline(mockFFmpeg as any)

      const result = await pipeline.exportWithTracer({
        videoBlob: new Blob(['video'], { type: 'video/mp4' }),
        trajectory: [{ x: 0.5, y: 0.5, timestamp: 0 }],
        startTime: 0,
        endTime: 0.033, // ~1 frame at 30fps
        fps: 30,
        tracerStyle: DEFAULT_TRACER_STYLE,
      })

      expect(result).toBeInstanceOf(Blob)
    })

    it('should handle 60fps video', async () => {
      const { VideoFramePipeline } = await import('./video-frame-pipeline')
      const mockFFmpeg = createMockFFmpeg()
      const pipeline = new VideoFramePipeline(mockFFmpeg as any)

      const frameCount = pipeline.calculateFrameCount(1.0, 60)
      expect(frameCount).toBe(60)
    })

    it('should handle empty trajectory', async () => {
      const { VideoFramePipeline } = await import('./video-frame-pipeline')
      const mockFFmpeg = createMockFFmpeg()
      const pipeline = new VideoFramePipeline(mockFFmpeg as any)

      const result = await pipeline.exportWithTracer({
        videoBlob: new Blob(['video'], { type: 'video/mp4' }),
        trajectory: [],
        startTime: 0,
        endTime: 1,
        fps: 10,
        tracerStyle: DEFAULT_TRACER_STYLE,
      })

      expect(result).toBeInstanceOf(Blob)
    })

    it('should handle single point trajectory', async () => {
      const { VideoFramePipeline } = await import('./video-frame-pipeline')
      const mockFFmpeg = createMockFFmpeg()
      const pipeline = new VideoFramePipeline(mockFFmpeg as any)

      const result = await pipeline.exportWithTracer({
        videoBlob: new Blob(['video'], { type: 'video/mp4' }),
        trajectory: [{ x: 0.5, y: 0.5, timestamp: 0.5 }],
        startTime: 0,
        endTime: 1,
        fps: 10,
        tracerStyle: DEFAULT_TRACER_STYLE,
      })

      expect(result).toBeInstanceOf(Blob)
    })

    it('should use default fps when not specified', async () => {
      const { VideoFramePipeline } = await import('./video-frame-pipeline')
      const mockFFmpeg = createMockFFmpeg()
      const pipeline = new VideoFramePipeline(mockFFmpeg as any)

      await pipeline.exportWithTracer({
        videoBlob: new Blob(['video'], { type: 'video/mp4' }),
        trajectory: [{ x: 0.5, y: 0.5, timestamp: 0 }],
        startTime: 0,
        endTime: 1,
        tracerStyle: DEFAULT_TRACER_STYLE,
      })

      const execCalls = mockFFmpeg.exec.mock.calls
      const extractCall = execCalls.find((call: string[][]) => call[0].includes('image2'))
      expect(extractCall).toBeDefined()
      expect(extractCall![0]).toContain('fps=30')
    })
  })
})
