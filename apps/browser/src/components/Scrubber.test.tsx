/**
 * Scrubber Integration Tests
 *
 * Tests for the Scrubber component's coordinate system handling.
 *
 * BUG: The Scrubber has a coordinate system mismatch:
 * - startTime/endTime are global video times (e.g., clipStart: 45s from original video)
 * - But the extracted blob starts at time 0
 * - video.currentTime returns blob-relative (0-10), but window math uses global times
 *
 * These tests verify:
 * 1. Playhead position calculation with blob-relative video.currentTime
 * 2. Handle position calculation with various global time offsets
 * 3. timeToPosition() behavior with blob-relative vs global times
 * 4. Window calculation edge cases
 *
 * Tests are designed to FAIL with the current broken code and PASS when fixed.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import * as matchers from '@testing-library/jest-dom/matchers'
import { Scrubber } from './Scrubber'
import { RefObject } from 'react'

// Extend Vitest's expect with jest-dom matchers
expect.extend(matchers)

/**
 * Create a mock video element with controllable currentTime and duration.
 * This simulates a video blob that was extracted from a larger video.
 */
interface MockVideoRefOptions {
  /** Duration of the blob (not the original video) */
  blobDuration: number
  /** Current playback position within the blob (0 to blobDuration) */
  currentTime?: number
}

function createMockVideoRef(options: MockVideoRefOptions): RefObject<HTMLVideoElement> {
  const { blobDuration, currentTime = 0 } = options

  const listeners: Record<string, Array<(e: Event) => void>> = {}
  let _currentTime = currentTime

  const mockVideo = {
    duration: blobDuration,
    get currentTime() {
      return _currentTime
    },
    set currentTime(value: number) {
      _currentTime = value
      // Dispatch timeupdate event
      if (listeners['timeupdate']) {
        listeners['timeupdate'].forEach(fn => fn(new Event('timeupdate')))
      }
    },
    addEventListener: vi.fn((event: string, handler: (e: Event) => void) => {
      if (!listeners[event]) {
        listeners[event] = []
      }
      listeners[event].push(handler)
    }),
    removeEventListener: vi.fn((event: string, handler: (e: Event) => void) => {
      if (listeners[event]) {
        const index = listeners[event].indexOf(handler)
        if (index > -1) {
          listeners[event].splice(index, 1)
        }
      }
    }),
    // Helper to simulate loaded metadata
    dispatchLoadedMetadata: () => {
      if (listeners['loadedmetadata']) {
        listeners['loadedmetadata'].forEach(fn => fn(new Event('loadedmetadata')))
      }
    },
    // Helper to simulate time update
    dispatchTimeUpdate: () => {
      if (listeners['timeupdate']) {
        listeners['timeupdate'].forEach(fn => fn(new Event('timeupdate')))
      }
    },
  } as unknown as HTMLVideoElement & {
    dispatchLoadedMetadata: () => void
    dispatchTimeUpdate: () => void
  }

  return { current: mockVideo } as RefObject<HTMLVideoElement>
}

describe('Scrubber Coordinate System', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  describe('Playhead Position with Blob-Relative Times', () => {
    /**
     * SCENARIO: Video blob extracted from 45-55s of original video
     * - Blob duration: 10s (video.duration = 10)
     * - Global clip times: clipStart=45, clipEnd=55
     * - video.currentTime returns 0-10 (blob-relative)
     *
     * BUG: If we pass global times (45-55) to Scrubber, the window calculation
     * uses windowStart=40 (45-5 padding). When video.currentTime=0 (start of blob),
     * timeToPosition calculates: (0-40)/15 * 100 = -267%, which is clamped to 0.
     * The playhead appears stuck at the start.
     *
     * FIX: Either:
     * a) Pass blob-relative times (0-10) to Scrubber, or
     * b) Convert video.currentTime to global time before using
     */
    it('should position playhead correctly when video is at start of blob', async () => {
      const videoRef = createMockVideoRef({
        blobDuration: 10, // Blob is 10 seconds
        currentTime: 0, // At start of blob
      })

      const onTimeUpdate = vi.fn()

      // BUG REPRODUCTION: Pass global times to Scrubber
      // In the real app, ClipReview passes currentShot.clipStart and clipEnd
      // which are global times (45-55), not blob-relative (0-10)
      const globalClipStart = 45
      const globalClipEnd = 55

      render(
        <Scrubber
          videoRef={videoRef}
          startTime={globalClipStart}
          endTime={globalClipEnd}
          onTimeUpdate={onTimeUpdate}
        />
      )

      // Trigger metadata load to set duration
      act(() => {
        (videoRef.current as unknown as { dispatchLoadedMetadata: () => void }).dispatchLoadedMetadata()
      })

      // Find the playhead element
      const playhead = document.querySelector('.scrubber-playhead')
      expect(playhead).not.toBeNull()

      // Get the playhead's left position
      const playheadStyle = playhead?.getAttribute('style')

      // BUG CHECK: With the bug, timeToPosition(0) yields:
      // windowStart = max(0, 45-5) = 40
      // windowDuration = min(10+50, 55+5) - 40 = 60 - 40 = 20 (WRONG - uses blob duration incorrectly)
      // Actually with duration=10: windowEnd = min(10, 55+5) = 10, so windowDuration = 10-40 = -30 (broken!)
      //
      // The playhead position should be at the start of the selected region.
      // If clipStart=45 and windowStart=40, then startPos = (45-40)/windowDuration * 100
      //
      // EXPECTED (when fixed): Playhead should be at ~33% (start of 45s clip in 40-60s window)
      // or if using blob-relative times: at ~0% for time 0 in window 0-10
      //
      // With blob-relative times (correct fix):
      // startTime=0, endTime=10, video.currentTime=0
      // windowStart = max(0, 0-5) = 0 (can't go negative)
      // windowEnd = min(10, 10+5) = 10 (capped at duration)
      // playheadPos = (0-0)/(10-0) * 100 = 0%

      // The playhead should NOT be stuck at 0% due to clamping negative values
      // This test checks that we don't have the coordinate mismatch bug
      expect(playheadStyle).toContain('left:')

      // Extract the percentage from style
      const leftMatch = playheadStyle?.match(/left:\s*([\d.]+)%/)
      expect(leftMatch).not.toBeNull()

      const leftPercent = parseFloat(leftMatch![1])

      // With the bug, playhead is clamped to 0 regardless of actual position
      // With the fix (blob-relative times), playhead at video.currentTime=0
      // should be at the start handle position
      //
      // If startTime is passed as global (45s), this will fail because
      // the start handle will be at a calculated position that doesn't match
      // the playhead position (which uses blob-relative currentTime)
      //
      // We expect playhead to be at the start of the clip region
      // which means leftPercent should match where the start handle is
      const startHandle = document.querySelector('.scrubber-handle-start')
      const startHandleStyle = startHandle?.getAttribute('style')
      const startMatch = startHandleStyle?.match(/left:\s*([\d.]+)%/)
      const startPercent = parseFloat(startMatch?.[1] ?? '0')

      // KEY ASSERTION: Playhead should be at clip start when video.currentTime = 0
      // and clip represents the beginning of the blob
      // With the bug, these won't match because of the coordinate mismatch
      expect(leftPercent).toBeCloseTo(startPercent, 1)
    })

    it('should position playhead at middle of clip when video is at middle of blob', async () => {
      const videoRef = createMockVideoRef({
        blobDuration: 10,
        currentTime: 5, // Middle of blob
      })

      const onTimeUpdate = vi.fn()

      // Using blob-relative times (the correct approach)
      // If the component is fixed, it should accept blob-relative times
      // and position the playhead correctly in the middle
      render(
        <Scrubber
          videoRef={videoRef}
          startTime={0} // Blob-relative start
          endTime={10} // Blob-relative end
          onTimeUpdate={onTimeUpdate}
        />
      )

      act(() => {
        (videoRef.current as unknown as { dispatchLoadedMetadata: () => void }).dispatchLoadedMetadata()
      })

      // NOTE: The Scrubber initializes currentTime from startTime prop,
      // so we need to dispatch a timeupdate event to sync with video.currentTime
      act(() => {
        (videoRef.current as unknown as { dispatchTimeUpdate: () => void }).dispatchTimeUpdate()
      })

      const playhead = document.querySelector('.scrubber-playhead')
      const playheadStyle = playhead?.getAttribute('style')
      const leftMatch = playheadStyle?.match(/left:\s*([\d.]+)%/)
      const leftPercent = parseFloat(leftMatch?.[1] ?? '0')

      // With window padding of 5s:
      // windowStart = max(0, 0-5) = 0
      // windowEnd = min(10, 10+5) = 10 (capped by duration)
      // windowDuration = 10
      // playheadPos = (5-0)/10 * 100 = 50%
      expect(leftPercent).toBeCloseTo(50, 1)
    })

    it('should track playhead position during video playback', async () => {
      const videoRef = createMockVideoRef({
        blobDuration: 10,
        currentTime: 0,
      })

      const onTimeUpdate = vi.fn()

      render(
        <Scrubber
          videoRef={videoRef}
          startTime={0}
          endTime={10}
          onTimeUpdate={onTimeUpdate}
        />
      )

      act(() => {
        (videoRef.current as unknown as { dispatchLoadedMetadata: () => void }).dispatchLoadedMetadata()
      })

      // Simulate video playback - move to 2.5s
      act(() => {
        (videoRef.current as unknown as { currentTime: number }).currentTime = 2.5
      })

      const playhead = document.querySelector('.scrubber-playhead')
      const playheadStyle = playhead?.getAttribute('style')
      const leftMatch = playheadStyle?.match(/left:\s*([\d.]+)%/)
      const leftPercent = parseFloat(leftMatch?.[1] ?? '0')

      // playheadPos = (2.5-0)/10 * 100 = 25%
      expect(leftPercent).toBeCloseTo(25, 1)
    })
  })

  describe('Handle Position Calculation', () => {
    /**
     * When using global times with a blob that starts at 0, the handle
     * positions will be calculated incorrectly.
     */
    it('should position start and end handles correctly with blob-relative times', () => {
      const videoRef = createMockVideoRef({
        blobDuration: 10,
        currentTime: 0,
      })

      const onTimeUpdate = vi.fn()

      render(
        <Scrubber
          videoRef={videoRef}
          startTime={2} // Trim start at 2s into blob
          endTime={8} // Trim end at 8s into blob
          onTimeUpdate={onTimeUpdate}
        />
      )

      act(() => {
        (videoRef.current as unknown as { dispatchLoadedMetadata: () => void }).dispatchLoadedMetadata()
      })

      const startHandle = document.querySelector('.scrubber-handle-start')
      const endHandle = document.querySelector('.scrubber-handle-end')

      const startStyle = startHandle?.getAttribute('style')
      const endStyle = endHandle?.getAttribute('style')

      const startMatch = startStyle?.match(/left:\s*([\d.]+)%/)
      const endMatch = endStyle?.match(/left:\s*([\d.]+)%/)

      const startPercent = parseFloat(startMatch?.[1] ?? '0')
      const endPercent = parseFloat(endMatch?.[1] ?? '0')

      // With window padding of 5s:
      // windowStart = max(0, 2-5) = 0
      // windowEnd = min(10, 8+5) = 10 (capped by duration=10)
      // windowDuration = 10
      // startPos = (2-0)/10 * 100 = 20%
      // endPos = (8-0)/10 * 100 = 80%
      expect(startPercent).toBeCloseTo(20, 1)
      expect(endPercent).toBeCloseTo(80, 1)
    })

    // Defensive: Scrubber expands its window to accommodate global times
    // Primary fix is in ClipReview (converts to blob-relative), but Scrubber handles it gracefully
    it('should have distinct handle positions when global times are passed', () => {
      const videoRef = createMockVideoRef({
        blobDuration: 10, // Blob is 10 seconds (extracted from 45-55s)
        currentTime: 0,
      })

      const onTimeUpdate = vi.fn()

      // BUG REPRODUCTION: Pass global times
      // This simulates the real bug where ClipReview passes clipStart/clipEnd
      // which are global times from the original video
      render(
        <Scrubber
          videoRef={videoRef}
          startTime={45} // Global time
          endTime={55} // Global time
          onTimeUpdate={onTimeUpdate}
        />
      )

      act(() => {
        (videoRef.current as unknown as { dispatchLoadedMetadata: () => void }).dispatchLoadedMetadata()
      })

      const startHandle = document.querySelector('.scrubber-handle-start')
      const endHandle = document.querySelector('.scrubber-handle-end')

      const startStyle = startHandle?.getAttribute('style')
      const endStyle = endHandle?.getAttribute('style')

      const startMatch = startStyle?.match(/left:\s*([\d.]+)%/)
      const endMatch = endStyle?.match(/left:\s*([\d.]+)%/)

      const startPercent = parseFloat(startMatch?.[1] ?? '0')
      const endPercent = parseFloat(endMatch?.[1] ?? '0')

      // With the BUG:
      // windowStart = max(0, 45-5) = 40
      // windowEnd = min(10, 55+5) = 10 (!!!)
      // windowDuration = 10 - 40 = -30 (NEGATIVE!)
      //
      // timeToPosition(45) = (45-40)/(-30) * 100 = -16.67% -> clamped to 0%
      // timeToPosition(55) = (55-40)/(-30) * 100 = -50% -> clamped to 0%
      //
      // Both handles end up at 0%!

      // KEY ASSERTION: Start and end handles should be at DIFFERENT positions
      // With the bug, both are clamped to the same boundary (0% or 100%)
      // This makes the scrubber completely unusable

      // If the scrubber is working correctly, the end handle must be
      // positioned to the right of the start handle
      expect(endPercent).toBeGreaterThan(startPercent)
    })
  })

  describe('Window Calculation Edge Cases', () => {
    it('should handle clip at start of video (no padding before)', () => {
      const videoRef = createMockVideoRef({
        blobDuration: 10,
        currentTime: 0,
      })

      const onTimeUpdate = vi.fn()

      render(
        <Scrubber
          videoRef={videoRef}
          startTime={0} // At very start
          endTime={5}
          onTimeUpdate={onTimeUpdate}
        />
      )

      act(() => {
        (videoRef.current as unknown as { dispatchLoadedMetadata: () => void }).dispatchLoadedMetadata()
      })

      // windowStart = max(0, 0-5) = 0 (can't go negative)
      // windowEnd = min(10, 5+5) = 10
      // Start handle should be at 0%
      const startHandle = document.querySelector('.scrubber-handle-start')
      const startStyle = startHandle?.getAttribute('style')
      const startMatch = startStyle?.match(/left:\s*([\d.]+)%/)
      const startPercent = parseFloat(startMatch?.[1] ?? '-1')

      expect(startPercent).toBe(0)
    })

    it('should handle clip at end of video (no padding after)', () => {
      const videoRef = createMockVideoRef({
        blobDuration: 10,
        currentTime: 5,
      })

      const onTimeUpdate = vi.fn()

      render(
        <Scrubber
          videoRef={videoRef}
          startTime={5}
          endTime={10} // At very end
          onTimeUpdate={onTimeUpdate}
        />
      )

      act(() => {
        (videoRef.current as unknown as { dispatchLoadedMetadata: () => void }).dispatchLoadedMetadata()
      })

      // windowStart = max(0, 5-5) = 0
      // windowEnd = min(10, 10+5) = 10 (capped by duration)
      // End handle should be at 100%
      const endHandle = document.querySelector('.scrubber-handle-end')
      const endStyle = endHandle?.getAttribute('style')
      const endMatch = endStyle?.match(/left:\s*([\d.]+)%/)
      const endPercent = parseFloat(endMatch?.[1] ?? '-1')

      expect(endPercent).toBe(100)
    })

    it('should display correct time labels', () => {
      const videoRef = createMockVideoRef({
        blobDuration: 10,
        currentTime: 3,
      })

      const onTimeUpdate = vi.fn()

      render(
        <Scrubber
          videoRef={videoRef}
          startTime={2}
          endTime={8}
          onTimeUpdate={onTimeUpdate}
        />
      )

      act(() => {
        (videoRef.current as unknown as { dispatchLoadedMetadata: () => void }).dispatchLoadedMetadata()
      })

      // Find time labels
      const labels = document.querySelectorAll('.scrubber-label-start, .scrubber-label-end, .scrubber-label-current')
      expect(labels.length).toBe(3)

      // Check that we have reasonable time displays (should be low numbers for blob-relative)
      // If using global times (bug), we'd see times like "0:40" instead of "0:00"
      const labelTexts = Array.from(labels).map(l => l.textContent)

      // windowStart should be 0 (max(0, 2-5)), so first label should show 0:00.xx
      expect(labelTexts[0]).toMatch(/^0:0[0-5]/)
    })
  })

  describe('Time-Position Conversion Functions', () => {
    /**
     * These tests verify the internal timeToPosition and positionToTime functions
     * work correctly when times and positions are in the same coordinate system.
     */
    it('should convert time to position and back consistently', () => {
      const videoRef = createMockVideoRef({
        blobDuration: 10,
        currentTime: 0,
      })

      const onTimeUpdate = vi.fn()

      render(
        <Scrubber
          videoRef={videoRef}
          startTime={2}
          endTime={8}
          onTimeUpdate={onTimeUpdate}
        />
      )

      act(() => {
        (videoRef.current as unknown as { dispatchLoadedMetadata: () => void }).dispatchLoadedMetadata()
      })

      // The scrubber should show a selection region between start and end handles
      const selection = document.querySelector('.scrubber-selection')
      const selectionStyle = selection?.getAttribute('style')

      // Selection should span from start handle to end handle
      // left should match start handle position
      // width should be (endPos - startPos)%
      const leftMatch = selectionStyle?.match(/left:\s*([\d.]+)%/)
      const widthMatch = selectionStyle?.match(/width:\s*([\d.]+)%/)

      const left = parseFloat(leftMatch?.[1] ?? '0')
      const width = parseFloat(widthMatch?.[1] ?? '0')

      // start: 20%, end: 80%, so width should be 60%
      expect(left).toBeCloseTo(20, 1)
      expect(width).toBeCloseTo(60, 1)
    })
  })

  describe('Integration with ClipReview Timing', () => {
    /**
     * This test simulates how ClipReview actually uses the Scrubber.
     *
     * In ClipReview:
     * - currentShot.startTime = segment extraction start (e.g., 40s)
     * - currentShot.endTime = segment extraction end (e.g., 60s)
     * - currentShot.clipStart = trim start within segment (e.g., 45s)
     * - currentShot.clipEnd = trim end within segment (e.g., 55s)
     * - currentShot.strikeTime = audio transient time (e.g., 47s)
     *
     * The video blob contains 40-60s of the original video, but blob starts at 0.
     * So video.currentTime of 5 means we're at 45s in the original video.
     *
     * ClipReview passes clipStart and clipEnd to Scrubber, which are GLOBAL times.
     * This is the root cause of the bug.
     */
    it('should correctly display a mid-video clip with real-world timing', () => {
      // Simulate a 20-second blob extracted from 40s-60s of original video
      const videoRef = createMockVideoRef({
        blobDuration: 20, // segment is 20 seconds
        currentTime: 5, // 5 seconds into blob = 45s in original
      })

      const onTimeUpdate = vi.fn()

      // THE BUG: ClipReview currently passes these global times:
      // startTime={currentShot.clipStart} // e.g., 45
      // endTime={currentShot.clipEnd} // e.g., 55

      // THE FIX: Should pass blob-relative times:
      // startTime={currentShot.clipStart - currentShot.startTime} // 45-40 = 5
      // endTime={currentShot.clipEnd - currentShot.startTime} // 55-40 = 15

      // Test with CORRECT (blob-relative) times
      const segmentStart = 40 // Global time where blob begins
      const globalClipStart = 45
      const globalClipEnd = 55

      const blobRelativeClipStart = globalClipStart - segmentStart // 5
      const blobRelativeClipEnd = globalClipEnd - segmentStart // 15

      render(
        <Scrubber
          videoRef={videoRef}
          startTime={blobRelativeClipStart}
          endTime={blobRelativeClipEnd}
          onTimeUpdate={onTimeUpdate}
        />
      )

      act(() => {
        (videoRef.current as unknown as { dispatchLoadedMetadata: () => void }).dispatchLoadedMetadata()
      })

      // With blob-relative times:
      // windowStart = max(0, 5-5) = 0
      // windowEnd = min(20, 15+5) = 20
      // windowDuration = 20
      //
      // Start handle: (5-0)/20 * 100 = 25%
      // End handle: (15-0)/20 * 100 = 75%
      // Playhead (at currentTime=5): (5-0)/20 * 100 = 25%

      const startHandle = document.querySelector('.scrubber-handle-start')
      const endHandle = document.querySelector('.scrubber-handle-end')
      const playhead = document.querySelector('.scrubber-playhead')

      const startStyle = startHandle?.getAttribute('style')
      const endStyle = endHandle?.getAttribute('style')
      const playheadStyle = playhead?.getAttribute('style')

      const startPercent = parseFloat(startStyle?.match(/left:\s*([\d.]+)%/)?.[1] ?? '0')
      const endPercent = parseFloat(endStyle?.match(/left:\s*([\d.]+)%/)?.[1] ?? '0')
      const playheadPercent = parseFloat(playheadStyle?.match(/left:\s*([\d.]+)%/)?.[1] ?? '0')

      expect(startPercent).toBeCloseTo(25, 1)
      expect(endPercent).toBeCloseTo(75, 1)
      expect(playheadPercent).toBeCloseTo(25, 1) // Playhead at start of clip
    })

    // Defensive: Scrubber expands its window to accommodate global times
    // Primary fix is in ClipReview (converts to blob-relative), but Scrubber handles it gracefully
    it('should have handles with positive separation when using global times', () => {
      // Same scenario but with GLOBAL times (the bug)
      const videoRef = createMockVideoRef({
        blobDuration: 20,
        currentTime: 5, // 5 seconds into blob
      })

      const onTimeUpdate = vi.fn()

      // BUG: Passing global times
      render(
        <Scrubber
          videoRef={videoRef}
          startTime={45} // GLOBAL TIME - BUG!
          endTime={55} // GLOBAL TIME - BUG!
          onTimeUpdate={onTimeUpdate}
        />
      )

      act(() => {
        (videoRef.current as unknown as { dispatchLoadedMetadata: () => void }).dispatchLoadedMetadata()
      })

      // With global times (BUG):
      // windowStart = max(0, 45-5) = 40
      // windowEnd = min(20, 55+5) = 20 (capped by blob duration!)
      // windowDuration = 20 - 40 = -20 (NEGATIVE!)
      //
      // timeToPosition(45) = (45-40)/(-20) * 100 = -25% -> clamped to 0%
      // timeToPosition(55) = (55-40)/(-20) * 100 = -75% -> clamped to 0%
      // timeToPosition(5) [currentTime] = (5-40)/(-20) * 100 = 175% -> clamped to 100%

      const startHandle = document.querySelector('.scrubber-handle-start')
      const endHandle = document.querySelector('.scrubber-handle-end')

      const startStyle = startHandle?.getAttribute('style')
      const endStyle = endHandle?.getAttribute('style')

      const startPercent = parseFloat(startStyle?.match(/left:\s*([\d.]+)%/)?.[1] ?? '-1')
      const endPercent = parseFloat(endStyle?.match(/left:\s*([\d.]+)%/)?.[1] ?? '-1')

      // KEY ASSERTION: The end handle must be positioned after the start handle
      // With the bug, both handles are clamped to 0% making the scrubber unusable
      // A working scrubber MUST have: endPercent > startPercent
      expect(endPercent).toBeGreaterThan(startPercent)

      // Also verify the selection region has positive width
      const selection = document.querySelector('.scrubber-selection')
      const selectionStyle = selection?.getAttribute('style')
      const widthMatch = selectionStyle?.match(/width:\s*([\d.]+)%/)
      const widthPercent = parseFloat(widthMatch?.[1] ?? '0')

      // Selection width = endPercent - startPercent, must be positive
      expect(widthPercent).toBeGreaterThan(0)
    })
  })

  describe('Scrubber Disabled State', () => {
    it('should apply disabled class when disabled prop is true', () => {
      const videoRef = createMockVideoRef({
        blobDuration: 10,
        currentTime: 0,
      })

      const onTimeUpdate = vi.fn()

      render(
        <Scrubber
          videoRef={videoRef}
          startTime={0}
          endTime={10}
          onTimeUpdate={onTimeUpdate}
          disabled={true}
        />
      )

      const container = document.querySelector('.scrubber-container')
      expect(container?.classList.contains('scrubber-disabled')).toBe(true)
    })
  })

  describe('Clip Duration Display', () => {
    it('should display correct clip duration in info section', () => {
      const videoRef = createMockVideoRef({
        blobDuration: 10,
        currentTime: 0,
      })

      const onTimeUpdate = vi.fn()

      render(
        <Scrubber
          videoRef={videoRef}
          startTime={2}
          endTime={8}
          onTimeUpdate={onTimeUpdate}
        />
      )

      act(() => {
        (videoRef.current as unknown as { dispatchLoadedMetadata: () => void }).dispatchLoadedMetadata()
      })

      // Find clip duration display
      const clipInfo = document.querySelector('.scrubber-clip-duration')
      expect(clipInfo).not.toBeNull()

      // Should show duration of 6 seconds (8-2)
      expect(clipInfo?.textContent).toContain('6.0s')
    })

    it('should display clip times in info section', () => {
      const videoRef = createMockVideoRef({
        blobDuration: 10,
        currentTime: 0,
      })

      const onTimeUpdate = vi.fn()

      render(
        <Scrubber
          videoRef={videoRef}
          startTime={2}
          endTime={8}
          onTimeUpdate={onTimeUpdate}
        />
      )

      const clipInfo = document.querySelector('.scrubber-clip-duration')

      // Should show start and end times
      // With blob-relative times (2s, 8s), should show "0:02.xx - 0:08.xx"
      expect(clipInfo?.textContent).toMatch(/0:02/)
      expect(clipInfo?.textContent).toMatch(/0:08/)
    })
  })
})
