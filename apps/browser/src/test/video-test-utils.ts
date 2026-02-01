/**
 * Video Test Utilities
 *
 * Helpers for testing video playback, codec detection, and segment extraction.
 * These utilities help ensure we NEVER show a black screen in clip review.
 */

/**
 * Create a mock video blob for testing.
 * Note: These are minimal valid container headers, not playable video.
 * For playback tests, use mockVideoElement() instead.
 */
export function createMockVideoBlob(codec: 'h264' | 'hevc' | 'vp9' | 'invalid'): Blob {
  // Create minimal byte sequences that FFmpeg can identify as video containers
  // Real codec detection looks for specific atoms/boxes in the container

  switch (codec) {
    case 'h264':
      // MP4 with H.264 - ftyp box followed by avc1 reference
      // Minimal MP4 header structure
      return new Blob([
        new Uint8Array([
          // ftyp box (file type)
          0x00, 0x00, 0x00, 0x14, // box size (20 bytes)
          0x66, 0x74, 0x79, 0x70, // 'ftyp'
          0x69, 0x73, 0x6f, 0x6d, // 'isom' brand
          0x00, 0x00, 0x02, 0x00, // minor version
          0x69, 0x73, 0x6f, 0x6d, // compatible brand 'isom'
          // moov box marker with avc1
          0x00, 0x00, 0x00, 0x20, // size
          0x6d, 0x6f, 0x6f, 0x76, // 'moov'
          // Include 'avc1' marker for H.264 detection
          0x61, 0x76, 0x63, 0x31, // 'avc1'
          // Padding
          0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00,
        ])
      ], { type: 'video/mp4' })

    case 'hevc':
      // MP4 with HEVC/H.265 - ftyp box followed by hvc1 reference
      return new Blob([
        new Uint8Array([
          // ftyp box
          0x00, 0x00, 0x00, 0x14,
          0x66, 0x74, 0x79, 0x70, // 'ftyp'
          0x69, 0x73, 0x6f, 0x6d, // 'isom'
          0x00, 0x00, 0x02, 0x00,
          0x69, 0x73, 0x6f, 0x6d,
          // moov with hvc1
          0x00, 0x00, 0x00, 0x20,
          0x6d, 0x6f, 0x6f, 0x76, // 'moov'
          // Include 'hvc1' marker for HEVC detection
          0x68, 0x76, 0x63, 0x31, // 'hvc1'
          0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00,
        ])
      ], { type: 'video/mp4' })

    case 'vp9':
      // WebM with VP9
      return new Blob([
        new Uint8Array([
          // WebM EBML header
          0x1a, 0x45, 0xdf, 0xa3, // EBML signature
          0x01, 0x00, 0x00, 0x00, // size
          0x00, 0x00, 0x00, 0x1f,
          0x42, 0x86, 0x81, 0x01, // EBMLVersion
          0x42, 0xf7, 0x81, 0x01, // EBMLReadVersion
          // VP9 codec marker
          0x56, 0x50, 0x39, 0x30, // 'VP90'
          0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00,
        ])
      ], { type: 'video/webm' })

    case 'invalid':
    default:
      // Random bytes that don't form a valid video container
      return new Blob([
        new Uint8Array([
          0x00, 0x01, 0x02, 0x03,
          0x04, 0x05, 0x06, 0x07,
          0x08, 0x09, 0x0a, 0x0b,
        ])
      ], { type: 'video/mp4' })
  }
}

/**
 * Create a mock HTMLVideoElement for testing.
 * Simulates video element behavior without real video decoding.
 * Works in both browser and Node.js environments (no document required).
 */
export interface MockVideoOptions {
  canPlay: boolean
  error?: string
  duration?: number
  readyState?: number
  videoWidth?: number
  videoHeight?: number
}

/**
 * Minimal mock video element interface for testing.
 * Contains only the properties needed for video playback testing.
 */
export interface MockVideoElement {
  readyState: number
  duration: number
  videoWidth: number
  videoHeight: number
  paused: boolean
  currentTime: number
  error: { code: number; message: string } | null
  play: () => Promise<void>
  pause: () => void
  addEventListener: (event: string, handler: () => void) => void
  removeEventListener: (event: string, handler: () => void) => void
  dispatchEvent: (event: { type: string }) => void
}

export function createMockVideoElement(options: MockVideoOptions): MockVideoElement {
  const {
    canPlay,
    error,
    duration = 10,
    readyState = canPlay ? 4 : 0, // 4 = HAVE_ENOUGH_DATA
    videoWidth = 1920,
    videoHeight = 1080,
  } = options

  // Event listeners storage
  const listeners: Record<string, Array<() => void>> = {}

  // Create mock video object (no document dependency)
  const video: MockVideoElement = {
    readyState,
    duration,
    videoWidth: canPlay ? videoWidth : 0,
    videoHeight: canPlay ? videoHeight : 0,
    paused: true,
    currentTime: 0,
    error: (error && !canPlay) ? { code: 4, message: error } : null,

    play: async () => {
      if (!canPlay) {
        const err = new Error(error || 'The media could not be loaded')
        err.name = 'NotSupportedError'
        throw err
      }
      video.paused = false
      video.dispatchEvent({ type: 'play' })
    },

    pause: () => {
      video.paused = true
      video.dispatchEvent({ type: 'pause' })
    },

    addEventListener: (event: string, handler: () => void) => {
      if (!listeners[event]) {
        listeners[event] = []
      }
      listeners[event].push(handler)
    },

    removeEventListener: (event: string, handler: () => void) => {
      if (listeners[event]) {
        const index = listeners[event].indexOf(handler)
        if (index > -1) {
          listeners[event].splice(index, 1)
        }
      }
    },

    dispatchEvent: (event: { type: string }) => {
      if (listeners[event.type]) {
        listeners[event.type].forEach(handler => handler())
      }
    },
  }

  return video
}

/**
 * Video element interface for assertVideoNotBlack.
 * Works with both real HTMLVideoElement and MockVideoElement.
 */
interface VideoElementLike {
  videoWidth: number
  videoHeight: number
  readyState: number
  error: { code: number; message: string } | null
}

/**
 * Assert that a video element is showing actual content (not black screen).
 * A black screen occurs when:
 * - videoWidth/videoHeight are 0
 * - readyState < HAVE_CURRENT_DATA (2)
 * - There's an error and no error UI is shown
 *
 * @param videoElement The video element to check (real or mock)
 * @returns true if video has content, false if showing black
 */
export function assertVideoNotBlack(videoElement: VideoElementLike): boolean {
  // Check 1: Video has dimensions (decoded at least one frame)
  if (videoElement.videoWidth === 0 || videoElement.videoHeight === 0) {
    return false
  }

  // Check 2: Video has enough data to show current frame
  // HAVE_CURRENT_DATA (2) or higher means at least one frame is available
  if (videoElement.readyState < 2) {
    return false
  }

  // Check 3: No unhandled error
  if (videoElement.error) {
    return false
  }

  return true
}

/**
 * Wait for a video element to either load or error.
 * Useful for testing async video loading.
 * Works with both real HTMLVideoElement and MockVideoElement.
 */
export function waitForVideoReady(video: MockVideoElement, timeoutMs = 5000): Promise<'loaded' | 'error'> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Video did not load within ${timeoutMs}ms`))
    }, timeoutMs)

    const cleanup = () => {
      clearTimeout(timeout)
      video.removeEventListener('canplay', onCanPlay)
      video.removeEventListener('error', onError)
    }

    const onCanPlay = () => {
      cleanup()
      resolve('loaded')
    }

    const onError = () => {
      cleanup()
      resolve('error')
    }

    video.addEventListener('canplay', onCanPlay)
    video.addEventListener('error', onError)

    // If already in a terminal state, resolve immediately
    if (video.readyState >= 3) {
      cleanup()
      resolve('loaded')
    } else if (video.error) {
      cleanup()
      resolve('error')
    }
  })
}

/**
 * Mock FFmpeg log output for codec detection tests.
 * Returns the log string that FFmpeg would produce for a given codec.
 */
export function mockFFmpegLogOutput(codec: 'h264' | 'hevc' | 'vp9' | 'unknown'): string {
  switch (codec) {
    case 'h264':
      return `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'input.mp4':
  Duration: 00:00:10.00, start: 0.000000, bitrate: 5000 kb/s
    Stream #0:0(und): Video: h264 (High) (avc1 / 0x31637661), yuv420p, 1920x1080, 4800 kb/s, 30 fps`

    case 'hevc':
      return `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'input.mp4':
  Duration: 00:00:10.00, start: 0.000000, bitrate: 5000 kb/s
    Stream #0:0(und): Video: hevc (Main) (hvc1 / 0x31637668), yuv420p, 3840x2160, 4800 kb/s, 30 fps`

    case 'vp9':
      return `Input #0, webm, from 'input.webm':
  Duration: 00:00:10.00, start: 0.000000, bitrate: 3000 kb/s
    Stream #0:0: Video: vp9, yuv420p, 1920x1080, 30 fps`

    case 'unknown':
    default:
      return `Input #0, unknown, from 'input.bin':
  Duration: N/A, bitrate: N/A`
  }
}

/**
 * Create a mock processing store segment for testing.
 */
export interface MockSegmentOptions {
  id?: string
  objectUrl?: string
  startTime?: number
  endTime?: number
  clipStart?: number
  clipEnd?: number
  strikeTime?: number
  confidence?: number
  approved?: 'pending' | 'approved' | 'rejected'
}

export function createMockSegment(options: MockSegmentOptions = {}) {
  return {
    id: options.id ?? 'segment-1',
    blob: new Blob(['mock'], { type: 'video/mp4' }),
    objectUrl: options.objectUrl ?? 'blob:mock-url',
    startTime: options.startTime ?? 0,
    endTime: options.endTime ?? 20,
    clipStart: options.clipStart ?? 5,
    clipEnd: options.clipEnd ?? 15,
    strikeTime: options.strikeTime ?? 5,
    confidence: options.confidence ?? 0.5,
    approved: options.approved ?? 'pending',
  }
}
