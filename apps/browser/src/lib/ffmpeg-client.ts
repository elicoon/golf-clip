import { FFmpeg } from '@ffmpeg/ffmpeg'
import { toBlobURL, fetchFile } from '@ffmpeg/util'

let ffmpeg: FFmpeg | null = null
let loaded = false

export async function loadFFmpeg(): Promise<void> {
  if (loaded) return

  ffmpeg = new FFmpeg()

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

  await ffmpeg.exec(args)

  // Read output
  const data = await ffmpeg.readFile(outputName)

  // Clean up
  await ffmpeg.deleteFile(inputName)
  await ffmpeg.deleteFile(outputName)

  // Convert WAV bytes to Float32Array (skip 44-byte header)
  const int16Array = new Int16Array((data as Uint8Array).buffer, 44)
  const floatArray = new Float32Array(int16Array.length)
  for (let i = 0; i < int16Array.length; i++) {
    floatArray[i] = int16Array[i] / 32768.0
  }

  return floatArray
}

export function isFFmpegLoaded(): boolean {
  return loaded
}
