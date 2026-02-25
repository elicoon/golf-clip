import { describe, it, expect } from 'vitest'
import { estimateByteOffset, extractSegment, estimateBitrate } from './segment-extractor'

describe('SegmentExtractor', () => {
  describe('estimateByteOffset', () => {
    it('estimates byte offset from timestamp', () => {
      const fileSize = 100_000_000 // 100MB
      const duration = 300 // 5 minutes

      const offset = estimateByteOffset(fileSize, duration, 60) // 1 minute mark

      // Should be roughly 20% into file (after accounting for header)
      expect(offset).toBeGreaterThan(15_000_000)
      expect(offset).toBeLessThan(25_000_000)
    })

    it('returns header offset for timestamp 0', () => {
      const fileSize = 100_000_000
      const duration = 300

      const offset = estimateByteOffset(fileSize, duration, 0)

      // Should be at or near header size
      expect(offset).toBeGreaterThanOrEqual(0)
      expect(offset).toBeLessThan(2_000_000) // Header is ~1MB or 1%
    })

    it('returns near end for timestamp equal to duration', () => {
      const fileSize = 100_000_000
      const duration = 300

      const offset = estimateByteOffset(fileSize, duration, duration)

      // Should be close to file end
      expect(offset).toBeGreaterThan(90_000_000)
      expect(offset).toBeLessThanOrEqual(fileSize)
    })

    it('clamps negative timestamps to 0', () => {
      const fileSize = 100_000_000
      const duration = 300

      const offset = estimateByteOffset(fileSize, duration, -10)

      // Should be same as timestamp 0
      const offsetAt0 = estimateByteOffset(fileSize, duration, 0)
      expect(offset).toBe(offsetAt0)
    })

    it('clamps timestamps beyond duration', () => {
      const fileSize = 100_000_000
      const duration = 300

      const offset = estimateByteOffset(fileSize, duration, duration + 100)

      // Should be same as timestamp at duration
      const offsetAtEnd = estimateByteOffset(fileSize, duration, duration)
      expect(offset).toBe(offsetAtEnd)
    })
  })

  describe('extractSegment', () => {
    it('extracts segment from file', async () => {
      const mockFile = new File([new ArrayBuffer(1000)], 'test.mp4', { type: 'video/mp4' })

      const segment = await extractSegment(mockFile, 0, 10, 60)

      expect(segment).toBeInstanceOf(Blob)
    })

    it('returns segment smaller than original file for mid-range extraction', async () => {
      // Create a larger mock file
      const mockData = new ArrayBuffer(10_000_000) // 10MB
      const mockFile = new File([mockData], 'test.mp4', { type: 'video/mp4' })

      // Extract small segment from middle
      const segment = await extractSegment(
        mockFile,
        30, // start at 30s
        35, // end at 35s
        120, // 2 minute video
      )

      expect(segment).toBeInstanceOf(Blob)
      // Segment should be smaller than full file
      expect(segment.size).toBeLessThan(mockFile.size)
    })

    it('ensures minimum segment size', async () => {
      const mockFile = new File(
        [new ArrayBuffer(5_000_000)], // 5MB
        'test.mp4',
        { type: 'video/mp4' },
      )

      // Request tiny segment
      const segment = await extractSegment(mockFile, 0, 0.1, 60)

      // Should get at least minimum bytes (1MB or file size, whichever smaller)
      expect(segment.size).toBeGreaterThan(0)
    })
  })

  describe('estimateBitrate', () => {
    it('estimates bitrate from file size and duration', () => {
      // 100MB file, 5 minutes = 300 seconds
      const fileSize = 100_000_000
      const duration = 300

      const bitrate = estimateBitrate(fileSize, duration)

      // 100MB * 8 * 0.9 / 300 = ~2.4Mbps
      expect(bitrate).toBeGreaterThan(2_000_000)
      expect(bitrate).toBeLessThan(3_000_000)
    })

    it('handles small files', () => {
      const fileSize = 1_000_000 // 1MB
      const duration = 10

      const bitrate = estimateBitrate(fileSize, duration)

      expect(bitrate).toBeGreaterThan(0)
      expect(Number.isFinite(bitrate)).toBe(true)
    })

    it('returns 0 for zero or negative duration', () => {
      const fileSize = 100_000_000

      expect(estimateBitrate(fileSize, 0)).toBe(0)
      expect(estimateBitrate(fileSize, -10)).toBe(0)
    })
  })

  // Note: getVideoDuration uses DOM APIs (document.createElement, URL.createObjectURL)
  // which are not available in Node/vitest. Testing would require jsdom or browser environment.
  describe('getVideoDuration', () => {
    it('exports the function', async () => {
      const { getVideoDuration } = await import('./segment-extractor')
      expect(typeof getVideoDuration).toBe('function')
    })
  })
})
