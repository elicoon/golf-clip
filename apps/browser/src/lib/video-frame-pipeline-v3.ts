// apps/browser/src/lib/video-frame-pipeline-v3.ts
/**
 * V3 Export Pipeline using WebCodecs + Canvas compositing.
 *
 * This approach leverages the browser's hardware-accelerated video decoder
 * and encoder via WebCodecs API, with canvas-based tracer compositing.
 *
 * Flow:
 * 1. Decode source video frames using VideoDecoder (hardware accelerated)
 * 2. Draw each frame to canvas + composite tracer overlay
 * 3. Encode composited frames using VideoEncoder (hardware accelerated)
 * 4. Mux to MP4 using mp4-muxer
 *
 * This should be much faster than FFmpeg WASM since it uses native browser
 * codecs and GPU acceleration where available.
 */

import { Muxer, ArrayBufferTarget } from 'mp4-muxer'
import { TrajectoryPoint } from './canvas-compositor'
import { TracerStyle, DEFAULT_TRACER_STYLE } from '../types/tracer'

export interface ExportProgressV3 {
  phase: 'preparing' | 'extracting' | 'encoding' | 'muxing' | 'complete'
  progress: number // 0-100
  currentFrame?: number
  totalFrames?: number
}

export type ExportResolution = 'original' | '1080p' | '720p'

export interface ExportConfigV3 {
  videoBlob: Blob
  trajectory: TrajectoryPoint[]
  startTime: number
  endTime: number
  tracerStyle?: TracerStyle
  onProgress?: (progress: ExportProgressV3) => void
  /** Output resolution - downscales if source is larger */
  resolution?: ExportResolution
}

/**
 * Draw tracer on canvas up to the given timestamp
 */
function drawTracer(
  ctx: CanvasRenderingContext2D,
  trajectory: TrajectoryPoint[],
  currentTime: number,
  width: number,
  height: number,
  style: TracerStyle
): void {
  if (trajectory.length < 2) return

  // Sort by timestamp
  const sorted = [...trajectory].sort((a, b) => a.timestamp - b.timestamp)

  // Find visible points (timestamp <= currentTime)
  const visiblePoints = sorted.filter(p => p.timestamp <= currentTime)
  if (visiblePoints.length < 2) return

  ctx.save()

  // Draw glow layer
  ctx.strokeStyle = style.glowColor || style.color
  ctx.lineWidth = (style.lineWidth || 4) + (style.glowRadius || 8)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.globalAlpha = 0.4

  ctx.beginPath()
  ctx.moveTo(visiblePoints[0].x * width, visiblePoints[0].y * height)
  for (let i = 1; i < visiblePoints.length; i++) {
    ctx.lineTo(visiblePoints[i].x * width, visiblePoints[i].y * height)
  }
  ctx.stroke()

  // Draw main line
  ctx.strokeStyle = style.color || '#ff0000'
  ctx.lineWidth = style.lineWidth || 4
  ctx.globalAlpha = 1.0

  ctx.beginPath()
  ctx.moveTo(visiblePoints[0].x * width, visiblePoints[0].y * height)
  for (let i = 1; i < visiblePoints.length; i++) {
    ctx.lineTo(visiblePoints[i].x * width, visiblePoints[i].y * height)
  }
  ctx.stroke()

  ctx.restore()
}

/**
 * V3 Export Pipeline using WebCodecs API
 */
export class VideoFramePipelineV3 {
  async exportWithTracer(config: ExportConfigV3): Promise<Blob> {
    const {
      videoBlob,
      trajectory,
      startTime,
      endTime,
      tracerStyle = DEFAULT_TRACER_STYLE,
      onProgress,
      resolution = 'original',
    } = config

    const duration = endTime - startTime

    console.log('[PipelineV3] Starting WebCodecs export', {
      blobSizeMB: (videoBlob.size / (1024 * 1024)).toFixed(1),
      duration: duration.toFixed(2),
      trajectoryPoints: trajectory.length,
      resolution,
    })

    const startMs = performance.now()

    // Phase 1: Create video element and wait for metadata
    onProgress?.({ phase: 'preparing', progress: 0 })

    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.src = URL.createObjectURL(videoBlob)

    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve()
      video.onerror = () => reject(new Error('Failed to load video'))
    })

    const sourceWidth = video.videoWidth
    const sourceHeight = video.videoHeight

    // Calculate output dimensions based on resolution setting
    let width = sourceWidth
    let height = sourceHeight

    if (resolution !== 'original') {
      const maxHeight = resolution === '1080p' ? 1080 : 720
      if (sourceHeight > maxHeight) {
        const scale = maxHeight / sourceHeight
        width = Math.round(sourceWidth * scale)
        height = maxHeight
        // Ensure even dimensions (required for H.264)
        width = width % 2 === 0 ? width : width + 1
        height = height % 2 === 0 ? height : height + 1
      }
    }

    console.log('[PipelineV3] Resolution:', sourceWidth, 'x', sourceHeight, '->', width, 'x', height)
    const fps = 30 // Assume 30fps for now, could detect from video
    const totalFrames = Math.ceil(duration * fps)

    console.log('[PipelineV3] Video loaded:', { width, height, fps, totalFrames })

    // Create canvas for compositing
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')!

    // Phase 2: Set up MP4 muxer
    onProgress?.({ phase: 'preparing', progress: 50 })

    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: {
        codec: 'avc',
        width,
        height,
      },
      fastStart: 'in-memory',
    })

    // Phase 3: Set up VideoEncoder
    const encoder = new VideoEncoder({
      output: (chunk, meta) => {
        muxer.addVideoChunk(chunk, meta)
      },
      error: (e) => {
        console.error('[PipelineV3] Encoder error:', e)
      },
    })

    // Determine appropriate AVC level based on resolution
    // Level 4.0 (0x28) supports up to 2048x1024 or 1920x1088 (8,355,840 macroblocks/sec)
    // Level 5.1 (0x33) supports up to 4096x2160 (4K)
    const pixels = width * height
    let codecLevel: string
    if (pixels <= 921600) {
      codecLevel = 'avc1.42001f' // Level 3.1 - up to 1280x720
    } else if (pixels <= 2088960) {
      codecLevel = 'avc1.640028' // Level 4.0 High - up to 1920x1080
    } else {
      codecLevel = 'avc1.640033' // Level 5.1 High - up to 4096x2160
    }

    console.log('[PipelineV3] Using codec:', codecLevel, 'for', width, 'x', height)

    encoder.configure({
      codec: codecLevel,
      width,
      height,
      bitrate: 8_000_000, // 8 Mbps for good quality
      bitrateMode: 'variable',
    })

    onProgress?.({ phase: 'encoding', progress: 0, currentFrame: 0, totalFrames })

    // Phase 4: Extract frames, composite, encode
    video.currentTime = startTime

    // Helper to seek and wait
    const seekTo = (time: number): Promise<void> => {
      return new Promise((resolve) => {
        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked)
          resolve()
        }
        video.addEventListener('seeked', onSeeked)
        video.currentTime = time
      })
    }

    for (let frameNum = 0; frameNum < totalFrames; frameNum++) {
      // Check encoder state before encoding
      if (encoder.state === 'closed') {
        throw new Error('Encoder was closed unexpectedly')
      }

      const frameTime = startTime + (frameNum / fps)

      // Seek to frame time
      await seekTo(frameTime)

      // Draw video frame to canvas (scale from source to output dimensions)
      ctx.drawImage(video, 0, 0, sourceWidth, sourceHeight, 0, 0, width, height)

      // Draw tracer overlay
      const relativeTime = frameTime - startTime
      const trajectoryTime = trajectory.length > 0
        ? relativeTime + trajectory[0].timestamp
        : relativeTime
      drawTracer(ctx, trajectory, trajectoryTime, width, height, tracerStyle)

      // Create VideoFrame and encode
      const frame = new VideoFrame(canvas, {
        timestamp: (frameNum * 1_000_000) / fps, // microseconds
      })

      encoder.encode(frame, { keyFrame: frameNum % 30 === 0 })
      frame.close()

      // Progress update
      const progress = Math.round((frameNum / totalFrames) * 100)
      onProgress?.({ phase: 'encoding', progress, currentFrame: frameNum, totalFrames })
    }

    // Flush encoder
    onProgress?.({ phase: 'muxing', progress: 0 })
    await encoder.flush()
    encoder.close()

    // Finalize muxer
    muxer.finalize()

    // Get result
    const { buffer } = muxer.target as ArrayBufferTarget
    const resultBlob = new Blob([buffer], { type: 'video/mp4' })

    // Cleanup
    URL.revokeObjectURL(video.src)

    onProgress?.({ phase: 'complete', progress: 100 })

    const elapsedMs = performance.now() - startMs
    console.log('[PipelineV3] Export complete in', (elapsedMs / 1000).toFixed(1), 'seconds')

    return resultBlob
  }
}
