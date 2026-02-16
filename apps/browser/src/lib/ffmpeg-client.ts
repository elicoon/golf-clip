import { FFmpeg } from '@ffmpeg/ffmpeg'
import { toBlobURL, fetchFile } from '@ffmpeg/util'

let ffmpeg: FFmpeg | null = null
let loaded = false

export async function loadFFmpeg(): Promise<void> {
  if (loaded) return

  ffmpeg = new FFmpeg()

  // Note: Using @ffmpeg/core@0.12.6 from CDN for stability.
  // package.json has @ffmpeg/ffmpeg@0.12.10 (the wrapper), which is compatible
  // with core 0.12.x. The core WASM binary is loaded separately from CDN.
  const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm'

  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
  })

  loaded = true
}

export async function extractAudioFromSegment(
  videoBlob: Blob,
  startTime?: number,
  duration?: number
): Promise<Float32Array> {
  if (!ffmpeg || !loaded) {
    throw new Error('FFmpeg not loaded. Call loadFFmpeg() first.')
  }

  const inputName = 'input.mp4'
  const outputName = 'output.wav'

  try {
    // Write video to FFmpeg virtual filesystem
    await ffmpeg.writeFile(inputName, await fetchFile(videoBlob))

    // Build FFmpeg command
    const args = ['-i', inputName]

    if (startTime !== undefined) {
      args.push('-ss', startTime.toString())
    }
    if (duration !== undefined) {
      args.push('-t', duration.toString())
    }

    // Extract audio as WAV (PCM for analysis)
    // NOTE: Essentia.js SuperFluxExtractor requires 44100Hz sample rate
    args.push(
      '-vn',           // No video
      '-acodec', 'pcm_s16le',
      '-ar', '44100',  // Sample rate - Essentia.js requires 44100Hz
      '-ac', '1',      // Mono
      outputName
    )

    const exitCode = await ffmpeg.exec(args)
    if (exitCode !== 0) {
      throw new Error(`FFmpeg failed with exit code ${exitCode}`)
    }

    // Read output
    const data = await ffmpeg.readFile(outputName)

    if (!(data instanceof Uint8Array)) {
      throw new Error('Unexpected FFmpeg output format')
    }

    // Convert WAV bytes to Float32Array (skip 44-byte header)
    const int16Array = new Int16Array(data.buffer, 44)
    const floatArray = new Float32Array(int16Array.length)
    for (let i = 0; i < int16Array.length; i++) {
      floatArray[i] = int16Array[i] / 32768.0
    }

    return floatArray
  } finally {
    // Cleanup even on error
    try { await ffmpeg.deleteFile(inputName) } catch { /* ignore cleanup errors */ }
    try { await ffmpeg.deleteFile(outputName) } catch { /* ignore cleanup errors */ }
  }
}

export function isFFmpegLoaded(): boolean {
  return loaded
}

// HEVC transcoding in-browser is inherently slow (~4x realtime for 4K) due to
// single-threaded WASM FFmpeg. This is a known, accepted limitation.
// For large files, recommend desktop pre-transcoding.

/**
 * Fast video playability check using browser's native video element.
 * Creates a temporary video element and checks if it can load metadata.
 * This works regardless of moov atom position since the browser handles seeking.
 *
 * @param file - The video file to check
 * @returns Object with playability info
 */
export async function detectVideoCodec(file: File): Promise<{
  codec: string
  isHevc: boolean
  isPlayable: boolean
}> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    const objectUrl = URL.createObjectURL(file)

    const cleanup = () => {
      URL.revokeObjectURL(objectUrl)
      video.src = ''
      video.load()
    }

    // Timeout after 10 seconds - if we can't determine playability, assume it's NOT playable
    // (defensive approach). This prevents HEVC videos from slipping through and failing later.
    // The user will be offered transcoding options rather than encountering a mysterious failure.
    const timeout = setTimeout(() => {
      cleanup()
      resolve({ codec: 'unknown', isHevc: true, isPlayable: false })
    }, 10000)

    // If we can load metadata AND have video dimensions, it's playable
    video.onloadedmetadata = () => {
      clearTimeout(timeout)
      const isPlayable = video.videoWidth > 0 && video.videoHeight > 0

      if (isPlayable) {
        cleanup()
        resolve({ codec: 'supported', isHevc: false, isPlayable: true })
      } else {
        // Has metadata but no dimensions - likely codec issue
        cleanup()
        resolve({ codec: 'hevc', isHevc: true, isPlayable: false })
      }
    }

    // If we get an error, the video is likely unplayable (HEVC or other unsupported codec)
    video.onerror = () => {
      clearTimeout(timeout)
      const error = video.error

      // MEDIA_ERR_SRC_NOT_SUPPORTED or MEDIA_ERR_DECODE usually means codec issue
      if (error && (error.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED ||
                    error.code === MediaError.MEDIA_ERR_DECODE)) {
        cleanup()
        resolve({ codec: 'hevc', isHevc: true, isPlayable: false })
      } else {
        // Other errors - let it proceed and handle in player
        cleanup()
        resolve({ codec: 'unknown', isHevc: false, isPlayable: true })
      }
    }

    // Some browsers fire canplay before loadedmetadata for some codecs
    video.oncanplay = () => {
      clearTimeout(timeout)
      cleanup()
      resolve({ codec: 'supported', isHevc: false, isPlayable: true })
    }

    video.preload = 'metadata'
    video.src = objectUrl
  })
}

/**
 * Transcode HEVC video to H.264 for browser compatibility.
 * Uses ultrafast preset to minimize processing time.
 *
 * **Abort Handling Limitation:**
 * FFmpeg WASM's exec() cannot be interrupted mid-operation. When the user cancels:
 * 1. Progress updates stop immediately (listener removed)
 * 2. The actual FFmpeg operation continues until it finishes or the next abort check
 * 3. AbortError is thrown only at specific checkpoints (before/after each operation)
 *
 * This means cancellation is not instant - the UI should show "Cancelling..." feedback
 * to indicate the operation is being stopped.
 *
 * @param videoBlob - The HEVC video blob
 * @param onProgress - Optional callback for progress updates (0-100)
 * @param signal - Optional AbortSignal to cancel transcoding
 * @returns H.264 encoded video blob
 * @throws Error with name 'AbortError' if cancelled
 */
export async function transcodeHevcToH264(
  videoBlob: Blob,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal
): Promise<Blob> {
  if (!ffmpeg || !loaded) {
    throw new Error('FFmpeg not loaded. Call loadFFmpeg() first.')
  }

  // Check if already aborted
  if (signal?.aborted) {
    const error = new Error('Transcoding cancelled')
    error.name = 'AbortError'
    throw error
  }

  const inputName = 'hevc_input.mp4'
  const outputName = 'h264_output.mp4'

  // Track progress from FFmpeg
  const progressHandler = ({ progress }: { progress: number }) => {
    onProgress?.(Math.round(progress * 100))
  }
  ffmpeg.on('progress', progressHandler)

  // Set up abort listener
  let abortHandler: (() => void) | undefined
  if (signal) {
    abortHandler = () => {
      // FFmpeg WASM doesn't have a clean abort API
      // We remove the progress listener to stop UI updates
      // The abort check before each FFmpeg operation will throw
      ffmpeg?.off('progress', progressHandler)
    }
    signal.addEventListener('abort', abortHandler)
  }

  try {
    // Check abort before writing file
    if (signal?.aborted) {
      const error = new Error('Transcoding cancelled')
      error.name = 'AbortError'
      throw error
    }

    await ffmpeg.writeFile(inputName, await fetchFile(videoBlob))

    // Check abort before exec
    if (signal?.aborted) {
      const error = new Error('Transcoding cancelled')
      error.name = 'AbortError'
      throw error
    }

    const exitCode = await ffmpeg.exec([
      '-i', inputName,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '23',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-y',
      outputName
    ])

    // Check abort after exec
    if (signal?.aborted) {
      const error = new Error('Transcoding cancelled')
      error.name = 'AbortError'
      throw error
    }

    if (exitCode !== 0) {
      throw new Error(`FFmpeg transcoding failed with exit code ${exitCode}`)
    }

    const data = await ffmpeg.readFile(outputName)

    if (!(data instanceof Uint8Array)) {
      throw new Error('Unexpected FFmpeg output format')
    }

    return new Blob([data.buffer as ArrayBuffer], { type: 'video/mp4' })
  } finally {
    ffmpeg.off('progress', progressHandler)
    if (abortHandler && signal) {
      signal.removeEventListener('abort', abortHandler)
    }
    try { await ffmpeg.deleteFile(inputName) } catch { /* ignore */ }
    try { await ffmpeg.deleteFile(outputName) } catch { /* ignore */ }
  }
}

/**
 * Get the FFmpeg instance. Must call loadFFmpeg() first.
 * @throws Error if FFmpeg is not loaded
 */
export function getFFmpegInstance(): FFmpeg {
  if (!ffmpeg || !loaded) {
    throw new Error('FFmpeg not loaded. Call loadFFmpeg() first.')
  }
  return ffmpeg
}

/**
 * Extract a video segment with proper container format.
 * Uses FFmpeg for keyframe-aware seeking and container preservation.
 *
 * @param videoBlob - The video blob or file
 * @param startTime - Start time in seconds
 * @param duration - Duration in seconds
 * @returns Blob containing playable video segment
 */
export async function extractVideoSegment(
  videoBlob: Blob,
  startTime: number,
  duration: number
): Promise<Blob> {
  if (!ffmpeg || !loaded) {
    throw new Error('FFmpeg not loaded. Call loadFFmpeg() first.')
  }

  const inputName = 'input_video.mp4'
  const outputName = 'output_segment.mp4'

  try {
    await ffmpeg.writeFile(inputName, await fetchFile(videoBlob))

    // Use -ss before -i for fast seeking, then -t for duration
    // -c copy uses stream copy (no re-encoding) for speed
    // -avoid_negative_ts make_zero fixes timestamp issues from seeking
    const exitCode = await ffmpeg.exec([
      '-ss', startTime.toString(),
      '-i', inputName,
      '-t', duration.toString(),
      '-c', 'copy',
      '-avoid_negative_ts', 'make_zero',
      outputName
    ])

    if (exitCode !== 0) {
      throw new Error(`FFmpeg segment extraction failed with exit code ${exitCode}`)
    }

    const data = await ffmpeg.readFile(outputName)

    if (!(data instanceof Uint8Array)) {
      throw new Error('Unexpected FFmpeg output format')
    }

    return new Blob([data.buffer as ArrayBuffer], { type: 'video/mp4' })
  } finally {
    try { await ffmpeg.deleteFile(inputName) } catch { /* ignore */ }
    try { await ffmpeg.deleteFile(outputName) } catch { /* ignore */ }
  }
}

// Transcoding time estimates (based on benchmarks)
// WASM FFmpeg with ultrafast preset - conservative estimates
export const TRANSCODE_ESTIMATE = {
  RATIO_4K_60FPS: 4,   // 4K 60fps: ~4 min per min of video
  RATIO_4K_30FPS: 3,   // 4K 30fps: ~3 min per min of video
  RATIO_1080P: 2,      // 1080p: ~2 min per min of video
  RATIO_DEFAULT: 3,    // Default fallback
}

export const SUPPORTED_CODECS = ['H.264', 'VP8', 'VP9']
export const SUPPORTED_CONTAINERS = ['MP4', 'MOV', 'M4V']

/**
 * Estimate transcoding time based on file size.
 * Uses conservative estimates for WASM FFmpeg.
 *
 * @param fileSizeMB - File size in megabytes
 * @returns Object with min/max minutes and formatted string
 */
export function estimateTranscodeTime(fileSizeMB: number): {
  minMinutes: number
  maxMinutes: number
  formatted: string
} {
  // Estimate video duration from file size using typical HEVC bitrates:
  // - 4K 60fps HEVC at ~50 Mbps ≈ 375 MB/minute
  // - 4K 30fps HEVC at ~25 Mbps ≈ 188 MB/minute
  // Using 400 MB/minute as a conservative baseline for worst-case (high-bitrate 4K 60fps)
  // This ratio was derived from benchmarking iPhone 15 Pro Max HEVC recordings.
  const MB_PER_MINUTE_4K_60FPS = 400
  const estimatedDurationMinutes = fileSizeMB / MB_PER_MINUTE_4K_60FPS

  // Use 4K 60fps ratio (most conservative)
  const ratio = TRANSCODE_ESTIMATE.RATIO_4K_60FPS

  const minMinutes = Math.max(1, Math.floor(estimatedDurationMinutes * (ratio - 1)))
  const maxMinutes = Math.ceil(estimatedDurationMinutes * (ratio + 1))

  let formatted: string
  if (maxMinutes <= 1) {
    formatted = 'less than a minute'
  } else if (minMinutes === maxMinutes) {
    formatted = `about ${minMinutes} minute${minMinutes > 1 ? 's' : ''}`
  } else {
    formatted = `${minMinutes}-${maxMinutes} minutes`
  }

  return { minMinutes, maxMinutes, formatted }
}

/**
 * Format remaining time based on progress percentage and elapsed time.
 *
 * @param progress - Current progress 0-100
 * @param elapsedMs - Elapsed time in milliseconds
 * @returns Formatted remaining time string
 */
export function formatRemainingTime(progress: number, elapsedMs: number): string {
  if (progress <= 0 || progress >= 100) return ''

  const estimatedTotalMs = elapsedMs / (progress / 100)
  const remainingMs = estimatedTotalMs - elapsedMs
  const remainingSeconds = Math.ceil(remainingMs / 1000)

  if (remainingSeconds < 60) {
    return `${remainingSeconds}s remaining`
  }

  const remainingMinutes = Math.ceil(remainingSeconds / 60)
  return `${remainingMinutes} min remaining`
}
