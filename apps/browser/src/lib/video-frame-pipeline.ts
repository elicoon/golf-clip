// apps/browser/src/lib/video-frame-pipeline.ts
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile } from '@ffmpeg/util'
import { CanvasCompositor, TracerStyle, TrajectoryPoint } from './canvas-compositor'

export interface ExportProgress {
  phase: 'extracting' | 'compositing' | 'encoding' | 'complete'
  progress: number  // 0-100
  currentFrame?: number
  totalFrames?: number
}

export interface ExportConfig {
  videoBlob: Blob
  trajectory: TrajectoryPoint[]
  startTime: number
  endTime: number
  fps?: number  // Default 30
  quality?: 'draft' | 'preview' | 'final'
  tracerStyle: TracerStyle
  landingPoint?: { x: number; y: number }
  apexPoint?: { x: number; y: number }
  originPoint?: { x: number; y: number }
  onProgress?: (progress: ExportProgress) => void
}

const QUALITY_SETTINGS = {
  draft: { crf: 28, preset: 'ultrafast' },
  preview: { crf: 23, preset: 'fast' },
  final: { crf: 18, preset: 'medium' },
}

export class VideoFramePipeline {
  private ffmpeg: FFmpeg
  private compositor: CanvasCompositor | null = null

  constructor(ffmpeg: FFmpeg) {
    this.ffmpeg = ffmpeg
  }

  /**
   * Calculate total number of frames for a given duration and fps
   */
  calculateFrameCount(duration: number, fps: number): number {
    return Math.ceil(duration * fps)
  }

  async exportWithTracer(config: ExportConfig): Promise<Blob> {
    const {
      videoBlob,
      trajectory,
      startTime,
      endTime,
      fps = 30,
      quality = 'preview',
      tracerStyle,
      landingPoint,
      apexPoint,
      originPoint,
      onProgress,
    } = config

    const duration = endTime - startTime
    const totalFrames = this.calculateFrameCount(duration, fps)

    // Phase 1: Extract frames from video
    onProgress?.({ phase: 'extracting', progress: 0 })

    const inputName = 'input.mp4'
    const framePattern = 'frame_%04d.png'

    await this.ffmpeg.writeFile(inputName, await fetchFile(videoBlob))

    // Set up progress listener for extraction phase
    const extractionProgressHandler = ({ progress }: { progress: number }) => {
      // FFmpeg reports progress as 0-1 ratio
      const percent = Math.round(progress * 100)
      onProgress?.({ phase: 'extracting', progress: Math.min(percent, 99) })
    }
    this.ffmpeg.on('progress', extractionProgressHandler)

    // Extract frames as PNG sequence with error handling
    try {
      await this.ffmpeg.exec([
        '-ss', startTime.toString(),
        '-i', inputName,
        '-t', duration.toString(),
        '-vf', `fps=${fps}`,
        '-f', 'image2',
        framePattern,
      ])
    } catch (error) {
      this.ffmpeg.off('progress', extractionProgressHandler)
      const message = error instanceof Error ? error.message : 'Unknown FFmpeg error'
      console.error('[VideoFramePipeline] Frame extraction failed:', message)
      throw new Error(`Frame extraction failed: ${message}`)
    }

    // Clean up extraction progress listener
    this.ffmpeg.off('progress', extractionProgressHandler)

    // Verify frames were extracted
    try {
      await this.ffmpeg.readFile('frame_0001.png')
    } catch (error) {
      console.error('[VideoFramePipeline] No frames extracted - frame_0001.png not found')
      throw new Error('Frame extraction produced no frames. The video may be corrupted or in an unsupported format.')
    }

    onProgress?.({ phase: 'extracting', progress: 100 })

    // Get video dimensions from first frame
    const firstFrameData = await this.ffmpeg.readFile('frame_0001.png')
    const dimensions = await this.getImageDimensions(firstFrameData as Uint8Array)

    this.compositor = new CanvasCompositor(dimensions.width, dimensions.height)

    // Phase 2: Composite each frame with tracer
    onProgress?.({ phase: 'compositing', progress: 0, currentFrame: 0, totalFrames })

    for (let i = 1; i <= totalFrames; i++) {
      const frameFile = `frame_${i.toString().padStart(4, '0')}.png`
      const frameData = await this.ffmpeg.readFile(frameFile)

      // Decode PNG to ImageBitmap
      const blob = new Blob([new Uint8Array(frameData as Uint8Array)], { type: 'image/png' })
      const bitmap = await createImageBitmap(blob)

      // Calculate current time for this frame
      const frameTime = startTime + (i - 1) / fps

      // Composite with tracer
      const composited = this.compositor.compositeFrame(bitmap as any, {
        trajectory,
        currentTime: frameTime,
        startTime,
        endTime,
        tracerStyle,
        landingPoint,
        apexPoint,
        originPoint,
      })

      // Encode back to PNG
      const compositedBlob = await this.imageDataToBlob(composited)
      await this.ffmpeg.writeFile(frameFile, await fetchFile(compositedBlob))

      bitmap.close()

      onProgress?.({
        phase: 'compositing',
        progress: Math.round((i / totalFrames) * 100),
        currentFrame: i,
        totalFrames,
      })
    }

    // Phase 3: Encode frames back to video
    onProgress?.({ phase: 'encoding', progress: 0 })

    const { crf, preset } = QUALITY_SETTINGS[quality]
    const outputName = 'output.mp4'

    // Set up progress listener for encoding phase
    const encodingProgressHandler = ({ progress }: { progress: number }) => {
      const percent = Math.round(progress * 100)
      onProgress?.({ phase: 'encoding', progress: Math.min(percent, 99) })
    }
    this.ffmpeg.on('progress', encodingProgressHandler)

    // Re-encode with audio from original
    try {
      await this.ffmpeg.exec([
        '-framerate', fps.toString(),
        '-i', framePattern,
        '-ss', startTime.toString(),
        '-t', duration.toString(),
        '-i', inputName,
        '-map', '0:v',
        '-map', '1:a?',
        '-c:v', 'libx264',
        '-crf', crf.toString(),
        '-preset', preset,
        '-c:a', 'aac',
        '-b:a', '192k',
        '-pix_fmt', 'yuv420p',
        '-y',
        outputName,
      ])
    } catch (error) {
      this.ffmpeg.off('progress', encodingProgressHandler)
      const message = error instanceof Error ? error.message : 'Unknown FFmpeg error'
      console.error('[VideoFramePipeline] Video encoding failed:', message)
      throw new Error(`Video encoding failed: ${message}`)
    }

    // Clean up encoding progress listener
    this.ffmpeg.off('progress', encodingProgressHandler)

    onProgress?.({ phase: 'encoding', progress: 100 })

    const result = await this.ffmpeg.readFile(outputName)

    // Cleanup
    await this.cleanup(inputName, outputName, totalFrames)

    onProgress?.({ phase: 'complete', progress: 100 })

    return new Blob([new Uint8Array(result as Uint8Array)], { type: 'video/mp4' })
  }

  private async getImageDimensions(data: Uint8Array): Promise<{ width: number; height: number }> {
    const blob = new Blob([new Uint8Array(data)], { type: 'image/png' })
    const bitmap = await createImageBitmap(blob)
    const dims = { width: bitmap.width, height: bitmap.height }
    bitmap.close()
    return dims
  }

  private async imageDataToBlob(imageData: ImageData): Promise<Blob> {
    const canvas = new OffscreenCanvas(imageData.width, imageData.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Failed to get 2D context from OffscreenCanvas')
    ctx.putImageData(imageData, 0, 0)
    return canvas.convertToBlob({ type: 'image/png' })
  }

  private async cleanup(inputName: string, outputName: string, totalFrames: number): Promise<void> {
    try { await this.ffmpeg.deleteFile(inputName) } catch (e) { console.debug('[VideoFramePipeline] Cleanup failed:', e) }
    try { await this.ffmpeg.deleteFile(outputName) } catch (e) { console.debug('[VideoFramePipeline] Cleanup failed:', e) }
    for (let i = 1; i <= totalFrames; i++) {
      const frameFile = `frame_${i.toString().padStart(4, '0')}.png`
      try { await this.ffmpeg.deleteFile(frameFile) } catch (e) { console.debug('[VideoFramePipeline] Cleanup failed:', e) }
    }
  }
}
