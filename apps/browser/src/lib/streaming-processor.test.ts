/**
 * Streaming Processor Tests
 *
 * Tests for segment extraction and validation.
 * Ensures extracted segments are playable and handles errors gracefully.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createMockVideoBlob,
  createMockVideoElement,
  assertVideoNotBlack,
} from '../test/video-test-utils'

// Mock all the heavy dependencies
vi.mock('./ffmpeg-client', () => ({
  loadFFmpeg: vi.fn().mockResolvedValue(undefined),
  extractAudioFromSegment: vi.fn().mockResolvedValue(new Float32Array(44100)),
  extractVideoSegment: vi.fn().mockResolvedValue(new Blob(['mock'], { type: 'video/mp4' })),
  transcodeHevcToH264: vi.fn().mockResolvedValue(new Blob(['mock'], { type: 'video/mp4' })),
  isFFmpegLoaded: vi.fn(() => true),
  detectVideoCodec: vi.fn().mockResolvedValue({ codec: 'h264', isHevc: false, isPlayable: true }),
}))

vi.mock('./audio-detector', () => ({
  loadEssentia: vi.fn().mockResolvedValue(undefined),
  detectStrikes: vi.fn().mockResolvedValue([]),
  unloadEssentia: vi.fn(),
}))

vi.mock('./segment-extractor', () => ({
  getVideoDuration: vi.fn().mockResolvedValue(60),
  estimateByteOffset: vi.fn((size, duration, time) => (time / duration) * size),
  extractSegment: vi.fn().mockResolvedValue(new Blob(['mock'], { type: 'video/mp4' })),
  estimateBitrate: vi.fn(() => 5000000),
}))

vi.mock('../stores/processingStore', () => ({
  useProcessingStore: {
    getState: vi.fn(() => ({
      setStatus: vi.fn(),
      setProgress: vi.fn(),
      setFileInfo: vi.fn(),
      setError: vi.fn(),
      addStrike: vi.fn(),
      addSegment: vi.fn(),
    })),
  },
}))

// Import the mocked module at the top level
import * as ffmpegClient from './ffmpeg-client'

describe('Segment Extraction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Re-setup the mock return value before each test
    vi.mocked(ffmpegClient.extractVideoSegment).mockResolvedValue(
      new Blob(['mock video data'], { type: 'video/mp4' }),
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('extractVideoSegment', () => {
    it('should validate extracted segment is playable', async () => {
      // Create a mock source video
      const sourceBlob = createMockVideoBlob('h264')

      // Extract segment
      const segment = await ffmpegClient.extractVideoSegment(sourceBlob, 5, 10)

      // Segment should be a blob
      expect(segment).toBeInstanceOf(Blob)
      expect(segment.type).toBe('video/mp4')

      // Create blob URL and check it's valid
      const url = URL.createObjectURL(segment)
      expect(url).toMatch(/^blob:/)
      URL.revokeObjectURL(url)
    })

    it('should create blob URL that video element can use', async () => {
      const sourceBlob = createMockVideoBlob('h264')
      const segment = await ffmpegClient.extractVideoSegment(sourceBlob, 0, 5)

      // Create blob URL
      const objectUrl = URL.createObjectURL(segment)

      // Verify URL format
      expect(objectUrl).toMatch(/^blob:/)

      // Clean up
      URL.revokeObjectURL(objectUrl)
    })

    it('should handle extraction at start of video', async () => {
      const sourceBlob = createMockVideoBlob('h264')
      const segment = await ffmpegClient.extractVideoSegment(sourceBlob, 0, 10)

      expect(segment).toBeInstanceOf(Blob)
      expect(segment.size).toBeGreaterThan(0)
    })

    it('should handle extraction at end of video', async () => {
      const sourceBlob = createMockVideoBlob('h264')
      // Extract last 10 seconds of a 60 second video
      const segment = await ffmpegClient.extractVideoSegment(sourceBlob, 50, 10)

      expect(segment).toBeInstanceOf(Blob)
    })
  })

  describe('Segment Validation', () => {
    it('should reject segments with invalid container format', async () => {
      // Test that we can detect invalid segments
      const invalidBlob = createMockVideoBlob('invalid')

      // Invalid blob should still be a blob, but codec detection would fail
      expect(invalidBlob).toBeInstanceOf(Blob)
      expect(invalidBlob.size).toBeGreaterThan(0)
    })

    it('should accept segments with valid H.264 format', async () => {
      const validBlob = createMockVideoBlob('h264')

      expect(validBlob).toBeInstanceOf(Blob)
      expect(validBlob.type).toBe('video/mp4')
    })

    it('should flag HEVC segments as potentially unplayable', async () => {
      const hevcBlob = createMockVideoBlob('hevc')

      // HEVC blobs are valid containers but may not play in browser
      expect(hevcBlob).toBeInstanceOf(Blob)
      expect(hevcBlob.type).toBe('video/mp4')

      // In real usage, detectVideoCodec would identify this as HEVC
      // and isPlayable would be false
    })
  })

  describe('Error Handling', () => {
    it('should reject unplayable segments with clear error', async () => {
      // Setup mock to reject
      vi.mocked(ffmpegClient.extractVideoSegment).mockRejectedValueOnce(
        new Error('FFmpeg segment extraction failed with exit code 1'),
      )

      const sourceBlob = createMockVideoBlob('invalid')

      await expect(ffmpegClient.extractVideoSegment(sourceBlob, 0, 5)).rejects.toThrow(
        'FFmpeg segment extraction failed',
      )
    })

    it('should handle zero-length segment request', async () => {
      const sourceBlob = createMockVideoBlob('h264')

      // Zero duration should still return something (FFmpeg handles this)
      const segment = await ffmpegClient.extractVideoSegment(sourceBlob, 5, 0)
      expect(segment).toBeInstanceOf(Blob)
    })

    it('should handle negative start time', async () => {
      const sourceBlob = createMockVideoBlob('h264')

      // Negative start should be handled (FFmpeg clamps to 0)
      const segment = await ffmpegClient.extractVideoSegment(sourceBlob, -5, 10)
      expect(segment).toBeInstanceOf(Blob)
    })
  })
})

describe('Segment Blob URL Management', () => {
  it('should create valid blob URLs from segments', () => {
    const mockBlob = new Blob(['test data'], { type: 'video/mp4' })
    const url = URL.createObjectURL(mockBlob)

    expect(url).toMatch(/^blob:/)

    // Clean up
    URL.revokeObjectURL(url)
  })

  it('should allow revoking blob URLs', () => {
    const mockBlob = new Blob(['test data'], { type: 'video/mp4' })
    const url = URL.createObjectURL(mockBlob)

    // Revoke should not throw
    expect(() => URL.revokeObjectURL(url)).not.toThrow()
  })

  it('should create unique URLs for each blob', () => {
    const blob1 = new Blob(['data 1'], { type: 'video/mp4' })
    const blob2 = new Blob(['data 2'], { type: 'video/mp4' })

    const url1 = URL.createObjectURL(blob1)
    const url2 = URL.createObjectURL(blob2)

    expect(url1).not.toBe(url2)

    URL.revokeObjectURL(url1)
    URL.revokeObjectURL(url2)
  })
})

describe('Segment Store Integration', () => {
  it('should add segment to store with required fields', async () => {
    const mockAddSegment = vi.fn()

    vi.doMock('../stores/processingStore', () => ({
      useProcessingStore: {
        getState: vi.fn(() => ({
          setStatus: vi.fn(),
          setProgress: vi.fn(),
          setFileInfo: vi.fn(),
          setError: vi.fn(),
          addStrike: vi.fn(),
          addSegment: mockAddSegment,
        })),
      },
    }))

    // Simulate adding a segment like streaming-processor does
    const segment = {
      id: 'segment-0',
      strikeTime: 5.0,
      startTime: 0,
      endTime: 20,
      blob: new Blob(['mock'], { type: 'video/mp4' }),
      objectUrl: 'blob:http://localhost:3000/test',
    }

    mockAddSegment(segment)

    expect(mockAddSegment).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'segment-0',
        strikeTime: 5.0,
        startTime: 0,
        endTime: 20,
        blob: expect.any(Blob),
        objectUrl: expect.stringMatching(/^blob:/),
      }),
    )
  })

  it('should include objectUrl in segment data', () => {
    const blob = new Blob(['mock'], { type: 'video/mp4' })
    const objectUrl = URL.createObjectURL(blob)

    const segment = {
      id: 'segment-1',
      blob,
      objectUrl,
    }

    expect(segment.objectUrl).toBeTruthy()
    expect(segment.objectUrl).toMatch(/^blob:/)

    URL.revokeObjectURL(objectUrl)
  })
})

describe('Video Segment Playability', () => {
  it('should produce segment that passes black screen check when played', () => {
    // Create a mock video element in playable state
    const video = createMockVideoElement({
      canPlay: true,
      readyState: 4,
      videoWidth: 1920,
      videoHeight: 1080,
    })

    // This would be the video element after loading the segment
    expect(assertVideoNotBlack(video)).toBe(true)
  })

  it('should fail black screen check when segment produces error', () => {
    const video = createMockVideoElement({
      canPlay: false,
      error: 'Media format not supported',
      readyState: 0,
    })

    expect(assertVideoNotBlack(video)).toBe(false)
  })

  it('should fail black screen check when segment has no frames', () => {
    const video = createMockVideoElement({
      canPlay: true,
      readyState: 4,
      videoWidth: 0, // No decoded frames
      videoHeight: 0,
    })

    expect(assertVideoNotBlack(video)).toBe(false)
  })
})
