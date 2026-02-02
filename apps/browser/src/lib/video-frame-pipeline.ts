// apps/browser/src/lib/video-frame-pipeline.ts
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile } from '@ffmpeg/util'
import { CanvasCompositor, TracerStyle, TrajectoryPoint } from './canvas-compositor'
// Note: isHevcCodec import removed - HEVC is already detected during upload via
// detectVideoCodec() in VideoDropzone.tsx. The isHevcCodec check was causing hangs
// on large files because it wrote the entire blob to FFmpeg WASM memory.
// See: bug-export-tracer-pipeline-hang.md

/**
 * Error thrown when attempting to export HEVC-encoded video.
 * FFmpeg WASM cannot decode HEVC, so the video must be transcoded first.
 */
export class HevcExportError extends Error {
  constructor(message: string = 'Cannot export HEVC video. The video must be transcoded to H.264 first.') {
    super(message)
    this.name = 'HevcExportError'
  }
}

export interface ExportProgress {
  phase: 'preparing' | 'extracting' | 'compositing' | 'encoding' | 'complete'
  progress: number  // 0-100, or -1 for indeterminate
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
    console.log('[Pipeline] exportWithTracer called')
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

    console.log('[Pipeline] Config:', { startTime, endTime, fps, quality, trajectoryPoints: trajectory.length })

    // Track pipeline start time for overall timeout
    const pipelineStartTime = performance.now()
    const PIPELINE_TIMEOUT_MS = 180000  // 3 minutes total for entire pipeline
    const COMPOSITING_BATCH_SIZE = 10  // Process frames in batches to allow GC

    const duration = endTime - startTime

    // For memory efficiency, cap total frames to prevent WASM memory exhaustion
    // 4K 60fps videos can easily exhaust memory with too many frames
    // Strategy: Try to maintain 30fps, but if clip is long, reduce to 24fps minimum
    // If still too many frames at 24fps, we'll downscale to 1080p during extraction
    const MAX_FRAMES_AT_30FPS = 450  // 15 seconds at 30fps
    const MIN_FPS = 24  // Cinematic minimum

    let effectiveFps = fps
    let scaleFilter = ''  // Will be set if we need to downscale

    const rawFrameCount = this.calculateFrameCount(duration, fps)

    if (rawFrameCount > MAX_FRAMES_AT_30FPS) {
      // First try: reduce fps to 24
      effectiveFps = Math.floor(MAX_FRAMES_AT_30FPS / duration)
      effectiveFps = Math.max(effectiveFps, MIN_FPS)

      const framesAt24 = this.calculateFrameCount(duration, effectiveFps)

      if (framesAt24 > MAX_FRAMES_AT_30FPS) {
        // Still too many frames even at 24fps - downscale to 1080p to reduce memory
        // This happens for clips longer than ~18 seconds
        scaleFilter = ',scale=1920:1080:force_original_aspect_ratio=decrease'
        console.warn(`[Pipeline] Long clip (${duration.toFixed(1)}s) - downscaling to 1080p and using ${effectiveFps}fps`)
      } else {
        console.warn(`[Pipeline] Reducing fps from ${fps} to ${effectiveFps} to stay under frame limit`)
      }
    }

    const totalFrames = this.calculateFrameCount(duration, effectiveFps)
    console.log('[Pipeline] Duration:', duration, 'Total frames:', totalFrames, 'Effective fps:', effectiveFps, scaleFilter ? '(downscaled to 1080p)' : '')

    // Note: HEVC check removed - it was causing hangs on large files because it wrote
    // the entire blob to FFmpeg WASM memory. HEVC is already detected during upload
    // via detectVideoCodec() in VideoDropzone.tsx. If an HEVC file somehow reaches
    // here, the frame extraction will fail and trigger the HevcExportError handling.

    // Phase 0: Prepare video data (can be slow for large files)
    const inputName = 'input.mp4'
    const framePattern = 'frame_%04d.png'
    const blobSizeMB = (videoBlob.size / (1024 * 1024)).toFixed(1)

    console.log(`[Pipeline] Preparing video data (${blobSizeMB}MB)...`)
    onProgress?.({ phase: 'preparing', progress: -1 })

    // For large blobs (>50MB), force 1080p downscale to prevent memory exhaustion
    // 4K frames create ~70MB active memory each, causing GC churn and hangs
    // See: docs/bugs/bug-export-tracer-pipeline-hang.md
    if (videoBlob.size > 50 * 1024 * 1024) {
      if (!scaleFilter) {  // Don't override if already set by frame count limiting
        scaleFilter = ',scale=1920:1080:force_original_aspect_ratio=decrease'
        console.warn(`[Pipeline] Large blob detected (${blobSizeMB}MB) - forcing 1080p downscale to prevent memory exhaustion`)
      } else {
        console.warn(`[Pipeline] Large blob detected (${blobSizeMB}MB) - downscale already active`)
      }
    }

    // Convert blob to Uint8Array with timing
    const fetchStart = performance.now()
    const videoData = await fetchFile(videoBlob)
    const fetchTime = ((performance.now() - fetchStart) / 1000).toFixed(1)
    console.log(`[Pipeline] Blob converted to Uint8Array in ${fetchTime}s`)
    onProgress?.({ phase: 'preparing', progress: 50 })

    // Write to FFmpeg filesystem with timing
    const writeStart = performance.now()
    await this.ffmpeg.writeFile(inputName, videoData)
    const writeTime = ((performance.now() - writeStart) / 1000).toFixed(1)
    console.log(`[Pipeline] Video written to FFmpeg in ${writeTime}s`)
    onProgress?.({ phase: 'preparing', progress: 100 })

    // Phase 1: Extract frames from video
    // NOTE: FFmpeg.wasm doesn't reliably emit progress events for image2 format.
    // We report -1 (indeterminate) initially, with periodic fallback updates.
    console.log('[Pipeline] Phase 1: Extracting frames')
    onProgress?.({ phase: 'extracting', progress: -1 })

    // Set up log listener to capture FFmpeg stderr for diagnostics
    let ffmpegLogs = ''
    const logHandler = ({ message }: { message: string }) => {
      ffmpegLogs += message + '\n'
    }
    this.ffmpeg.on('log', logHandler)

    // Set up fallback progress updates every second during extraction
    // This prevents the UI from appearing stuck if FFmpeg doesn't emit events
    let lastReportedProgress = -1
    const fallbackInterval = setInterval(() => {
      // Increment progress slowly to show activity (caps at 90%)
      if (lastReportedProgress === -1) {
        lastReportedProgress = 10
      } else if (lastReportedProgress < 90) {
        lastReportedProgress = Math.min(lastReportedProgress + 10, 90)
      }
      onProgress?.({ phase: 'extracting', progress: lastReportedProgress })
    }, 1000)

    // Extract frames as PNG sequence with error handling
    // Add timeout to prevent indefinite hangs (2 minutes should be enough for most segments)
    const EXTRACTION_TIMEOUT_MS = 120000
    console.log(`[Pipeline] Starting frame extraction (timeout: ${EXTRACTION_TIMEOUT_MS / 1000}s)...`)

    try {
      // Build the video filter - fps is required, scale is optional for long clips
      const vfFilter = `fps=${effectiveFps}${scaleFilter}`

      const execPromise = this.ffmpeg.exec([
        '-ss', startTime.toString(),
        '-i', inputName,
        '-t', duration.toString(),
        '-vf', vfFilter,
        '-f', 'image2',
        framePattern,
      ])

      const timeoutPromise = new Promise<number>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Frame extraction timed out after ${EXTRACTION_TIMEOUT_MS / 1000} seconds. The video may be too large or in an unsupported format.`))
        }, EXTRACTION_TIMEOUT_MS)
      })

      const exitCode = await Promise.race([execPromise, timeoutPromise])

      if (exitCode !== 0) {
        // Log FFmpeg output for debugging
        if (ffmpegLogs) {
          console.error('[VideoFramePipeline] FFmpeg logs:\n', ffmpegLogs)
        }
        throw new Error(`FFmpeg frame extraction failed with exit code ${exitCode}`)
      }
    } catch (error) {
      clearInterval(fallbackInterval)
      this.ffmpeg.off('log', logHandler)
      const message = error instanceof Error ? error.message : 'Unknown FFmpeg error'
      console.error('[VideoFramePipeline] Frame extraction failed:', message)
      if (ffmpegLogs) {
        console.error('[VideoFramePipeline] FFmpeg logs:\n', ffmpegLogs)
      }
      throw new Error(`Frame extraction failed: ${message}`)
    }

    // Clean up fallback interval and log listener
    clearInterval(fallbackInterval)
    this.ffmpeg.off('log', logHandler)

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

    // Phase 2: Composite each frame with tracer in batches
    // Processing in batches allows GC to reclaim memory between batches
    onProgress?.({ phase: 'compositing', progress: 0, currentFrame: 0, totalFrames })

    for (let i = 1; i <= totalFrames; i++) {
      // Check for overall pipeline timeout
      const elapsed = performance.now() - pipelineStartTime
      if (elapsed > PIPELINE_TIMEOUT_MS) {
        throw new Error(`Export pipeline timed out after ${Math.round(elapsed / 1000)} seconds during compositing (frame ${i}/${totalFrames})`)
      }

      const frameFile = `frame_${i.toString().padStart(4, '0')}.png`
      const frameData = await this.ffmpeg.readFile(frameFile)

      // Decode PNG to ImageBitmap
      const blob = new Blob([new Uint8Array(frameData as Uint8Array)], { type: 'image/png' })
      const bitmap = await createImageBitmap(blob)

      // Calculate current time for this frame
      const frameTime = startTime + (i - 1) / effectiveFps

      // Composite with tracer
      const composited = this.compositor!.compositeFrame(bitmap as any, {
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

      // Update progress every 10 frames to reduce callback overhead
      if (i % 10 === 0 || i === totalFrames) {
        onProgress?.({
          phase: 'compositing',
          progress: Math.round((i / totalFrames) * 100),
          currentFrame: i,
          totalFrames,
        })
      }

      // Every batch, yield to event loop and allow GC
      // This prevents memory from building up indefinitely
      if (i % COMPOSITING_BATCH_SIZE === 0) {
        await new Promise(resolve => setTimeout(resolve, 0))
      }
    }

    // Phase 3: Encode frames back to video
    onProgress?.({ phase: 'encoding', progress: 0 })

    const { crf, preset } = QUALITY_SETTINGS[quality]
    const outputName = 'output.mp4'

    // Set up progress listener for encoding phase
    const encodingProgressHandler = ({ progress }: { progress: number }) => {
      const percent = Math.round(progress * 100)
      // Allow up to 99% from FFmpeg - we'll report 100% explicitly after exec completes
      onProgress?.({ phase: 'encoding', progress: Math.min(percent, 99) })
    }
    this.ffmpeg.on('progress', encodingProgressHandler)

    // Re-encode with audio from original
    try {
      const exitCode = await this.ffmpeg.exec([
        '-framerate', effectiveFps.toString(),
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
      if (exitCode !== 0) {
        throw new Error(`FFmpeg video encoding failed with exit code ${exitCode}`)
      }
    } catch (error) {
      this.ffmpeg.off('progress', encodingProgressHandler)
      const message = error instanceof Error ? error.message : 'Unknown FFmpeg error'
      console.error('[VideoFramePipeline] Video encoding failed:', message)
      throw new Error(`Video encoding failed: ${message}`)
    }

    // Clean up encoding progress listener
    this.ffmpeg.off('progress', encodingProgressHandler)

    // Explicitly report 100% for encoding phase BEFORE reading result
    onProgress?.({ phase: 'encoding', progress: 100 })

    const result = await this.ffmpeg.readFile(outputName)

    // Report completion BEFORE cleanup to avoid 99% hang
    onProgress?.({ phase: 'complete', progress: 100 })

    // Cleanup (non-blocking for user perception)
    await this.cleanup(inputName, outputName, totalFrames)

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
