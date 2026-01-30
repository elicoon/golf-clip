/**
 * Streaming Processor
 *
 * Core orchestration module that ties together FFmpeg audio extraction,
 * Essentia strike detection, and video segment extraction. Processes video
 * files in chunks to keep memory bounded while progressively updating the UI.
 *
 * Pipeline:
 * 1. Load FFmpeg.wasm and Essentia.js
 * 2. Get video duration from metadata
 * 3. Process audio in 30-second chunks, detecting strikes in each
 * 4. Extract 20-second video segments (5s before to 15s after) around each strike
 * 5. Update the store with progress, strikes, and segments
 */

import { loadFFmpeg, extractAudioFromSegment } from './ffmpeg-client'
import { loadEssentia, detectStrikes, StrikeDetection } from './audio-detector'
import { extractSegment, getVideoDuration } from './segment-extractor'
import { useProcessingStore, VideoSegment } from '../stores/processingStore'

const AUDIO_CHUNK_DURATION = 30 // Analyze 30 seconds at a time
const SAMPLE_RATE = 22050

export interface ProcessingCallbacks {
  onProgress?: (percent: number, message: string) => void
  onStrikeDetected?: (strike: StrikeDetection) => void
  onSegmentReady?: (segmentBlob: Blob, strikeTime: number) => void
  onComplete?: (strikes: StrikeDetection[]) => void
  onError?: (error: Error) => void
}

/**
 * Process a video file to detect golf strikes and extract segments.
 *
 * @param file - The video file to process
 * @param callbacks - Optional callbacks for progress and events
 * @returns Array of detected strikes
 */
export async function processVideoFile(
  file: File,
  callbacks: ProcessingCallbacks = {}
): Promise<StrikeDetection[]> {
  const store = useProcessingStore.getState()

  try {
    // Phase 1: Initialize
    store.setStatus('loading')
    store.setProgress(5, 'Loading FFmpeg...')
    await loadFFmpeg()

    store.setProgress(10, 'Loading audio analyzer...')
    await loadEssentia()

    // Phase 2: Get video metadata
    store.setProgress(15, 'Reading video metadata...')
    const duration = await getVideoDuration(file)
    store.setFileInfo(file.name, duration)

    // Phase 3: Process audio in chunks
    store.setStatus('processing')
    const allStrikes: StrikeDetection[] = []
    const numChunks = Math.ceil(duration / AUDIO_CHUNK_DURATION)

    for (let i = 0; i < numChunks; i++) {
      const chunkStart = i * AUDIO_CHUNK_DURATION
      const chunkEnd = Math.min((i + 1) * AUDIO_CHUNK_DURATION, duration)
      const chunkDuration = chunkEnd - chunkStart

      const progressPercent = 20 + (i / numChunks) * 60
      store.setProgress(progressPercent, `Analyzing audio chunk ${i + 1}/${numChunks}...`)
      callbacks.onProgress?.(progressPercent, `Analyzing chunk ${i + 1}/${numChunks}`)

      // Extract video segment for this chunk (uses File.slice for efficiency)
      const chunkBlob = await extractSegment(file, chunkStart, chunkEnd, duration)

      // Extract audio from this chunk blob
      // Pass 0 for startTime since the blob already starts at chunkStart
      const audioData = await extractAudioFromSegment(chunkBlob, 0, chunkDuration)

      // Detect strikes in this chunk
      const chunkStrikes = await detectStrikes(audioData, SAMPLE_RATE)

      // Adjust timestamps to absolute time
      for (const strike of chunkStrikes) {
        const adjustedStrike = {
          ...strike,
          timestamp: strike.timestamp + chunkStart
        }
        allStrikes.push(adjustedStrike)
        store.addStrike(adjustedStrike)
        callbacks.onStrikeDetected?.(adjustedStrike)
      }
    }

    // Phase 4: Extract video segments for each strike
    store.setProgress(85, 'Extracting video segments...')

    for (let i = 0; i < allStrikes.length; i++) {
      const strike = allStrikes[i]

      // Extract 20-second segment: 5 seconds before to 15 seconds after
      const segmentStart = Math.max(0, strike.timestamp - 5)
      const segmentEnd = Math.min(duration, strike.timestamp + 15)

      const segmentBlob = await extractSegment(file, segmentStart, segmentEnd, duration)

      const segment: VideoSegment = {
        id: `segment-${i}`,
        strikeTime: strike.timestamp,
        blob: segmentBlob,
        objectUrl: URL.createObjectURL(segmentBlob),
      }

      store.addSegment(segment)
      callbacks.onSegmentReady?.(segmentBlob, strike.timestamp)

      // Update progress during segment extraction
      const segmentProgress = 85 + (i / allStrikes.length) * 10
      store.setProgress(segmentProgress, `Extracting segment ${i + 1}/${allStrikes.length}...`)
    }

    // Complete
    store.setProgress(100, 'Processing complete!')
    store.setStatus('ready')
    callbacks.onComplete?.(allStrikes)

    return allStrikes

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    store.setError(err.message)
    callbacks.onError?.(err)
    throw err
  }
}

// Re-export types for convenience
export type { StrikeDetection } from './audio-detector'
export type { VideoSegment } from '../stores/processingStore'
