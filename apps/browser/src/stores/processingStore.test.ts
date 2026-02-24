/**
 * Processing Store Tests
 *
 * Tests for the Zustand processing store, particularly segment management
 * and the auto-approval logic for high-confidence shots.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useProcessingStore } from './processingStore'

// Mock URL.revokeObjectURL which isn't available in jsdom
vi.stubGlobal('URL', {
  ...URL,
  revokeObjectURL: vi.fn(),
  createObjectURL: vi.fn(() => 'blob:mock-url'),
})

describe('processingStore', () => {
  beforeEach(() => {
    // Reset store state between tests
    useProcessingStore.getState().reset()
  })

  describe('addSegment', () => {
    it('should auto-approve high-confidence segments (>= 0.7)', () => {
      const store = useProcessingStore.getState()

      // Create a mock blob and object URL
      const mockBlob = new Blob(['test'], { type: 'video/webm' })
      const mockObjectUrl = 'blob:http://localhost/mock-high-conf'

      store.addSegment({
        id: 'segment-high-conf',
        strikeTime: 5.0,
        startTime: 3.0,
        endTime: 8.0,
        blob: mockBlob,
        objectUrl: mockObjectUrl,
        confidence: 0.75, // High confidence - should auto-approve
      })

      const segments = useProcessingStore.getState().segments
      expect(segments).toHaveLength(1)
      expect(segments[0].approved).toBe('approved')
    })

    it('should leave low-confidence segments as pending (< 0.7)', () => {
      const store = useProcessingStore.getState()

      const mockBlob = new Blob(['test'], { type: 'video/webm' })
      const mockObjectUrl = 'blob:http://localhost/mock-low-conf'

      store.addSegment({
        id: 'segment-low-conf',
        strikeTime: 5.0,
        startTime: 3.0,
        endTime: 8.0,
        blob: mockBlob,
        objectUrl: mockObjectUrl,
        confidence: 0.5, // Low confidence - should remain pending
      })

      const segments = useProcessingStore.getState().segments
      expect(segments).toHaveLength(1)
      expect(segments[0].approved).toBe('pending')
    })

    it('should leave boundary confidence (0.7) as approved', () => {
      const store = useProcessingStore.getState()

      const mockBlob = new Blob(['test'], { type: 'video/webm' })
      const mockObjectUrl = 'blob:http://localhost/mock-boundary'

      store.addSegment({
        id: 'segment-boundary',
        strikeTime: 5.0,
        startTime: 3.0,
        endTime: 8.0,
        blob: mockBlob,
        objectUrl: mockObjectUrl,
        confidence: 0.7, // Exactly at threshold - should auto-approve
      })

      const segments = useProcessingStore.getState().segments
      expect(segments).toHaveLength(1)
      expect(segments[0].approved).toBe('approved')
    })

    it('should respect explicitly passed approved status', () => {
      const store = useProcessingStore.getState()

      const mockBlob = new Blob(['test'], { type: 'video/webm' })
      const mockObjectUrl = 'blob:http://localhost/mock-explicit'

      // Explicitly pass 'rejected' even though confidence is high
      store.addSegment({
        id: 'segment-explicit',
        strikeTime: 5.0,
        startTime: 3.0,
        endTime: 8.0,
        blob: mockBlob,
        objectUrl: mockObjectUrl,
        confidence: 0.9,
        approved: 'rejected', // Explicit status should be preserved
      })

      const segments = useProcessingStore.getState().segments
      expect(segments).toHaveLength(1)
      expect(segments[0].approved).toBe('rejected')
    })

    it('should default confidence to 0.5 when not provided', () => {
      const store = useProcessingStore.getState()

      const mockBlob = new Blob(['test'], { type: 'video/webm' })
      const mockObjectUrl = 'blob:http://localhost/mock-no-conf'

      store.addSegment({
        id: 'segment-no-conf',
        strikeTime: 5.0,
        startTime: 3.0,
        endTime: 8.0,
        blob: mockBlob,
        objectUrl: mockObjectUrl,
        // No confidence provided - defaults to 0.5, so should be pending
      })

      const segments = useProcessingStore.getState().segments
      expect(segments).toHaveLength(1)
      expect(segments[0].confidence).toBe(0.5)
      expect(segments[0].approved).toBe('pending')
    })
  })
})
