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
  const mockBlob = new Blob(['test'], { type: 'video/webm' })
  const mockObjectUrl = 'blob:http://localhost/mock'

  beforeEach(() => {
    // Reset store state between tests
    useProcessingStore.getState().reset()
  })

  describe('setStatus', () => {
    it('updates status', () => {
      const store = useProcessingStore.getState()
      store.setStatus('processing')
      expect(useProcessingStore.getState().status).toBe('processing')
    })
  })

  describe('setError', () => {
    it('sets error and status to error', () => {
      const store = useProcessingStore.getState()
      store.setError('Something failed')
      const state = useProcessingStore.getState()
      expect(state.error).toBe('Something failed')
      expect(state.status).toBe('error')
    })

    it('clears error and resets status to idle', () => {
      const store = useProcessingStore.getState()
      store.setError('fail')
      store.setError(null)
      const state = useProcessingStore.getState()
      expect(state.error).toBeNull()
      expect(state.status).toBe('idle')
    })
  })

  describe('setProgress', () => {
    it('updates progress and message', () => {
      const store = useProcessingStore.getState()
      store.setProgress(50, 'Halfway done')
      const state = useProcessingStore.getState()
      expect(state.progress).toBe(50)
      expect(state.progressMessage).toBe('Halfway done')
    })

    it('defaults message to empty string', () => {
      const store = useProcessingStore.getState()
      store.setProgress(75)
      expect(useProcessingStore.getState().progressMessage).toBe('')
    })
  })

  describe('addStrike', () => {
    it('appends a strike to the list', () => {
      const store = useProcessingStore.getState()
      const strike = {
        timestamp: 5.0,
        confidence: 0.8,
        spectralCentroid: 3500,
        spectralFlatness: 0.3,
        onsetStrength: 0.7,
        decayRatio: 0.4,
      }
      store.addStrike(strike)
      expect(useProcessingStore.getState().strikes).toHaveLength(1)
      expect(useProcessingStore.getState().strikes[0].timestamp).toBe(5.0)
    })
  })

  describe('setCurrentSegment', () => {
    it('updates current segment index', () => {
      const store = useProcessingStore.getState()
      store.setCurrentSegment(3)
      expect(useProcessingStore.getState().currentSegmentIndex).toBe(3)
    })
  })

  describe('setFileInfo', () => {
    it('sets file name and duration', () => {
      const store = useProcessingStore.getState()
      store.setFileInfo('video.mp4', 120.5)
      const state = useProcessingStore.getState()
      expect(state.fileName).toBe('video.mp4')
      expect(state.fileDuration).toBe(120.5)
    })
  })

  describe('updateSegment', () => {
    it('updates a specific segment by id', () => {
      const store = useProcessingStore.getState()
      store.addSegment({
        id: 'seg-1',
        strikeTime: 5,
        startTime: 0,
        endTime: 10,
        blob: mockBlob,
        objectUrl: mockObjectUrl,
      })
      store.updateSegment('seg-1', { clipStart: 2, clipEnd: 8 })
      const seg = useProcessingStore.getState().segments[0]
      expect(seg.clipStart).toBe(2)
      expect(seg.clipEnd).toBe(8)
    })
  })

  describe('approveSegment', () => {
    it('marks segment as approved', () => {
      const store = useProcessingStore.getState()
      store.addSegment({
        id: 'seg-1',
        strikeTime: 5,
        startTime: 0,
        endTime: 10,
        blob: mockBlob,
        objectUrl: mockObjectUrl,
        confidence: 0.3,
      })
      expect(useProcessingStore.getState().segments[0].approved).toBe('pending')
      store.approveSegment('seg-1')
      expect(useProcessingStore.getState().segments[0].approved).toBe('approved')
    })
  })

  describe('rejectSegment', () => {
    it('marks segment as rejected', () => {
      const store = useProcessingStore.getState()
      store.addSegment({
        id: 'seg-1',
        strikeTime: 5,
        startTime: 0,
        endTime: 10,
        blob: mockBlob,
        objectUrl: mockObjectUrl,
      })
      store.rejectSegment('seg-1')
      expect(useProcessingStore.getState().segments[0].approved).toBe('rejected')
    })
  })

  describe('multi-video: addVideo / removeVideo / setActiveVideo', () => {
    it('adds a video and sets it as active', () => {
      const store = useProcessingStore.getState()
      store.addVideo('v1', 'clip1.mp4')
      const state = useProcessingStore.getState()
      expect(state.videos.size).toBe(1)
      expect(state.activeVideoId).toBe('v1')
      expect(state.videos.get('v1')!.fileName).toBe('clip1.mp4')
    })

    it('removes a video and updates active', () => {
      const store = useProcessingStore.getState()
      store.addVideo('v1', 'clip1.mp4')
      store.addVideo('v2', 'clip2.mp4')
      store.setActiveVideo('v1')
      store.removeVideo('v1')
      const state = useProcessingStore.getState()
      expect(state.videos.size).toBe(1)
      expect(state.videos.has('v1')).toBe(false)
    })

    it('setActiveVideo changes active video', () => {
      const store = useProcessingStore.getState()
      store.addVideo('v1', 'a.mp4')
      store.addVideo('v2', 'b.mp4')
      store.setActiveVideo('v2')
      expect(useProcessingStore.getState().activeVideoId).toBe('v2')
    })
  })

  describe('multi-video: setVideoProgress / setVideoStatus / setVideoError', () => {
    it('sets video progress', () => {
      const store = useProcessingStore.getState()
      store.addVideo('v1', 'a.mp4')
      store.setVideoProgress('v1', 42, 'Processing...')
      const video = useProcessingStore.getState().videos.get('v1')!
      expect(video.progress).toBe(42)
      expect(video.progressMessage).toBe('Processing...')
    })

    it('sets video status', () => {
      const store = useProcessingStore.getState()
      store.addVideo('v1', 'a.mp4')
      store.setVideoStatus('v1', 'processing')
      expect(useProcessingStore.getState().videos.get('v1')!.status).toBe('processing')
    })

    it('sets video error', () => {
      const store = useProcessingStore.getState()
      store.addVideo('v1', 'a.mp4')
      store.setVideoError('v1', 'Failed')
      const video = useProcessingStore.getState().videos.get('v1')!
      expect(video.error).toBe('Failed')
      expect(video.status).toBe('error')
    })

    it('ignores updates for non-existent video', () => {
      const store = useProcessingStore.getState()
      store.setVideoProgress('nonexistent', 50, 'test')
      // Should not throw
      expect(useProcessingStore.getState().videos.size).toBe(0)
    })
  })

  describe('multi-video: addVideoStrike / addVideoSegment / setVideoFileInfo', () => {
    it('adds strike to video', () => {
      const store = useProcessingStore.getState()
      store.addVideo('v1', 'a.mp4')
      store.addVideoStrike('v1', {
        timestamp: 3.0,
        confidence: 0.9,
        spectralCentroid: 3500,
        spectralFlatness: 0.3,
        onsetStrength: 0.8,
        decayRatio: 0.3,
      })
      expect(useProcessingStore.getState().videos.get('v1')!.strikes).toHaveLength(1)
    })

    it('adds segment to video with auto-approval', () => {
      const store = useProcessingStore.getState()
      store.addVideo('v1', 'a.mp4')
      store.addVideoSegment('v1', {
        id: 'seg-1',
        strikeTime: 5,
        startTime: 0,
        endTime: 10,
        blob: mockBlob,
        objectUrl: mockObjectUrl,
        confidence: 0.8,
      })
      const seg = useProcessingStore.getState().videos.get('v1')!.segments[0]
      expect(seg.approved).toBe('approved')
    })

    it('sets video file info', () => {
      const store = useProcessingStore.getState()
      store.addVideo('v1', 'a.mp4')
      store.setVideoFileInfo('v1', 60.0)
      expect(useProcessingStore.getState().videos.get('v1')!.fileDuration).toBe(60.0)
    })
  })

  describe('multi-video: updateVideoSegment / approveVideoSegment / rejectVideoSegment', () => {
    beforeEach(() => {
      const store = useProcessingStore.getState()
      store.addVideo('v1', 'a.mp4')
      store.addVideoSegment('v1', {
        id: 'seg-1',
        strikeTime: 5,
        startTime: 0,
        endTime: 10,
        blob: mockBlob,
        objectUrl: mockObjectUrl,
        confidence: 0.3,
      })
    })

    it('updates a video segment', () => {
      useProcessingStore.getState().updateVideoSegment('v1', 'seg-1', { clipStart: 2 })
      const seg = useProcessingStore.getState().videos.get('v1')!.segments[0]
      expect(seg.clipStart).toBe(2)
    })

    it('approves a video segment', () => {
      useProcessingStore.getState().approveVideoSegment('v1', 'seg-1')
      const seg = useProcessingStore.getState().videos.get('v1')!.segments[0]
      expect(seg.approved).toBe('approved')
    })

    it('rejects a video segment', () => {
      useProcessingStore.getState().rejectVideoSegment('v1', 'seg-1')
      const seg = useProcessingStore.getState().videos.get('v1')!.segments[0]
      expect(seg.approved).toBe('rejected')
    })
  })

  describe('getVideo', () => {
    it('returns video state by id', () => {
      const store = useProcessingStore.getState()
      store.addVideo('v1', 'a.mp4')
      const video = store.getVideo('v1')
      expect(video).toBeDefined()
      expect(video!.fileName).toBe('a.mp4')
    })

    it('returns undefined for non-existent video', () => {
      const store = useProcessingStore.getState()
      expect(store.getVideo('nonexistent')).toBeUndefined()
    })
  })

  describe('reset', () => {
    it('clears all state back to defaults', () => {
      const store = useProcessingStore.getState()
      store.setStatus('processing')
      store.addStrike({
        timestamp: 1,
        confidence: 0.5,
        spectralCentroid: 3000,
        spectralFlatness: 0.3,
        onsetStrength: 0.5,
        decayRatio: 0.5,
      })
      store.addVideo('v1', 'a.mp4')
      store.reset()
      const state = useProcessingStore.getState()
      expect(state.status).toBe('idle')
      expect(state.strikes).toHaveLength(0)
      expect(state.videos.size).toBe(0)
    })
  })

  describe('createVideoState', () => {
    it('creates default video state', async () => {
      const { createVideoState } = await import('./processingStore')
      const state = createVideoState('v1', 'test.mp4')
      expect(state.id).toBe('v1')
      expect(state.fileName).toBe('test.mp4')
      expect(state.status).toBe('pending')
      expect(state.strikes).toHaveLength(0)
      expect(state.segments).toHaveLength(0)
    })
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
