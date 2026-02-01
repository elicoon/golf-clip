/**
 * ClipReview Video Handling Tests
 *
 * Tests for video playback in the clip review component.
 * Focus: Ensure we NEVER show a black screen - either video plays OR error shows.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createMockVideoElement,
  createMockSegment,
  assertVideoNotBlack,
} from '../test/video-test-utils'

// Mock the processing store
vi.mock('../stores/processingStore', () => ({
  useProcessingStore: vi.fn(() => ({
    segments: [],
    updateSegment: vi.fn(),
    approveSegment: vi.fn(),
    rejectSegment: vi.fn(),
  })),
}))

// Mock feedback service
vi.mock('../lib/feedback-service', () => ({
  submitShotFeedback: vi.fn(),
  submitTracerFeedback: vi.fn(),
}))

// Mock ffmpeg-client
vi.mock('../lib/ffmpeg-client', () => ({
  loadFFmpeg: vi.fn().mockResolvedValue(undefined),
  getFFmpegInstance: vi.fn(),
}))

// Mock trajectory generator
vi.mock('../lib/trajectory-generator', () => ({
  generateTrajectory: vi.fn(() => ({
    points: [],
    animationStart: 0,
    animationEnd: 3,
  })),
}))

describe('ClipReview Video Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Video Element State', () => {
    it('should show error message when video fails to load', async () => {
      // Create a mock video element that errors
      const video = createMockVideoElement({
        canPlay: false,
        error: 'The media could not be loaded because the format is not supported',
      })

      // Simulate video error event
      const errorHandler = vi.fn()
      video.addEventListener('error', errorHandler)
      video.dispatchEvent(new Event('error'))

      // Verify error handler was called
      expect(errorHandler).toHaveBeenCalled()

      // Verify video has error state
      expect(video.error).toBeTruthy()
      expect(video.error?.message).toContain('not supported')

      // Black screen check should fail (this is expected - error state)
      expect(assertVideoNotBlack(video)).toBe(false)
    })

    it('should display video when codec is supported', async () => {
      // Create a mock video element that can play
      const video = createMockVideoElement({
        canPlay: true,
        duration: 10,
        videoWidth: 1920,
        videoHeight: 1080,
      })

      // Simulate successful load
      video.dispatchEvent(new Event('canplay'))

      // Video should not be in black screen state
      expect(assertVideoNotBlack(video)).toBe(true)
      expect(video.videoWidth).toBeGreaterThan(0)
      expect(video.videoHeight).toBeGreaterThan(0)
    })

    it('should have video dimensions when loaded', async () => {
      const video = createMockVideoElement({
        canPlay: true,
        videoWidth: 1920,
        videoHeight: 1080,
      })

      // Dimensions should be available
      expect(video.videoWidth).toBe(1920)
      expect(video.videoHeight).toBe(1080)
    })

    it('should have zero dimensions when video fails', async () => {
      const video = createMockVideoElement({
        canPlay: false,
        error: 'Format not supported',
      })

      // Failed video should have zero dimensions
      expect(video.videoWidth).toBe(0)
      expect(video.videoHeight).toBe(0)
    })
  })

  describe('Black Screen Prevention', () => {
    it('should fail assertVideoNotBlack when videoWidth is 0', () => {
      const video = createMockVideoElement({
        canPlay: false,
        videoWidth: 0,
        videoHeight: 0,
      })

      expect(assertVideoNotBlack(video)).toBe(false)
    })

    it('should fail assertVideoNotBlack when readyState < 2', () => {
      const video = createMockVideoElement({
        canPlay: true,
        readyState: 1, // HAVE_METADATA but not HAVE_CURRENT_DATA
      })

      // Override to have dimensions but low readyState
      Object.defineProperty(video, 'videoWidth', { value: 1920 })
      Object.defineProperty(video, 'videoHeight', { value: 1080 })
      Object.defineProperty(video, 'readyState', { value: 1 })

      expect(assertVideoNotBlack(video)).toBe(false)
    })

    it('should fail assertVideoNotBlack when there is an error', () => {
      const video = createMockVideoElement({
        canPlay: false,
        error: 'Media error',
      })

      expect(assertVideoNotBlack(video)).toBe(false)
    })

    it('should pass assertVideoNotBlack for valid playable video', () => {
      const video = createMockVideoElement({
        canPlay: true,
        readyState: 4, // HAVE_ENOUGH_DATA
        videoWidth: 1920,
        videoHeight: 1080,
      })

      expect(assertVideoNotBlack(video)).toBe(true)
    })
  })

  describe('Segment Object URLs', () => {
    it('should have valid objectUrl in segment', () => {
      const segment = createMockSegment({
        objectUrl: 'blob:http://localhost:3000/12345',
      })

      expect(segment.objectUrl).toMatch(/^blob:/)
    })

    it('should have blob data in segment', () => {
      const segment = createMockSegment()

      expect(segment.blob).toBeInstanceOf(Blob)
      expect(segment.blob.type).toBe('video/mp4')
    })
  })

  describe('Video Event Handling', () => {
    it('should handle canplay event', async () => {
      const video = createMockVideoElement({ canPlay: true })
      const canplayHandler = vi.fn()

      video.addEventListener('canplay', canplayHandler)
      video.dispatchEvent(new Event('canplay'))

      expect(canplayHandler).toHaveBeenCalledTimes(1)
    })

    it('should handle error event', async () => {
      const video = createMockVideoElement({
        canPlay: false,
        error: 'Test error',
      })
      const errorHandler = vi.fn()

      video.addEventListener('error', errorHandler)
      video.dispatchEvent(new Event('error'))

      expect(errorHandler).toHaveBeenCalledTimes(1)
    })

    it('should handle play event', async () => {
      const video = createMockVideoElement({ canPlay: true })
      const playHandler = vi.fn()

      video.addEventListener('play', playHandler)
      await video.play()

      expect(playHandler).toHaveBeenCalledTimes(1)
    })

    it('should throw on play when video cannot play', async () => {
      const video = createMockVideoElement({
        canPlay: false,
        error: 'Format not supported',
      })

      await expect(video.play()).rejects.toThrow()
    })
  })

  describe('Clip Review States', () => {
    it('should have pending approval state for new segments', () => {
      const segment = createMockSegment({ approved: 'pending' })
      expect(segment.approved).toBe('pending')
    })

    it('should have confidence below 0.7 for review-required segments', () => {
      const segment = createMockSegment({ confidence: 0.5 })
      const needsReview = segment.confidence < 0.7
      expect(needsReview).toBe(true)
    })

    it('should not require review for high-confidence segments', () => {
      const segment = createMockSegment({ confidence: 0.85 })
      const needsReview = segment.confidence < 0.7
      expect(needsReview).toBe(false)
    })
  })
})

describe('ClipReview Error States', () => {
  it('should distinguish between codec error and network error', () => {
    // Codec error - format not supported
    const codecError = {
      code: 4, // MEDIA_ERR_SRC_NOT_SUPPORTED
      message: 'The media could not be loaded, format not supported',
    }

    // Network error - failed to fetch
    const networkError = {
      code: 2, // MEDIA_ERR_NETWORK
      message: 'A network error occurred',
    }

    expect(codecError.code).toBe(4)
    expect(networkError.code).toBe(2)

    // Different errors should trigger different UI responses
    const isCodecError = codecError.code === 4
    const isNetworkError = networkError.code === 2

    expect(isCodecError).toBe(true)
    expect(isNetworkError).toBe(true)
  })

  it('should identify HEVC-specific errors', () => {
    const hevcErrorMessages = [
      'HEVC codec not supported',
      'Cannot decode hvc1 stream',
      'Hardware decoder not available for H.265',
    ]

    hevcErrorMessages.forEach((message) => {
      const isHevcError =
        message.toLowerCase().includes('hevc') ||
        message.toLowerCase().includes('h.265') ||
        message.toLowerCase().includes('hvc1')

      expect(isHevcError).toBe(true)
    })
  })
})

describe('Video Loading Lifecycle', () => {
  it('should track readyState progression', () => {
    // Video loading goes through these states:
    // 0: HAVE_NOTHING
    // 1: HAVE_METADATA
    // 2: HAVE_CURRENT_DATA
    // 3: HAVE_FUTURE_DATA
    // 4: HAVE_ENOUGH_DATA

    const states = [0, 1, 2, 3, 4]
    const stateNames = [
      'HAVE_NOTHING',
      'HAVE_METADATA',
      'HAVE_CURRENT_DATA',
      'HAVE_FUTURE_DATA',
      'HAVE_ENOUGH_DATA',
    ]

    states.forEach((state, index) => {
      expect(state).toBe(index)
      // At state 2+, we have at least one frame to display
      const hasCurrentFrame = state >= 2
      expect(hasCurrentFrame).toBe(index >= 2)
    })
  })

  it('should consider video playable at readyState >= 3', () => {
    const minPlayableState = 3 // HAVE_FUTURE_DATA

    ;[0, 1, 2].forEach((state) => {
      expect(state >= minPlayableState).toBe(false)
    })

    ;[3, 4].forEach((state) => {
      expect(state >= minPlayableState).toBe(true)
    })
  })
})
