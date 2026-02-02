// apps/browser/src/lib/video-frame-pipeline-v2.ts
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile } from '@ffmpeg/util'
import { TrajectoryPoint } from './canvas-compositor'
import { TracerStyle } from '../types/tracer'
import { trajectoryToFFmpegFilter } from './trajectory-to-ffmpeg-filter'

export interface ExportProgressV2 {
  phase: 'preparing' | 'probing' | 'encoding' | 'complete'
  progress: number  // 0-100, or -1 for indeterminate
}

export interface ExportConfigV2 {
  videoBlob: Blob
  trajectory: TrajectoryPoint[]
  startTime: number
  endTime: number
  quality?: 'draft' | 'preview' | 'final'
  tracerStyle?: TracerStyle  // Not used in POC, kept for interface compat
  onProgress?: (progress: ExportProgressV2) => void
}

const QUALITY_SETTINGS = {
  draft: { crf: 28, preset: 'ultrafast' },
  preview: { crf: 23, preset: 'fast' },
  final: { crf: 18, preset: 'medium' },
}

/**
 * V2 Export Pipeline using FFmpeg drawline filter instead of frame extraction.
 *
 * This approach is a POC to fix the 4K export hang issue. Instead of:
 * 1. Extract all frames as PNG
 * 2. Composite tracer on each frame in JS
 * 3. Re-encode frames to video
 *
 * We now do:
 * 1. Generate FFmpeg drawline filter from trajectory
 * 2. Single FFmpeg pass: trim + filter + encode
 *
 * This should reduce 4K export from "hangs indefinitely" to <30 seconds.
 */
export class VideoFramePipelineV2 {
  private ffmpeg: FFmpeg

  constructor(ffmpeg: FFmpeg) {
    this.ffmpeg = ffmpeg
  }

  async exportWithTracer(config: ExportConfigV2): Promise<Blob> {
    const {
      videoBlob,
      trajectory,
      startTime,
      endTime,
      quality = 'preview',
      onProgress,
    } = config

    const duration = endTime - startTime
    const inputName = 'input.mp4'
    const outputName = 'output.mp4'
    const probeName = 'probe.png'

    console.log('[PipelineV2] Starting export', {
      blobSizeMB: (videoBlob.size / (1024 * 1024)).toFixed(1),
      duration: duration.toFixed(2),
      trajectoryPoints: trajectory.length,
    })

    const startMs = performance.now()

    // Phase 1: Write video to FFmpeg filesystem
    onProgress?.({ phase: 'preparing', progress: -1 })
    console.log('[PipelineV2] Phase 1: Writing video to FFmpeg...')

    const videoData = await fetchFile(videoBlob)
    await this.ffmpeg.writeFile(inputName, videoData)

    onProgress?.({ phase: 'preparing', progress: 100 })
    console.log('[PipelineV2] Video written to FFmpeg filesystem')

    // Phase 2: Probe video dimensions (extract single frame)
    onProgress?.({ phase: 'probing', progress: -1 })
    console.log('[PipelineV2] Phase 2: Probing video dimensions...')

    const dimensions = await this.getVideoDimensions(inputName, probeName)
    console.log('[PipelineV2] Video dimensions:', dimensions)

    onProgress?.({ phase: 'probing', progress: 100 })

    // Phase 3: Generate filter string and encode
    onProgress?.({ phase: 'encoding', progress: 0 })
    console.log('[PipelineV2] Phase 3: Encoding with tracer filter...')

    const tracerFilter = trajectoryToFFmpegFilter(
      trajectory,
      dimensions.width,
      dimensions.height,
      startTime
    )

    // If no trajectory, use 'null' filter (passthrough)
    const vfFilter = tracerFilter || 'null'
    console.log('[PipelineV2] Filter string length:', vfFilter.length, 'chars')

    const { crf, preset } = QUALITY_SETTINGS[quality]

    // Set up progress listener
    const progressHandler = ({ progress }: { progress: number }) => {
      const percent = Math.round(progress * 100)
      onProgress?.({ phase: 'encoding', progress: Math.min(percent, 99) })
    }
    this.ffmpeg.on('progress', progressHandler)

    try {
      const exitCode = await this.ffmpeg.exec([
        '-ss', startTime.toString(),
        '-i', inputName,
        '-t', duration.toString(),
        '-vf', vfFilter,
        '-c:v', 'libx264',
        '-crf', crf.toString(),
        '-preset', preset,
        '-c:a', 'aac',
        '-b:a', '192k',
        '-y',
        outputName,
      ])

      if (exitCode !== 0) {
        throw new Error(`FFmpeg encoding failed with exit code ${exitCode}`)
      }
    } finally {
      this.ffmpeg.off('progress', progressHandler)
    }

    onProgress?.({ phase: 'encoding', progress: 100 })

    // Read result
    const result = await this.ffmpeg.readFile(outputName)

    onProgress?.({ phase: 'complete', progress: 100 })

    const elapsedMs = performance.now() - startMs
    console.log('[PipelineV2] Export complete in', (elapsedMs / 1000).toFixed(1), 'seconds')

    // Cleanup
    try { await this.ffmpeg.deleteFile(inputName) } catch { /* ignore */ }
    try { await this.ffmpeg.deleteFile(outputName) } catch { /* ignore */ }

    return new Blob([new Uint8Array(result as Uint8Array)], { type: 'video/mp4' })
  }

  /**
   * Get video dimensions by extracting a single frame
   */
  private async getVideoDimensions(
    inputName: string,
    probeName: string
  ): Promise<{ width: number; height: number }> {
    // Extract single frame at start
    await this.ffmpeg.exec([
      '-i', inputName,
      '-vframes', '1',
      '-f', 'image2',
      probeName,
    ])

    const frameData = await this.ffmpeg.readFile(probeName)
    const blob = new Blob([new Uint8Array(frameData as Uint8Array)], { type: 'image/png' })
    const bitmap = await createImageBitmap(blob)
    const dims = { width: bitmap.width, height: bitmap.height }
    bitmap.close()

    // Cleanup probe frame
    try { await this.ffmpeg.deleteFile(probeName) } catch { /* ignore */ }

    return dims
  }
}
