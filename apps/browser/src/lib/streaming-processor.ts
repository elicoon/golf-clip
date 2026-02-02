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

import { loadFFmpeg, extractAudioFromSegment, extractVideoSegment } from './ffmpeg-client'
import { loadEssentia, detectStrikes, StrikeDetection, unloadEssentia } from './audio-detector'
import { getVideoDuration } from './segment-extractor'
import { useProcessingStore } from '../stores/processingStore'

const AUDIO_CHUNK_DURATION = 30 // Analyze 30 seconds at a time
const SAMPLE_RATE = 44100  // Essentia.js SuperFluxExtractor requires 44100Hz

/**
 * Validate that a video blob is playable in the browser.
 * Creates a temporary video element and checks if it can load.
 *
 * @param blob - The video blob to validate
 * @returns Promise that resolves to true if playable, false otherwise
 */
async function validateSegmentPlayability(blob: Blob): Promise<boolean> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    const objectUrl = URL.createObjectURL(blob)

    const cleanup = () => {
      URL.revokeObjectURL(objectUrl)
      video.src = ''
    }

    const timeout = setTimeout(() => {
      cleanup()
      resolve(false)
    }, 5000)

    video.oncanplay = () => {
      clearTimeout(timeout)
      cleanup()
      resolve(true)
    }

    video.onerror = () => {
      clearTimeout(timeout)
      cleanup()
      resolve(false)
    }

    video.src = objectUrl
    video.preload = 'metadata'
  })
}

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
 * @param videoId - Optional unique identifier for multi-video tracking
 * @param callbacks - Optional callbacks for progress and events
 * @returns Array of detected strikes
 */
export async function processVideoFile(
  file: File,
  videoId?: string,
  callbacks: ProcessingCallbacks = {}
): Promise<StrikeDetection[]> {
  const store = useProcessingStore.getState()

  // Helper to update state - uses videoId if provided, otherwise legacy global state
  const updateProgress = (progress: number, message: string) => {
    if (videoId) {
      store.setVideoProgress(videoId, progress, message)
    } else {
      store.setProgress(progress, message)
    }
    callbacks.onProgress?.(progress, message)
  }

  const updateStatus = (status: 'loading' | 'processing' | 'ready' | 'error') => {
    if (videoId) {
      store.setVideoStatus(videoId, status)
    } else {
      store.setStatus(status)
    }
  }

  const addStrike = (strike: StrikeDetection) => {
    if (videoId) {
      store.addVideoStrike(videoId, strike)
    } else {
      store.addStrike(strike)
    }
    callbacks.onStrikeDetected?.(strike)
  }

  const addSegment = (segment: Parameters<typeof store.addSegment>[0]) => {
    if (videoId) {
      store.addVideoSegment(videoId, segment)
    } else {
      store.addSegment(segment)
    }
  }

  const setFileInfo = (name: string, duration: number) => {
    if (videoId) {
      store.setVideoFileInfo(videoId, duration)
    } else {
      store.setFileInfo(name, duration)
    }
  }

  const setError = (error: string) => {
    if (videoId) {
      store.setVideoError(videoId, error)
    } else {
      store.setError(error)
    }
  }

  try {
    // Phase 1: Initialize
    updateStatus('loading')
    updateProgress(5, 'Loading FFmpeg...')
    await loadFFmpeg()

    // Note: HEVC detection is now done in VideoDropzone before processing starts.
    // If the user chose to transcode, they get an H.264 file.
    // If they proceeded anyway, segments may fail to play (handled by ClipReview error UI).
    updateProgress(8, 'Preparing video...')

    updateProgress(42, 'Loading audio analyzer...')
    await loadEssentia()

    // Phase 2: Get video metadata
    updateProgress(45, 'Reading video metadata...')
    const duration = await getVideoDuration(file)
    setFileInfo(file.name, duration)

    // Phase 3: Process audio in chunks
    updateStatus('processing')
    const allStrikes: StrikeDetection[] = []
    const numChunks = Math.ceil(duration / AUDIO_CHUNK_DURATION)

    for (let i = 0; i < numChunks; i++) {
      const chunkStart = i * AUDIO_CHUNK_DURATION
      const chunkEnd = Math.min((i + 1) * AUDIO_CHUNK_DURATION, duration)
      const chunkDuration = chunkEnd - chunkStart

      const progressPercent = 50 + (i / numChunks) * 35
      updateProgress(progressPercent, `Analyzing audio chunk ${i + 1}/${numChunks}...`)

      // Extract audio from the (possibly transcoded) file with time offsets
      // FFmpeg handles seeking properly - no need for byte-level slicing
      const audioData = await extractAudioFromSegment(file, chunkStart, chunkDuration)

      // Detect strikes in this chunk
      const chunkStrikes = await detectStrikes(audioData, SAMPLE_RATE)

      // Adjust timestamps to absolute time
      for (const strike of chunkStrikes) {
        const adjustedStrike = {
          ...strike,
          timestamp: strike.timestamp + chunkStart
        }
        allStrikes.push(adjustedStrike)
        addStrike(adjustedStrike)
      }
    }

    // Phase 4: Extract video segments for each strike using FFmpeg
    updateProgress(88, 'Extracting video segments...')

    for (let i = 0; i < allStrikes.length; i++) {
      const strike = allStrikes[i]

      // Extract 20-second segment: 5 seconds before to 15 seconds after
      const segmentStart = Math.max(0, strike.timestamp - 5)
      const segmentEnd = Math.min(duration, strike.timestamp + 15)
      const segmentDuration = segmentEnd - segmentStart

      // Use FFmpeg for proper segment extraction with keyframe seeking
      const segmentBlob = await extractVideoSegment(file, segmentStart, segmentDuration)

      // Validate segment is playable in browser
      const isPlayable = await validateSegmentPlayability(segmentBlob)
      if (!isPlayable) {
        console.warn(`[streaming-processor] Segment ${i + 1} may not be playable (codec issue). User will see error in review.`)
        // Still add the segment - the ClipReview will show an error message
        // This is better than silently failing or transcoding every segment which is slow
      }

      addSegment({
        id: `segment-${i}`,
        strikeTime: strike.timestamp,
        startTime: segmentStart,
        endTime: segmentEnd,
        blob: segmentBlob,
        objectUrl: URL.createObjectURL(segmentBlob),
      })
      callbacks.onSegmentReady?.(segmentBlob, strike.timestamp)

      // Update progress during segment extraction
      const segmentProgress = 88 + ((i + 1) / allStrikes.length) * 10
      updateProgress(segmentProgress, `Extracting segment ${i + 1}/${allStrikes.length}...`)
    }

    // Complete
    updateProgress(100, 'Processing complete!')
    updateStatus('ready')
    callbacks.onComplete?.(allStrikes)

    return allStrikes

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    setError(err.message)
    callbacks.onError?.(err)
    throw err
  } finally {
    // Cleanup WASM resources
    unloadEssentia()
  }
}

// Re-export types for convenience
export type { StrikeDetection } from './audio-detector'
export type { VideoSegment } from '../stores/processingStore'
