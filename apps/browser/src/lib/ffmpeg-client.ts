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

/**
 * Check if a video file uses HEVC/H.265 codec (common in iPhone MOV files).
 * Chrome on Windows doesn't support HEVC natively.
 *
 * @param videoBlob - The video blob to check
 * @returns true if the video uses HEVC codec
 */
export async function isHevcCodec(videoBlob: Blob): Promise<boolean> {
  if (!ffmpeg || !loaded) {
    throw new Error('FFmpeg not loaded. Call loadFFmpeg() first.')
  }

  const inputName = 'probe_input.mp4'
  let logs = ''

  // Capture FFmpeg log output
  const logHandler = ({ message }: { message: string }) => {
    logs += message + '\n'
  }
  ffmpeg.on('log', logHandler)

  try {
    await ffmpeg.writeFile(inputName, await fetchFile(videoBlob))

    // Run ffmpeg with no output - it will log codec info
    await ffmpeg.exec(['-i', inputName, '-f', 'null', '-'])

    // Check logs for HEVC indicators
    const logsLower = logs.toLowerCase()
    return logsLower.includes('hevc') || logsLower.includes('h265') || logsLower.includes('hvc1')
  } finally {
    ffmpeg.off('log', logHandler)
    try { await ffmpeg.deleteFile(inputName) } catch { /* ignore */ }
  }
}

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
  console.log('[detectVideoCodec] Testing playability for:', file.name)

  return new Promise((resolve) => {
    const video = document.createElement('video')
    const objectUrl = URL.createObjectURL(file)

    const cleanup = () => {
      URL.revokeObjectURL(objectUrl)
      video.src = ''
      video.load()
    }

    // Timeout after 10 seconds - if we can't determine playability, assume it's playable
    // and let the actual player handle any errors
    const timeout = setTimeout(() => {
      console.log('[detectVideoCodec] Timeout - assuming playable')
      cleanup()
      resolve({ codec: 'unknown', isHevc: false, isPlayable: true })
    }, 10000)

    // If we can load metadata AND have video dimensions, it's playable
    video.onloadedmetadata = () => {
      clearTimeout(timeout)
      const isPlayable = video.videoWidth > 0 && video.videoHeight > 0
      console.log('[detectVideoCodec] Metadata loaded, dimensions:', video.videoWidth, 'x', video.videoHeight)

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
      console.log('[detectVideoCodec] Video error:', error?.code, error?.message)

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
      console.log('[detectVideoCodec] Can play - video is playable')
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
  // Rough estimate: 200MB HEVC ≈ 30 seconds of 4K 60fps
  // So 1 minute of video ≈ 400MB
  const estimatedDurationMinutes = fileSizeMB / 400

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
