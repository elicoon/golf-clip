// apps/browser/src/lib/video-frame-pipeline-v4.ts
/**
 * V4 Export Pipeline using requestVideoFrameCallback() for real-time frame capture.
 *
 * Key insight: V3 is slow because it seeks to each frame individually (300-500ms per seek).
 * V4 plays the video at 1x speed and captures frames as they decode.
 *
 * Flow:
 * 1. Seek to startTime
 * 2. Play the video
 * 3. Use requestVideoFrameCallback() to capture each frame as it plays
 * 4. For each frame: draw to canvas, composite tracer, encode with VideoEncoder
 * 5. Stop when we reach endTime
 * 6. Finalize muxer
 *
 * Export time should be approximately equal to clip duration (1x realtime).
 */

import { Muxer, ArrayBufferTarget } from 'mp4-muxer'
import { TrajectoryPoint } from './canvas-compositor'
import { TracerStyle, DEFAULT_TRACER_STYLE } from '../types/tracer'

export interface ExportProgressV4 {
  phase: 'preparing' | 'extracting' | 'encoding' | 'muxing' | 'complete'
  progress: number // 0-100
  currentFrame?: number
  totalFrames?: number
  currentTime?: number
  endTime?: number
}

export type ExportResolution = 'original' | '1080p' | '720p'

export interface ExportConfigV4 {
  videoBlob: Blob
  trajectory: TrajectoryPoint[]
  startTime: number
  endTime: number
  tracerStyle?: TracerStyle
  onProgress?: (progress: ExportProgressV4) => void
  /** Output resolution - downscales if source is larger */
  resolution?: ExportResolution
}

/**
 * Draw tracer on canvas up to the given timestamp
 * (Copied from V3 for consistency)
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
 * Check if requestVideoFrameCallback is supported
 */
export function isVideoFrameCallbackSupported(): boolean {
  return typeof HTMLVideoElement !== 'undefined' &&
    'requestVideoFrameCallback' in HTMLVideoElement.prototype
}

/**
 * V4 Export Pipeline using requestVideoFrameCallback for real-time capture
 */
export class VideoFramePipelineV4 {
  async exportWithTracer(config: ExportConfigV4): Promise<Blob> {
    const {
      videoBlob,
      trajectory,
      startTime,
      endTime,
      tracerStyle = DEFAULT_TRACER_STYLE,
      onProgress,
      resolution = 'original',
    } = config

    if (!isVideoFrameCallbackSupported()) {
      throw new Error('requestVideoFrameCallback is not supported in this browser. Use V3 pipeline instead.')
    }

    const duration = endTime - startTime

    console.log('[PipelineV4] Starting real-time capture export', {
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
    video.preload = 'auto'
    video.crossOrigin = 'anonymous'
    // IMPORTANT: Append video to DOM to prevent requestVideoFrameCallback throttling
    // Chrome throttles rVFC to ~1fps for detached/invisible video elements
    video.style.position = 'fixed'
    video.style.top = '-9999px'
    video.style.left = '-9999px'
    video.style.width = '1px'
    video.style.height = '1px'
    video.style.opacity = '0.01' // Not fully invisible to avoid throttling
    document.body.appendChild(video)
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

    console.log('[PipelineV4] Resolution:', sourceWidth, 'x', sourceHeight, '->', width, 'x', height)

    // Estimate fps from video (default to 30 if not available)
    // We'll use the actual frame timestamps from requestVideoFrameCallback
    const estimatedFps = 30
    const estimatedTotalFrames = Math.ceil(duration * estimatedFps)

    console.log('[PipelineV4] Video loaded:', { width, height, estimatedFps, estimatedTotalFrames })

    // Create canvas for compositing
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!

    // Draw a frame immediately to initialize the canvas context
    ctx.fillStyle = 'black'
    ctx.fillRect(0, 0, width, height)

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
      firstTimestampBehavior: 'offset', // Auto-offset timestamps so first is 0
    })

    // Phase 3: Set up VideoEncoder
    const encoder = new VideoEncoder({
      output: (chunk, meta) => {
        muxer.addVideoChunk(chunk, meta)
      },
      error: (e) => {
        console.error('[PipelineV4] Encoder error:', e)
      },
    })

    // Determine appropriate AVC level based on resolution
    const pixels = width * height
    let codecLevel: string
    if (pixels <= 921600) {
      codecLevel = 'avc1.42001f' // Level 3.1 - up to 1280x720
    } else if (pixels <= 2088960) {
      codecLevel = 'avc1.640028' // Level 4.0 High - up to 1920x1080
    } else {
      codecLevel = 'avc1.640033' // Level 5.1 High - up to 4096x2160
    }

    console.log('[PipelineV4] Using codec:', codecLevel, 'for', width, 'x', height)

    encoder.configure({
      codec: codecLevel,
      width,
      height,
      bitrate: 8_000_000, // 8 Mbps for good quality
      bitrateMode: 'variable',
    })

    onProgress?.({ phase: 'encoding', progress: 0, currentFrame: 0, totalFrames: estimatedTotalFrames })

    // Phase 4: Seek to start time
    await new Promise<void>((resolve) => {
      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked)
        resolve()
      }
      video.addEventListener('seeked', onSeeked)
      video.currentTime = startTime
    })

    // Phase 5: Play video and capture frames using requestVideoFrameCallback
    // IMPORTANT: Capture raw frames first (fast), then encode after (slow)
    // This prevents frame drops during real-time playback
    let lastFrameTime = -1

    // Use a separate capture canvas at OUTPUT resolution (smaller = faster capture)
    const captureCanvas = document.createElement('canvas')
    captureCanvas.width = width
    captureCanvas.height = height
    const captureCtx = captureCanvas.getContext('2d')!

    const capturedBitmaps: { bitmap: ImageBitmap; timeUs: number }[] = []

    onProgress?.({ phase: 'extracting', progress: 0 })

    // DIAGNOSTIC: Track callback timing to understand frame drops
    let callbackCount = 0
    let skippedBeforeStart = 0
    let skippedDuplicate = 0
    let captureStartTime = 0
    const callbackIntervals: number[] = []
    let lastCallbackTime = 0

    // First pass: capture all frames as ImageBitmaps during playback
    await new Promise<void>((resolve, reject) => {
      let callbackId: number | null = null
      let isCapturing = true

      const captureFrame = async (now: DOMHighResTimeStamp, metadata: VideoFrameCallbackMetadata) => {
        if (!isCapturing) return

        // DIAGNOSTIC: Track callback frequency
        callbackCount++
        if (callbackCount === 1) {
          captureStartTime = now
        }
        if (lastCallbackTime > 0) {
          callbackIntervals.push(now - lastCallbackTime)
        }
        lastCallbackTime = now

        const currentVideoTime = video.currentTime

        // Check if we've reached the end
        if (currentVideoTime >= endTime) {
          isCapturing = false
          // DIAGNOSTIC: Log capture statistics
          const avgInterval = callbackIntervals.length > 0
            ? callbackIntervals.reduce((a, b) => a + b, 0) / callbackIntervals.length
            : 0
          const maxInterval = callbackIntervals.length > 0 ? Math.max(...callbackIntervals) : 0
          const minInterval = callbackIntervals.length > 0 ? Math.min(...callbackIntervals) : 0
          console.log('[PipelineV4] DIAGNOSTIC - Callback stats:', {
            totalCallbacks: callbackCount,
            skippedBeforeStart,
            skippedDuplicate,
            capturedFrames: capturedBitmaps.length,
            avgIntervalMs: avgInterval.toFixed(2),
            minIntervalMs: minInterval.toFixed(2),
            maxIntervalMs: maxInterval.toFixed(2),
            expectedFps: 1000 / avgInterval,
            totalCaptureTimeMs: (now - captureStartTime).toFixed(0),
            videoPlaybackRate: video.playbackRate,
          })
          resolve()
          return
        }

        // Skip if we're before start time (can happen during initial seek)
        if (currentVideoTime < startTime - 0.1) {
          skippedBeforeStart++
          callbackId = video.requestVideoFrameCallback(captureFrame)
          return
        }

        // Avoid duplicate frames (same presentation time)
        const presentationTime = metadata.mediaTime
        if (presentationTime === lastFrameTime) {
          skippedDuplicate++
          callbackId = video.requestVideoFrameCallback(captureFrame)
          return
        }
        lastFrameTime = presentationTime

        try {
          // Draw video to capture canvas (at output resolution - scales down 4K to 1080p)
          captureCtx.drawImage(video, 0, 0, width, height)

          // IMPORTANT: Request next frame BEFORE any async work to avoid frame drops
          // This ensures we don't miss frames while waiting for createImageBitmap
          callbackId = video.requestVideoFrameCallback(captureFrame)

          // Then create ImageBitmap from the canvas (fast, but still async)
          const bitmap = await createImageBitmap(captureCanvas)
          const relativeTimeUs = Math.round((currentVideoTime - startTime) * 1_000_000)

          // Debug: log first bitmap dimensions
          if (capturedBitmaps.length === 0) {
            console.log('[PipelineV4] First bitmap captured:', bitmap.width, 'x', bitmap.height)
          }

          capturedBitmaps.push({ bitmap, timeUs: relativeTimeUs })

          // Progress update
          const timeProgress = (currentVideoTime - startTime) / duration
          const progress = Math.min(99, Math.round(timeProgress * 100))
          onProgress?.({
            phase: 'extracting',
            progress,
            currentFrame: capturedBitmaps.length,
            totalFrames: estimatedTotalFrames,
            currentTime: currentVideoTime,
            endTime,
          })
        } catch (error) {
          isCapturing = false
          reject(error)
        }
      }

      // Handle video ending naturally
      video.addEventListener('ended', () => {
        if (isCapturing) {
          isCapturing = false
          resolve()
        }
      })

      // Handle errors
      video.addEventListener('error', () => {
        isCapturing = false
        reject(new Error('Video playback error during capture'))
      })

      // Start the callback chain
      callbackId = video.requestVideoFrameCallback(captureFrame)

      // Start playback at normal speed
      video.play().catch((err) => {
        isCapturing = false
        if (callbackId !== null) {
          video.cancelVideoFrameCallback(callbackId)
        }
        reject(new Error('Failed to start video playback: ' + err.message))
      })
    })

    console.log('[PipelineV4] Captured', capturedBitmaps.length, 'frames, now encoding...')
    video.pause()

    // Second pass: encode all captured frames
    onProgress?.({ phase: 'encoding', progress: 0 })

    for (let i = 0; i < capturedBitmaps.length; i++) {
      const { bitmap, timeUs } = capturedBitmaps[i]

      // Draw bitmap to canvas (bitmap is already at output resolution)
      ctx.drawImage(bitmap, 0, 0)
      bitmap.close()

      // Draw tracer overlay
      const relativeTime = timeUs / 1_000_000
      const trajectoryTime = trajectory.length > 0
        ? relativeTime + trajectory[0].timestamp
        : relativeTime
      drawTracer(ctx, trajectory, trajectoryTime, width, height, tracerStyle)

      // Create VideoFrame and encode
      const frame = new VideoFrame(canvas, {
        timestamp: timeUs,
      })

      // Keyframe every 30 frames
      encoder.encode(frame, { keyFrame: i % 30 === 0 })
      frame.close()

      // Progress update
      if (i % 10 === 0) {
        const progress = Math.round((i / capturedBitmaps.length) * 100)
        onProgress?.({ phase: 'encoding', progress, currentFrame: i, totalFrames: capturedBitmaps.length })
      }
    }

    // Finalize
    console.log('[PipelineV4] Encoded', capturedBitmaps.length, 'frames')
    onProgress?.({ phase: 'muxing', progress: 0 })
    await encoder.flush()
    encoder.close()

    muxer.finalize()

    const { buffer } = muxer.target as ArrayBufferTarget
    const resultBlob = new Blob([buffer], { type: 'video/mp4' })

    URL.revokeObjectURL(video.src)
    // Clean up: remove video element from DOM
    video.remove()

    onProgress?.({ phase: 'complete', progress: 100 })

    const elapsedMs = performance.now() - startMs
    const actualFps = capturedBitmaps.length / duration
    console.log('[PipelineV4] Export complete in', (elapsedMs / 1000).toFixed(1), 'seconds')
    console.log('[PipelineV4] Captured', capturedBitmaps.length, 'frames at', actualFps.toFixed(1), 'fps effective')
    console.log('[PipelineV4] Export speed:', (duration / (elapsedMs / 1000)).toFixed(2) + 'x realtime')

    return resultBlob
  }
}
