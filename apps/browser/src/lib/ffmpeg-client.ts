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
    args.push(
      '-vn',           // No video
      '-acodec', 'pcm_s16le',
      '-ar', '22050',  // Sample rate (lower for memory efficiency)
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
