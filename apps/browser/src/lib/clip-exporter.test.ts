// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { exportClipWithTracer, exportWithCanvasCompositing } from './clip-exporter'

// Mock fetchFile from @ffmpeg/util
vi.mock('@ffmpeg/util', () => ({
  fetchFile: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
}))

describe('exportClipWithTracer', () => {
  it('calls FFmpeg with correct arguments including trajectory filter', async () => {
    const mockExec = vi.fn().mockResolvedValue(0)
    const mockWriteFile = vi.fn().mockResolvedValue(undefined)
    const mockReadFile = vi.fn().mockResolvedValue(new Uint8Array([0, 0, 0, 1]))
    const mockDeleteFile = vi.fn().mockResolvedValue(undefined)

    const mockFfmpeg = {
      writeFile: mockWriteFile,
      exec: mockExec,
      readFile: mockReadFile,
      deleteFile: mockDeleteFile,
    }

    const result = await exportClipWithTracer(mockFfmpeg as any, {
      videoBlob: new Blob(['test'], { type: 'video/mp4' }),
      trajectory: [
        { x: 0.1, y: 0.2, timestamp: 0 },
        { x: 0.5, y: 0.5, timestamp: 1 },
        { x: 0.9, y: 0.8, timestamp: 2 },
      ],
      startTime: 5,
      endTime: 15,
      videoWidth: 1920,
      videoHeight: 1080,
    })

    expect(mockWriteFile).toHaveBeenCalledWith('input.mp4', expect.any(Uint8Array))
    expect(mockExec).toHaveBeenCalledWith(
      expect.arrayContaining(['-i', 'input.mp4', '-ss', '5', '-t', '10']),
    )
    expect(result).toBeInstanceOf(Blob)
    expect(result.type).toBe('video/mp4')
    expect(mockDeleteFile).toHaveBeenCalledWith('input.mp4')
    expect(mockDeleteFile).toHaveBeenCalledWith('output.mp4')
  })

  it('generates null filter for trajectory with fewer than 2 points', async () => {
    const mockExec = vi.fn().mockResolvedValue(0)
    const mockFfmpeg = {
      writeFile: vi.fn().mockResolvedValue(undefined),
      exec: mockExec,
      readFile: vi.fn().mockResolvedValue(new Uint8Array([0])),
      deleteFile: vi.fn().mockResolvedValue(undefined),
    }

    await exportClipWithTracer(mockFfmpeg as any, {
      videoBlob: new Blob(['test'], { type: 'video/mp4' }),
      trajectory: [{ x: 0.5, y: 0.5, timestamp: 0 }],
      startTime: 0,
      endTime: 5,
      videoWidth: 1920,
      videoHeight: 1080,
    })

    const execArgs = mockExec.mock.calls[0][0]
    const vfIndex = execArgs.indexOf('-vf')
    expect(execArgs[vfIndex + 1]).toBe('null')
  })

  it('throws when FFmpeg exits with non-zero code', async () => {
    const mockFfmpeg = {
      writeFile: vi.fn().mockResolvedValue(undefined),
      exec: vi.fn().mockResolvedValue(1),
      readFile: vi.fn(),
      deleteFile: vi.fn().mockResolvedValue(undefined),
    }

    await expect(
      exportClipWithTracer(mockFfmpeg as any, {
        videoBlob: new Blob(['test'], { type: 'video/mp4' }),
        trajectory: [
          { x: 0.1, y: 0.2, timestamp: 0 },
          { x: 0.5, y: 0.5, timestamp: 1 },
        ],
        startTime: 0,
        endTime: 5,
        videoWidth: 1920,
        videoHeight: 1080,
      }),
    ).rejects.toThrow('FFmpeg export failed with exit code 1')
  })

  it('throws when FFmpeg output is not Uint8Array', async () => {
    const mockFfmpeg = {
      writeFile: vi.fn().mockResolvedValue(undefined),
      exec: vi.fn().mockResolvedValue(0),
      readFile: vi.fn().mockResolvedValue('string-data'),
      deleteFile: vi.fn().mockResolvedValue(undefined),
    }

    await expect(
      exportClipWithTracer(mockFfmpeg as any, {
        videoBlob: new Blob(['test'], { type: 'video/mp4' }),
        trajectory: [
          { x: 0.1, y: 0.2, timestamp: 0 },
          { x: 0.5, y: 0.5, timestamp: 1 },
        ],
        startTime: 0,
        endTime: 5,
        videoWidth: 1920,
        videoHeight: 1080,
      }),
    ).rejects.toThrow('Unexpected FFmpeg output format')
  })

  it('cleans up files even on error', async () => {
    const mockDeleteFile = vi.fn().mockResolvedValue(undefined)
    const mockFfmpeg = {
      writeFile: vi.fn().mockResolvedValue(undefined),
      exec: vi.fn().mockResolvedValue(1),
      readFile: vi.fn(),
      deleteFile: mockDeleteFile,
    }

    await expect(
      exportClipWithTracer(mockFfmpeg as any, {
        videoBlob: new Blob(['test'], { type: 'video/mp4' }),
        trajectory: [
          { x: 0.1, y: 0.2, timestamp: 0 },
          { x: 0.5, y: 0.5, timestamp: 1 },
        ],
        startTime: 0,
        endTime: 5,
        videoWidth: 1920,
        videoHeight: 1080,
      }),
    ).rejects.toThrow()

    expect(mockDeleteFile).toHaveBeenCalledWith('input.mp4')
    expect(mockDeleteFile).toHaveBeenCalledWith('output.mp4')
  })

  it('uses default tracer color and width', async () => {
    const mockExec = vi.fn().mockResolvedValue(0)
    const mockFfmpeg = {
      writeFile: vi.fn().mockResolvedValue(undefined),
      exec: mockExec,
      readFile: vi.fn().mockResolvedValue(new Uint8Array([0])),
      deleteFile: vi.fn().mockResolvedValue(undefined),
    }

    await exportClipWithTracer(mockFfmpeg as any, {
      videoBlob: new Blob(['test'], { type: 'video/mp4' }),
      trajectory: [
        { x: 0.1, y: 0.2, timestamp: 0 },
        { x: 0.5, y: 0.5, timestamp: 1 },
      ],
      startTime: 0,
      endTime: 5,
      videoWidth: 1920,
      videoHeight: 1080,
    })

    const execArgs = mockExec.mock.calls[0][0]
    const vfIndex = execArgs.indexOf('-vf')
    const filter = execArgs[vfIndex + 1]
    expect(filter).toContain('color=yellow')
    expect(filter).toContain('w=3')
    expect(filter).toContain('h=3')
  })
})

describe('exportWithCanvasCompositing', () => {
  it('throws not implemented error', async () => {
    const blob = new Blob(['test'], { type: 'video/mp4' })
    const canvas = document.createElement('canvas')

    await expect(exportWithCanvasCompositing(blob, canvas, 0, 5)).rejects.toThrow(
      'Canvas compositing not yet implemented',
    )
  })
})
