/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest'
import { exportClipWithTracer, exportWithCanvasCompositing } from './clip-exporter'
import { fetchFile } from '@ffmpeg/util'

// Mock @ffmpeg/util since clip-exporter imports fetchFile from it
vi.mock('@ffmpeg/util', () => ({
  fetchFile: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
}))

describe('exportClipWithTracer', () => {
  function createMockFFmpeg(overrides: Record<string, unknown> = {}) {
    return {
      writeFile: vi.fn().mockResolvedValue(undefined),
      exec: vi.fn().mockResolvedValue(0),
      readFile: vi.fn().mockResolvedValue(new Uint8Array([10, 20, 30])),
      deleteFile: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    }
  }

  const baseOptions = {
    videoBlob: new Blob(['test-video'], { type: 'video/mp4' }),
    trajectory: [
      { x: 0.1, y: 0.2, timestamp: 0 },
      { x: 0.5, y: 0.6, timestamp: 0.5 },
      { x: 0.9, y: 0.8, timestamp: 1.0 },
    ],
    startTime: 2,
    endTime: 5,
    videoWidth: 1920,
    videoHeight: 1080,
  }

  it('returns a video/mp4 Blob on successful export', async () => {
    const ffmpeg = createMockFFmpeg()

    const result = await exportClipWithTracer(ffmpeg as any, baseOptions)

    expect(result).toBeInstanceOf(Blob)
    expect(result.type).toBe('video/mp4')
    expect(fetchFile).toHaveBeenCalledWith(baseOptions.videoBlob)
  })

  it('calls ffmpeg.exec with correct time range and trajectory filter', async () => {
    const ffmpeg = createMockFFmpeg()

    await exportClipWithTracer(ffmpeg as any, baseOptions)

    expect(ffmpeg.writeFile).toHaveBeenCalledWith('input.mp4', expect.any(Uint8Array))
    expect(ffmpeg.exec).toHaveBeenCalledWith(
      expect.arrayContaining(['-ss', '2', '-t', '3'])
    )
    // Should include -vf with drawbox commands from trajectory
    const execArgs = ffmpeg.exec.mock.calls[0][0] as string[]
    const vfIndex = execArgs.indexOf('-vf')
    expect(vfIndex).toBeGreaterThan(-1)
    expect(execArgs[vfIndex + 1]).toContain('drawbox')
  })

  it('throws when ffmpeg.exec returns non-zero exit code', async () => {
    const ffmpeg = createMockFFmpeg({ exec: vi.fn().mockResolvedValue(1) })

    await expect(exportClipWithTracer(ffmpeg as any, baseOptions))
      .rejects.toThrow('FFmpeg export failed with exit code 1')
  })

  it('throws when readFile returns non-Uint8Array', async () => {
    const ffmpeg = createMockFFmpeg({
      readFile: vi.fn().mockResolvedValue('string-instead-of-bytes'),
    })

    await expect(exportClipWithTracer(ffmpeg as any, baseOptions))
      .rejects.toThrow('Unexpected FFmpeg output format')
  })

  it('cleans up input and output files even when exec fails', async () => {
    const ffmpeg = createMockFFmpeg({ exec: vi.fn().mockRejectedValue(new Error('crash')) })

    await expect(exportClipWithTracer(ffmpeg as any, baseOptions)).rejects.toThrow('crash')

    expect(ffmpeg.deleteFile).toHaveBeenCalledWith('input.mp4')
    expect(ffmpeg.deleteFile).toHaveBeenCalledWith('output.mp4')
  })

  it('uses "null" filter when trajectory has fewer than 2 points', async () => {
    const ffmpeg = createMockFFmpeg()

    await exportClipWithTracer(ffmpeg as any, {
      ...baseOptions,
      trajectory: [{ x: 0.5, y: 0.5, timestamp: 0 }],
    })

    const execArgs = ffmpeg.exec.mock.calls[0][0] as string[]
    const vfIndex = execArgs.indexOf('-vf')
    expect(execArgs[vfIndex + 1]).toBe('null')
  })

  it('uses "null" filter when trajectory is empty', async () => {
    const ffmpeg = createMockFFmpeg()

    await exportClipWithTracer(ffmpeg as any, {
      ...baseOptions,
      trajectory: [],
    })

    const execArgs = ffmpeg.exec.mock.calls[0][0] as string[]
    const vfIndex = execArgs.indexOf('-vf')
    expect(execArgs[vfIndex + 1]).toBe('null')
  })

  it('uses custom tracerColor and tracerWidth when provided', async () => {
    const ffmpeg = createMockFFmpeg()

    await exportClipWithTracer(ffmpeg as any, {
      ...baseOptions,
      tracerColor: 'red',
      tracerWidth: 5,
    })

    const execArgs = ffmpeg.exec.mock.calls[0][0] as string[]
    const vfIndex = execArgs.indexOf('-vf')
    const filter = execArgs[vfIndex + 1]
    expect(filter).toContain('color=red')
    expect(filter).toContain('w=5')
    expect(filter).toContain('h=5')
  })
})

describe('exportWithCanvasCompositing', () => {
  it('throws "not yet implemented" error', async () => {
    const blob = new Blob(['test'], { type: 'video/mp4' })

    await expect(exportWithCanvasCompositing(blob, {} as HTMLCanvasElement, 0, 5))
      .rejects.toThrow('Canvas compositing not yet implemented')
  })
})
