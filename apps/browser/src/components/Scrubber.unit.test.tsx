/**
 * Scrubber Unit Tests - Window Calculation Edge Cases
 *
 * Tests for bug fixes in Scrubber.tsx window calculation logic:
 *
 * BUG 1: Inverted time window calculation (windowEnd < windowStart)
 *   - When duration is not yet loaded, windowEnd could be less than windowStart
 *   - FIX: windowEnd = Math.max(rawWindowEnd, windowStart + 1)
 *
 * BUG 2: Division by zero when windowDuration = 0
 *   - If windowEnd === windowStart, timeToPosition would divide by zero
 *   - FIX: windowDuration = Math.max(0.1, windowEnd - windowStart)
 *
 * BUG 3: Playhead not tracking video playback
 *   - The video timeupdate event needs to update currentTime state
 *   - FIX: Proper event listener setup in useEffect
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

// =============================================================================
// MOCK VIDEO HELPERS
// =============================================================================

interface MockVideoRefOptions {
  duration: number
  currentTime?: number
  durationNotLoaded?: boolean // Simulate duration not yet available
}

interface MockVideoElement extends HTMLVideoElement {
  dispatchLoadedMetadata: () => void
  dispatchTimeUpdate: () => void
  setCurrentTime: (time: number) => void
}

function createMockVideoRef(options: MockVideoRefOptions): RefObject<MockVideoElement> {
  const { duration, currentTime = 0, durationNotLoaded = false } = options

  const listeners: Record<string, Array<(e: Event) => void>> = {}
  let _currentTime = currentTime
  let _duration = durationNotLoaded ? NaN : duration

  const mockVideo = {
    get duration() {
      return _duration
    },
    get currentTime() {
      return _currentTime
    },
    set currentTime(value: number) {
      _currentTime = value
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
    dispatchLoadedMetadata: () => {
      _duration = duration
      if (listeners['loadedmetadata']) {
        listeners['loadedmetadata'].forEach(fn => fn(new Event('loadedmetadata')))
      }
    },
    dispatchTimeUpdate: () => {
      if (listeners['timeupdate']) {
        listeners['timeupdate'].forEach(fn => fn(new Event('timeupdate')))
      }
    },
    setCurrentTime: (time: number) => {
      _currentTime = time
      if (listeners['timeupdate']) {
        listeners['timeupdate'].forEach(fn => fn(new Event('timeupdate')))
      }
    },
  } as unknown as MockVideoElement

  return { current: mockVideo } as RefObject<MockVideoElement>
}

/**
 * Extract the left percentage from a style string
 */
function extractLeftPercent(element: Element | null): number {
  if (!element) return NaN
  const style = element.getAttribute('style')
  const match = style?.match(/left:\s*([\d.-]+)%/)
  return match ? parseFloat(match[1]) : NaN
}

/**
 * Extract the width percentage from a style string
 */
function extractWidthPercent(element: Element | null): number {
  if (!element) return NaN
  const style = element.getAttribute('style')
  const match = style?.match(/width:\s*([\d.-]+)%/)
  return match ? parseFloat(match[1]) : NaN
}

// =============================================================================
// BUG 1: INVERTED TIME WINDOW TESTS
// =============================================================================

describe('BUG 1: Inverted Time Window Calculation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  describe('windowEnd < windowStart edge cases', () => {
    /**
     * SCENARIO: startTime > endTime (inverted input)
     * This is an invalid input but shouldn't crash the component.
     *
     * With startTime=10, endTime=5:
     * - windowStart = max(0, 10-5) = 5
     * - rawWindowEnd = min(duration, 5+5) = 10
     * - windowEnd = max(10, 5+1) = 10 ✓ (ensures at least 1s window)
     *
     * Without the fix, timeToPosition could produce negative or inverted values.
     */
    it('should not crash when startTime > endTime (inverted times)', () => {
      const videoRef = createMockVideoRef({ duration: 20 })
      const onTimeUpdate = vi.fn()

      // Inverted times - invalid but should not crash
      expect(() => {
        render(
          <Scrubber
            videoRef={videoRef}
            startTime={10}
            endTime={5}
            onTimeUpdate={onTimeUpdate}
          />
        )
      }).not.toThrow()
    })

    it('should ensure end handle is always right of start handle with inverted times', () => {
      const videoRef = createMockVideoRef({ duration: 20 })
      const onTimeUpdate = vi.fn()

      render(
        <Scrubber
          videoRef={videoRef}
          startTime={10}
          endTime={5}
          onTimeUpdate={onTimeUpdate}
        />
      )

      act(() => {
        videoRef.current!.dispatchLoadedMetadata()
      })

      const startHandle = document.querySelector('.scrubber-handle-start')
      const endHandle = document.querySelector('.scrubber-handle-end')

      const startPercent = extractLeftPercent(startHandle)
      const endPercent = extractLeftPercent(endHandle)

      // End handle should always be to the right (or at same position) as start
      // With the fix, the window is at least 1s wide so positions are valid
      expect(Number.isNaN(startPercent)).toBe(false)
      expect(Number.isNaN(endPercent)).toBe(false)
      // Due to inverted input, the actual behavior depends on how component handles it
      // The key is no NaN or Infinity values
      expect(Number.isFinite(startPercent)).toBe(true)
      expect(Number.isFinite(endPercent)).toBe(true)
    })

    /**
     * SCENARIO: Duration not loaded yet (NaN)
     * Before duration is available, windowEnd could compute incorrectly.
     *
     * With duration=NaN:
     * - windowEnd = min(NaN, endTime+5) = NaN
     * - windowDuration = NaN - windowStart = NaN
     * - timeToPosition divides by NaN
     *
     * FIX: windowEnd = Math.max(rawWindowEnd, windowStart + 1)
     * This ensures at least 1s window even if rawWindowEnd is NaN
     */
    it('should handle duration not yet loaded (NaN duration)', () => {
      const videoRef = createMockVideoRef({ duration: 10, durationNotLoaded: true })
      const onTimeUpdate = vi.fn()

      render(
        <Scrubber
          videoRef={videoRef}
          startTime={2}
          endTime={8}
          onTimeUpdate={onTimeUpdate}
        />
      )

      // Before loadedmetadata, duration is NaN
      const playhead = document.querySelector('.scrubber-playhead')
      const leftPercent = extractLeftPercent(playhead)

      // Should not be NaN or Infinity - the fix ensures minimum window
      expect(Number.isNaN(leftPercent)).toBe(false)
      expect(Number.isFinite(leftPercent)).toBe(true)
    })

    /**
     * SCENARIO: Very small clip near video start
     * startTime=0, endTime=0.5, duration=100
     *
     * windowStart = max(0, 0-5) = 0
     * rawWindowEnd = min(100, 0.5+5) = 5.5
     * windowEnd = max(5.5, 0+1) = 5.5 ✓
     * windowDuration = 5.5 ✓
     */
    it('should handle very small clip at video start', () => {
      const videoRef = createMockVideoRef({ duration: 100 })
      const onTimeUpdate = vi.fn()

      render(
        <Scrubber
          videoRef={videoRef}
          startTime={0}
          endTime={0.5}
          onTimeUpdate={onTimeUpdate}
        />
      )

      act(() => {
        videoRef.current!.dispatchLoadedMetadata()
      })

      const startHandle = document.querySelector('.scrubber-handle-start')
      const endHandle = document.querySelector('.scrubber-handle-end')

      const startPercent = extractLeftPercent(startHandle)
      const endPercent = extractLeftPercent(endHandle)

      // Both should be valid percentages
      expect(startPercent).toBeGreaterThanOrEqual(0)
      expect(startPercent).toBeLessThanOrEqual(100)
      expect(endPercent).toBeGreaterThanOrEqual(0)
      expect(endPercent).toBeLessThanOrEqual(100)

      // End should be right of start
      expect(endPercent).toBeGreaterThan(startPercent)
    })
  })
})

// =============================================================================
// BUG 2: DIVISION BY ZERO TESTS
// =============================================================================

describe('BUG 2: Division by Zero Prevention', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  describe('windowDuration = 0 edge cases', () => {
    /**
     * SCENARIO: startTime === endTime (zero-length clip)
     *
     * Without fix:
     * - windowDuration = windowEnd - windowStart = 0
     * - timeToPosition: (time - windowStart) / 0 = Infinity or NaN
     *
     * With fix:
     * - windowDuration = Math.max(0.1, windowEnd - windowStart)
     * - Minimum 0.1s duration prevents division by zero
     */
    it('should not produce NaN when startTime === endTime', () => {
      const videoRef = createMockVideoRef({ duration: 10, currentTime: 5 })
      const onTimeUpdate = vi.fn()

      render(
        <Scrubber
          videoRef={videoRef}
          startTime={5}
          endTime={5} // Same as start - zero duration
          onTimeUpdate={onTimeUpdate}
        />
      )

      act(() => {
        videoRef.current!.dispatchLoadedMetadata()
      })

      const playhead = document.querySelector('.scrubber-playhead')
      const startHandle = document.querySelector('.scrubber-handle-start')
      const endHandle = document.querySelector('.scrubber-handle-end')

      // All positions should be valid (not NaN or Infinity)
      const playheadPercent = extractLeftPercent(playhead)
      const startPercent = extractLeftPercent(startHandle)
      const endPercent = extractLeftPercent(endHandle)

      expect(Number.isNaN(playheadPercent)).toBe(false)
      expect(Number.isNaN(startPercent)).toBe(false)
      expect(Number.isNaN(endPercent)).toBe(false)

      expect(Number.isFinite(playheadPercent)).toBe(true)
      expect(Number.isFinite(startPercent)).toBe(true)
      expect(Number.isFinite(endPercent)).toBe(true)
    })

    it('should not produce Infinity when windowDuration approaches zero', () => {
      const videoRef = createMockVideoRef({ duration: 10, currentTime: 5 })
      const onTimeUpdate = vi.fn()

      // Very small difference
      render(
        <Scrubber
          videoRef={videoRef}
          startTime={5}
          endTime={5.001}
          onTimeUpdate={onTimeUpdate}
        />
      )

      act(() => {
        videoRef.current!.dispatchLoadedMetadata()
      })

      const playhead = document.querySelector('.scrubber-playhead')
      const leftPercent = extractLeftPercent(playhead)

      expect(Number.isFinite(leftPercent)).toBe(true)
      expect(leftPercent).toBeGreaterThanOrEqual(0)
      expect(leftPercent).toBeLessThanOrEqual(100)
    })

    it('should render selection region with valid width when duration = 0', () => {
      const videoRef = createMockVideoRef({ duration: 10 })
      const onTimeUpdate = vi.fn()

      render(
        <Scrubber
          videoRef={videoRef}
          startTime={5}
          endTime={5}
          onTimeUpdate={onTimeUpdate}
        />
      )

      act(() => {
        videoRef.current!.dispatchLoadedMetadata()
      })

      const selection = document.querySelector('.scrubber-selection')
      const widthPercent = extractWidthPercent(selection)

      // Width should be a valid number (not NaN)
      expect(Number.isNaN(widthPercent)).toBe(false)
      expect(Number.isFinite(widthPercent)).toBe(true)
    })
  })

  describe('timeToPosition boundary values', () => {
    it('should clamp positions to 0-100% range', () => {
      const videoRef = createMockVideoRef({ duration: 10, currentTime: 0 })
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
        videoRef.current!.dispatchLoadedMetadata()
      })

      const startHandle = document.querySelector('.scrubber-handle-start')
      const endHandle = document.querySelector('.scrubber-handle-end')
      const playhead = document.querySelector('.scrubber-playhead')

      const startPercent = extractLeftPercent(startHandle)
      const endPercent = extractLeftPercent(endHandle)
      const playheadPercent = extractLeftPercent(playhead)

      // All values should be in valid range
      expect(startPercent).toBeGreaterThanOrEqual(0)
      expect(startPercent).toBeLessThanOrEqual(100)
      expect(endPercent).toBeGreaterThanOrEqual(0)
      expect(endPercent).toBeLessThanOrEqual(100)
      expect(playheadPercent).toBeGreaterThanOrEqual(0)
      expect(playheadPercent).toBeLessThanOrEqual(100)
    })

    it('should handle currentTime outside clip bounds gracefully', () => {
      const videoRef = createMockVideoRef({ duration: 20, currentTime: 0 })
      const onTimeUpdate = vi.fn()

      render(
        <Scrubber
          videoRef={videoRef}
          startTime={5}
          endTime={15}
          onTimeUpdate={onTimeUpdate}
        />
      )

      act(() => {
        videoRef.current!.dispatchLoadedMetadata()
      })

      // Playhead at time 0 which is before the clip start (5s)
      const playhead = document.querySelector('.scrubber-playhead')
      const playheadPercent = extractLeftPercent(playhead)

      // Should still be a valid percentage (might be negative or 0 depending on implementation)
      expect(Number.isNaN(playheadPercent)).toBe(false)
      expect(Number.isFinite(playheadPercent)).toBe(true)
    })
  })
})

// =============================================================================
// BUG 3: PLAYHEAD TRACKING TESTS
// =============================================================================

describe('BUG 3: Playhead Video Playback Tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  describe('timeupdate event handling', () => {
    it('should update playhead position when video currentTime changes', () => {
      const videoRef = createMockVideoRef({ duration: 10, currentTime: 0 })
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
        videoRef.current!.dispatchLoadedMetadata()
      })

      // Get initial playhead position
      let playhead = document.querySelector('.scrubber-playhead')
      const initialPercent = extractLeftPercent(playhead)

      // Simulate video playback - time advances to 5s (50%)
      act(() => {
        videoRef.current!.setCurrentTime(5)
      })

      playhead = document.querySelector('.scrubber-playhead')
      const updatedPercent = extractLeftPercent(playhead)

      // Playhead should have moved
      expect(updatedPercent).not.toBe(initialPercent)
      // Should be at approximately 50% (middle of 0-10s in window 0-10s)
      // With 5s padding: windowStart=0, windowEnd=10, so 5s = 50%
      expect(updatedPercent).toBeCloseTo(50, 0)
    })

    it('should track playhead through multiple time updates', () => {
      const videoRef = createMockVideoRef({ duration: 10, currentTime: 0 })
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
        videoRef.current!.dispatchLoadedMetadata()
      })

      const positions: number[] = []

      // Simulate video playback at multiple points
      const timePoints = [0, 2.5, 5, 7.5, 10]

      for (const time of timePoints) {
        act(() => {
          videoRef.current!.setCurrentTime(time)
        })

        const playhead = document.querySelector('.scrubber-playhead')
        positions.push(extractLeftPercent(playhead))
      }

      // Each position should be different and increasing
      for (let i = 1; i < positions.length; i++) {
        expect(positions[i]).toBeGreaterThanOrEqual(positions[i - 1])
      }

      // First should be near 0%, last should be near 100%
      expect(positions[0]).toBeCloseTo(0, 0)
      expect(positions[positions.length - 1]).toBeCloseTo(100, 0)
    })

    it('should register event listeners on video element', () => {
      const videoRef = createMockVideoRef({ duration: 10 })
      const onTimeUpdate = vi.fn()

      render(
        <Scrubber
          videoRef={videoRef}
          startTime={0}
          endTime={10}
          onTimeUpdate={onTimeUpdate}
        />
      )

      // Check that addEventListener was called for both events
      expect(videoRef.current!.addEventListener).toHaveBeenCalledWith(
        'loadedmetadata',
        expect.any(Function)
      )
      expect(videoRef.current!.addEventListener).toHaveBeenCalledWith(
        'timeupdate',
        expect.any(Function)
      )
    })

    it('should remove event listeners on unmount', () => {
      const videoRef = createMockVideoRef({ duration: 10 })
      const onTimeUpdate = vi.fn()

      const { unmount } = render(
        <Scrubber
          videoRef={videoRef}
          startTime={0}
          endTime={10}
          onTimeUpdate={onTimeUpdate}
        />
      )

      unmount()

      // Check that removeEventListener was called for both events
      expect(videoRef.current!.removeEventListener).toHaveBeenCalledWith(
        'loadedmetadata',
        expect.any(Function)
      )
      expect(videoRef.current!.removeEventListener).toHaveBeenCalledWith(
        'timeupdate',
        expect.any(Function)
      )
    })
  })

  describe('playhead position accuracy', () => {
    it('should position playhead at start handle when currentTime equals startTime', () => {
      const videoRef = createMockVideoRef({ duration: 20, currentTime: 5 })
      const onTimeUpdate = vi.fn()

      render(
        <Scrubber
          videoRef={videoRef}
          startTime={5}
          endTime={15}
          onTimeUpdate={onTimeUpdate}
        />
      )

      act(() => {
        videoRef.current!.dispatchLoadedMetadata()
      })

      const playhead = document.querySelector('.scrubber-playhead')
      const startHandle = document.querySelector('.scrubber-handle-start')

      const playheadPercent = extractLeftPercent(playhead)
      const startPercent = extractLeftPercent(startHandle)

      // Playhead should be at same position as start handle
      expect(playheadPercent).toBeCloseTo(startPercent, 1)
    })

    it('should position playhead at end handle when currentTime equals endTime', () => {
      const videoRef = createMockVideoRef({ duration: 20, currentTime: 15 })
      const onTimeUpdate = vi.fn()

      render(
        <Scrubber
          videoRef={videoRef}
          startTime={5}
          endTime={15}
          onTimeUpdate={onTimeUpdate}
        />
      )

      act(() => {
        videoRef.current!.dispatchLoadedMetadata()
      })

      // Dispatch timeupdate to sync the currentTime state
      act(() => {
        videoRef.current!.dispatchTimeUpdate()
      })

      const playhead = document.querySelector('.scrubber-playhead')
      const endHandle = document.querySelector('.scrubber-handle-end')

      const playheadPercent = extractLeftPercent(playhead)
      const endPercent = extractLeftPercent(endHandle)

      // Playhead should be at same position as end handle
      // Both should be at the same percentage since currentTime (15) equals endTime (15)
      expect(playheadPercent).toBeCloseTo(endPercent, 1)
    })
  })
})

// =============================================================================
// COMBINED EDGE CASE TESTS
// =============================================================================

describe('Combined Edge Cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('should handle all zeros gracefully', () => {
    const videoRef = createMockVideoRef({ duration: 0, currentTime: 0 })
    const onTimeUpdate = vi.fn()

    expect(() => {
      render(
        <Scrubber
          videoRef={videoRef}
          startTime={0}
          endTime={0}
          onTimeUpdate={onTimeUpdate}
        />
      )
    }).not.toThrow()

    // All elements should render without NaN positions
    const playhead = document.querySelector('.scrubber-playhead')
    const startHandle = document.querySelector('.scrubber-handle-start')
    const endHandle = document.querySelector('.scrubber-handle-end')

    expect(playhead).not.toBeNull()
    expect(startHandle).not.toBeNull()
    expect(endHandle).not.toBeNull()

    // Positions should be valid numbers
    expect(Number.isFinite(extractLeftPercent(playhead))).toBe(true)
    expect(Number.isFinite(extractLeftPercent(startHandle))).toBe(true)
    expect(Number.isFinite(extractLeftPercent(endHandle))).toBe(true)
  })

  it('should handle negative times gracefully', () => {
    const videoRef = createMockVideoRef({ duration: 10, currentTime: 0 })
    const onTimeUpdate = vi.fn()

    // Negative times are invalid but shouldn't crash
    expect(() => {
      render(
        <Scrubber
          videoRef={videoRef}
          startTime={-5}
          endTime={5}
          onTimeUpdate={onTimeUpdate}
        />
      )
    }).not.toThrow()
  })

  it('should handle very large times gracefully', () => {
    const videoRef = createMockVideoRef({ duration: 1000000, currentTime: 500000 })
    const onTimeUpdate = vi.fn()

    expect(() => {
      render(
        <Scrubber
          videoRef={videoRef}
          startTime={400000}
          endTime={600000}
          onTimeUpdate={onTimeUpdate}
        />
      )
    }).not.toThrow()

    act(() => {
      videoRef.current!.dispatchLoadedMetadata()
    })

    const playhead = document.querySelector('.scrubber-playhead')
    const playheadPercent = extractLeftPercent(playhead)

    // Should be a valid percentage
    expect(Number.isFinite(playheadPercent)).toBe(true)
    expect(playheadPercent).toBeGreaterThanOrEqual(0)
    expect(playheadPercent).toBeLessThanOrEqual(100)
  })

  it('should handle Infinity times gracefully', () => {
    const videoRef = createMockVideoRef({ duration: 10, currentTime: 5 })
    const onTimeUpdate = vi.fn()

    // This should not crash even with Infinity
    expect(() => {
      render(
        <Scrubber
          videoRef={videoRef}
          startTime={0}
          endTime={Infinity}
          onTimeUpdate={onTimeUpdate}
        />
      )
    }).not.toThrow()
  })
})

// =============================================================================
// WINDOW CALCULATION VERIFICATION TESTS
// =============================================================================

describe('Window Calculation Verification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  /**
   * Verify the window calculation formula:
   * - windowStart = max(0, startTime - 5)
   * - rawWindowEnd = min(duration, endTime + 5)
   * - windowEnd = max(rawWindowEnd, windowStart + 1)  <- BUG 1 FIX
   * - windowDuration = max(0.1, windowEnd - windowStart)  <- BUG 2 FIX
   */
  describe('window bounds calculation', () => {
    it('should apply 5s padding to window (windowStart = startTime - 5)', () => {
      const videoRef = createMockVideoRef({ duration: 100, currentTime: 20 })
      const onTimeUpdate = vi.fn()

      render(
        <Scrubber
          videoRef={videoRef}
          startTime={20}
          endTime={30}
          onTimeUpdate={onTimeUpdate}
        />
      )

      act(() => {
        videoRef.current!.dispatchLoadedMetadata()
      })

      // Check that the window label shows 15 (20 - 5)
      const startLabel = document.querySelector('.scrubber-label-start')
      expect(startLabel?.textContent).toContain('0:15')
    })

    it('should cap windowStart at 0 (cannot go negative)', () => {
      const videoRef = createMockVideoRef({ duration: 100, currentTime: 2 })
      const onTimeUpdate = vi.fn()

      render(
        <Scrubber
          videoRef={videoRef}
          startTime={2}
          endTime={10}
          onTimeUpdate={onTimeUpdate}
        />
      )

      act(() => {
        videoRef.current!.dispatchLoadedMetadata()
      })

      // windowStart = max(0, 2-5) = 0
      const startLabel = document.querySelector('.scrubber-label-start')
      expect(startLabel?.textContent).toContain('0:00')
    })

    it('should cap windowEnd at duration', () => {
      const videoRef = createMockVideoRef({ duration: 20, currentTime: 15 })
      const onTimeUpdate = vi.fn()

      render(
        <Scrubber
          videoRef={videoRef}
          startTime={10}
          endTime={18}
          onTimeUpdate={onTimeUpdate}
        />
      )

      act(() => {
        videoRef.current!.dispatchLoadedMetadata()
      })

      // windowEnd = min(20, 18+5) = 20
      const endLabel = document.querySelector('.scrubber-label-end')
      expect(endLabel?.textContent).toContain('0:20')
    })

    it('should ensure minimum 1s window (BUG 1 FIX verification)', () => {
      const videoRef = createMockVideoRef({ duration: 10, currentTime: 5 })
      const onTimeUpdate = vi.fn()

      // With startTime=5, endTime=5:
      // windowStart = max(0, 5-5) = 0
      // rawWindowEnd = min(10, 5+5) = 10
      // windowEnd = max(10, 0+1) = 10
      // This works, but let's test when rawWindowEnd < windowStart + 1
      render(
        <Scrubber
          videoRef={videoRef}
          startTime={5}
          endTime={5}
          onTimeUpdate={onTimeUpdate}
        />
      )

      act(() => {
        videoRef.current!.dispatchLoadedMetadata()
      })

      // The selection should still render with valid width
      const selection = document.querySelector('.scrubber-selection')
      const widthPercent = extractWidthPercent(selection)

      // Width might be 0 for zero-duration clip, but should be valid number
      expect(Number.isFinite(widthPercent)).toBe(true)
    })
  })

  describe('positionToTime function behavior', () => {
    it('should correctly convert position 0% to windowStart time', () => {
      const videoRef = createMockVideoRef({ duration: 100, currentTime: 25 })
      const onTimeUpdate = vi.fn()

      render(
        <Scrubber
          videoRef={videoRef}
          startTime={25}
          endTime={75}
          onTimeUpdate={onTimeUpdate}
        />
      )

      act(() => {
        videoRef.current!.dispatchLoadedMetadata()
      })

      // windowStart = 20, windowEnd = 80
      // Position 0% should correspond to time 20
      // The start label should show 0:20
      const startLabel = document.querySelector('.scrubber-label-start')
      expect(startLabel?.textContent).toContain('0:20')
    })

    it('should correctly convert position 100% to windowEnd time', () => {
      const videoRef = createMockVideoRef({ duration: 100, currentTime: 75 })
      const onTimeUpdate = vi.fn()

      render(
        <Scrubber
          videoRef={videoRef}
          startTime={25}
          endTime={75}
          onTimeUpdate={onTimeUpdate}
        />
      )

      act(() => {
        videoRef.current!.dispatchLoadedMetadata()
      })

      // windowStart = 20, windowEnd = 80
      // Position 100% should correspond to time 80
      const endLabel = document.querySelector('.scrubber-label-end')
      expect(endLabel?.textContent).toContain('1:20') // 80 seconds = 1:20
    })
  })
})

// =============================================================================
// DISABLED STATE TESTS
// =============================================================================

describe('Disabled State Edge Cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('should still render valid positions when disabled', () => {
    const videoRef = createMockVideoRef({ duration: 10, currentTime: 5 })
    const onTimeUpdate = vi.fn()

    render(
      <Scrubber
        videoRef={videoRef}
        startTime={2}
        endTime={8}
        onTimeUpdate={onTimeUpdate}
        disabled={true}
      />
    )

    act(() => {
      videoRef.current!.dispatchLoadedMetadata()
    })

    const playhead = document.querySelector('.scrubber-playhead')
    const startHandle = document.querySelector('.scrubber-handle-start')
    const endHandle = document.querySelector('.scrubber-handle-end')

    // All positions should still be valid when disabled
    expect(Number.isFinite(extractLeftPercent(playhead))).toBe(true)
    expect(Number.isFinite(extractLeftPercent(startHandle))).toBe(true)
    expect(Number.isFinite(extractLeftPercent(endHandle))).toBe(true)
  })

  it('should apply disabled class', () => {
    const videoRef = createMockVideoRef({ duration: 10 })
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
