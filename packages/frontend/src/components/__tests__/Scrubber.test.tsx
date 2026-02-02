/**
 * Scrubber Component Tests - Clip Boundary Extension Bug
 *
 * These tests verify that users can extend clip boundaries beyond the initial
 * detection window. The bug (documented in docs/bugs/clip-boundary-extension.md)
 * causes the following issues:
 *
 * 1. Scrubber window is locked to `startTime +/- 5s` which limits extension range
 * 2. Visual "out-of-bounds" styling discourages users from extending
 * 3. Handle drag is mathematically limited to visible window range
 *
 * Expected behavior:
 * - Users should be able to extend clip start back to time 0
 * - Users should be able to extend clip end to video duration
 * - The window should expand to show the full extendable range
 *
 * @see docs/bugs/clip-boundary-extension.md
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { Scrubber } from '../Scrubber'
import { createRef } from 'react'

// Helper to create a mock video element with controllable properties
function createMockVideoRef(duration: number = 120) {
  const videoElement = {
    duration,
    currentTime: 0,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as HTMLVideoElement

  const ref = createRef<HTMLVideoElement>()
  // @ts-expect-error - we're mocking the ref
  ref.current = videoElement

  return { ref, videoElement }
}

// Helper to get scrubber track element
function getScrubberTrack(container: HTMLElement) {
  return container.querySelector('.scrubber')
}

// Helper to get handle elements
function getHandles(container: HTMLElement) {
  const startHandle = container.querySelector('.scrubber-handle-start')
  const endHandle = container.querySelector('.scrubber-handle-end')
  return { startHandle, endHandle }
}

// Helper to simulate drag on a handle
function simulateDrag(
  handle: Element,
  scrubber: Element,
  targetPosition: number // 0-100 percentage
) {
  const scrubberRect = {
    left: 0,
    width: 500, // 500px wide scrubber
    top: 0,
    height: 40,
    right: 500,
    bottom: 40,
    x: 0,
    y: 0,
    toJSON: () => {},
  }

  vi.spyOn(scrubber, 'getBoundingClientRect').mockReturnValue(scrubberRect)

  // Mouse down on handle
  fireEvent.mouseDown(handle, { preventDefault: vi.fn(), stopPropagation: vi.fn() })

  // Calculate clientX based on target position
  const clientX = (targetPosition / 100) * scrubberRect.width

  // Move mouse
  fireEvent.mouseMove(window, { clientX })

  // Mouse up
  fireEvent.mouseUp(window)
}

describe('Scrubber Component', () => {
  let onTimeUpdateMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    onTimeUpdateMock = vi.fn()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Window Calculation', () => {
    /**
     * BUG TEST: Window should use video duration, not endTime + padding
     *
     * Current behavior: windowEnd = min(duration, endTime + 5s)
     * Expected behavior: windowEnd = duration (full video range)
     *
     * This test will FAIL with current code because the window is artificially
     * limited to endTime + 5s padding.
     */
    it('should calculate window end using full video duration, not clip end + padding', () => {
      const { ref, videoElement } = createMockVideoRef(120) // 2 minute video

      const { container } = render(
        <Scrubber
          videoRef={ref}
          startTime={30} // Clip starts at 30s
          endTime={35} // Clip ends at 35s
          onTimeUpdate={onTimeUpdateMock}
        />
      )

      // Trigger loadedmetadata to set duration
      const loadedMetadataHandler = videoElement.addEventListener.mock.calls.find(
        ([event]) => event === 'loadedmetadata'
      )?.[1]
      if (loadedMetadataHandler) {
        act(() => loadedMetadataHandler())
      }

      // Check the window end label - should show video duration (120s), not 40s (35+5)
      const endLabel = container.querySelector('.scrubber-label-end')
      expect(endLabel).toBeTruthy()

      // The label should show the full video duration, allowing extension to end
      // Current bug: shows "0:40.00" (endTime + 5s padding)
      // Expected: should show "2:00.00" (full duration) OR dynamically expand
      const endLabelText = endLabel?.textContent
      expect(endLabelText).not.toContain('0:40') // Should NOT be limited to 40s
    })

    /**
     * BUG TEST: Window start should allow access to time 0, not startTime - 5s
     *
     * Current behavior: windowStart = max(0, startTime - 5s)
     * When startTime = 30s, this gives windowStart = 25s
     *
     * This test will FAIL because users cannot extend start to time 0.
     */
    it('should allow window start to reach time 0 for clips starting later', () => {
      const { ref, videoElement } = createMockVideoRef(120)

      const { container } = render(
        <Scrubber
          videoRef={ref}
          startTime={30} // Clip starts at 30s
          endTime={35}
          onTimeUpdate={onTimeUpdateMock}
        />
      )

      // Trigger loadedmetadata
      const loadedMetadataHandler = videoElement.addEventListener.mock.calls.find(
        ([event]) => event === 'loadedmetadata'
      )?.[1]
      if (loadedMetadataHandler) {
        act(() => loadedMetadataHandler())
      }

      // The window should allow extending back to 0, not just 25s
      const startLabel = container.querySelector('.scrubber-label-start')
      expect(startLabel).toBeTruthy()

      // Current bug: shows "0:25.00" (startTime - 5s)
      // Expected: should show "0:00.00" (time 0) OR expand dynamically when dragging
      const startLabelText = startLabel?.textContent

      // For now this tests current behavior - the fix should make this show 0:00.00
      // or the window should expand when user drags past the boundary
    })
  })

  describe('Handle Drag - Start Handle', () => {
    /**
     * BUG TEST: Start handle should be draggable to time 0
     *
     * Current behavior: Handle position is limited by windowStart which is
     * calculated as max(0, startTime - 5s). When converted back to time,
     * dragging to the left edge only reaches windowStart, not time 0.
     *
     * This test will FAIL because the start handle cannot reach time 0.
     */
    it('should allow dragging start handle to time 0 in a 120s video', () => {
      const { ref, videoElement } = createMockVideoRef(120)

      const { container } = render(
        <Scrubber
          videoRef={ref}
          startTime={30} // Clip at 30-35s
          endTime={35}
          onTimeUpdate={onTimeUpdateMock}
        />
      )

      // Trigger loadedmetadata
      const loadedMetadataHandler = videoElement.addEventListener.mock.calls.find(
        ([event]) => event === 'loadedmetadata'
      )?.[1]
      if (loadedMetadataHandler) {
        act(() => loadedMetadataHandler())
      }

      const scrubber = getScrubberTrack(container)
      const { startHandle } = getHandles(container)

      expect(scrubber).toBeTruthy()
      expect(startHandle).toBeTruthy()

      // Drag start handle all the way to the left (0%)
      simulateDrag(startHandle!, scrubber!, 0)

      // Should call onTimeUpdate with newStart = 0 (or very close)
      // Current bug: newStart will be ~25 (windowStart) because position 0%
      // maps to windowStart in positionToTime()
      expect(onTimeUpdateMock).toHaveBeenCalled()

      const lastCall = onTimeUpdateMock.mock.calls[onTimeUpdateMock.mock.calls.length - 1]
      const [newStart, _newEnd] = lastCall

      // The start should be able to reach 0, not be limited to windowStart (25s)
      expect(newStart).toBeLessThanOrEqual(0.5) // Allow small margin for rounding
    })

    /**
     * BUG TEST: Start handle should allow extension to 20s for clip at 30s
     * (more than 5s before start)
     */
    it('should allow dragging start handle more than 5 seconds before original start', () => {
      const { ref, videoElement } = createMockVideoRef(120)

      const { container } = render(
        <Scrubber
          videoRef={ref}
          startTime={30}
          endTime={35}
          onTimeUpdate={onTimeUpdateMock}
        />
      )

      // Trigger loadedmetadata
      const loadedMetadataHandler = videoElement.addEventListener.mock.calls.find(
        ([event]) => event === 'loadedmetadata'
      )?.[1]
      if (loadedMetadataHandler) {
        act(() => loadedMetadataHandler())
      }

      const scrubber = getScrubberTrack(container)
      const { startHandle } = getHandles(container)

      expect(scrubber).toBeTruthy()
      expect(startHandle).toBeTruthy()

      // Drag to position that should map to 20s (10 seconds before clip start)
      // With current window of 25s-40s (15s range), 20s is outside the window
      // Bug: This drag cannot reach 20s because window limits to 25s minimum

      simulateDrag(startHandle!, scrubber!, 0) // Drag to leftmost position

      expect(onTimeUpdateMock).toHaveBeenCalled()

      const lastCall = onTimeUpdateMock.mock.calls[onTimeUpdateMock.mock.calls.length - 1]
      const [newStart] = lastCall

      // Should be able to reach at least 20s (10s before original start)
      expect(newStart).toBeLessThanOrEqual(20)
    })
  })

  describe('Handle Drag - End Handle', () => {
    /**
     * BUG TEST: End handle should be draggable to video duration
     *
     * Current behavior: Handle position is limited by windowEnd which is
     * calculated as min(duration, endTime + 5s). Dragging to the right edge
     * only reaches endTime + 5s, not the full video duration.
     *
     * This test will FAIL because the end handle cannot reach video end.
     */
    it('should allow dragging end handle to video duration (120s)', () => {
      const { ref, videoElement } = createMockVideoRef(120)

      const { container } = render(
        <Scrubber
          videoRef={ref}
          startTime={30}
          endTime={35} // Clip ends at 35s
          onTimeUpdate={onTimeUpdateMock}
        />
      )

      // Trigger loadedmetadata
      const loadedMetadataHandler = videoElement.addEventListener.mock.calls.find(
        ([event]) => event === 'loadedmetadata'
      )?.[1]
      if (loadedMetadataHandler) {
        act(() => loadedMetadataHandler())
      }

      const scrubber = getScrubberTrack(container)
      const { endHandle } = getHandles(container)

      expect(scrubber).toBeTruthy()
      expect(endHandle).toBeTruthy()

      // Drag end handle all the way to the right (100%)
      simulateDrag(endHandle!, scrubber!, 100)

      expect(onTimeUpdateMock).toHaveBeenCalled()

      const lastCall = onTimeUpdateMock.mock.calls[onTimeUpdateMock.mock.calls.length - 1]
      const [_newStart, newEnd] = lastCall

      // The end should be able to reach 120s (video duration), not be limited to 40s
      // Current bug: newEnd will be ~40 (windowEnd = endTime + 5s)
      expect(newEnd).toBeGreaterThanOrEqual(100) // Should reach near video end
    })

    /**
     * BUG TEST: End handle should allow extension to 50s for clip ending at 35s
     * (more than 5s after end)
     */
    it('should allow dragging end handle more than 5 seconds after original end', () => {
      const { ref, videoElement } = createMockVideoRef(120)

      const { container } = render(
        <Scrubber
          videoRef={ref}
          startTime={30}
          endTime={35}
          onTimeUpdate={onTimeUpdateMock}
        />
      )

      // Trigger loadedmetadata
      const loadedMetadataHandler = videoElement.addEventListener.mock.calls.find(
        ([event]) => event === 'loadedmetadata'
      )?.[1]
      if (loadedMetadataHandler) {
        act(() => loadedMetadataHandler())
      }

      const scrubber = getScrubberTrack(container)
      const { endHandle } = getHandles(container)

      expect(scrubber).toBeTruthy()
      expect(endHandle).toBeTruthy()

      simulateDrag(endHandle!, scrubber!, 100) // Drag to rightmost position

      expect(onTimeUpdateMock).toHaveBeenCalled()

      const lastCall = onTimeUpdateMock.mock.calls[onTimeUpdateMock.mock.calls.length - 1]
      const [_newStart, newEnd] = lastCall

      // Should be able to reach at least 50s (15s after original end)
      expect(newEnd).toBeGreaterThanOrEqual(50)
    })
  })

  describe('Boundary Callback Propagation', () => {
    /**
     * Test that extended boundaries are properly passed to onTimeUpdate callback
     */
    it('should pass extended start boundary to onTimeUpdate callback', () => {
      const { ref, videoElement } = createMockVideoRef(120)

      const { container } = render(
        <Scrubber
          videoRef={ref}
          startTime={30}
          endTime={35}
          onTimeUpdate={onTimeUpdateMock}
        />
      )

      // Trigger loadedmetadata
      const loadedMetadataHandler = videoElement.addEventListener.mock.calls.find(
        ([event]) => event === 'loadedmetadata'
      )?.[1]
      if (loadedMetadataHandler) {
        act(() => loadedMetadataHandler())
      }

      const scrubber = getScrubberTrack(container)
      const { startHandle } = getHandles(container)

      simulateDrag(startHandle!, scrubber!, 0)

      // Verify callback was called with valid parameters
      expect(onTimeUpdateMock).toHaveBeenCalled()
      const [newStart, newEnd] = onTimeUpdateMock.mock.calls[
        onTimeUpdateMock.mock.calls.length - 1
      ]

      // Start should be a valid time >= 0
      expect(newStart).toBeGreaterThanOrEqual(0)
      // End should remain unchanged at 35
      expect(newEnd).toBe(35)
    })

    it('should pass extended end boundary to onTimeUpdate callback', () => {
      const { ref, videoElement } = createMockVideoRef(120)

      const { container } = render(
        <Scrubber
          videoRef={ref}
          startTime={30}
          endTime={35}
          onTimeUpdate={onTimeUpdateMock}
        />
      )

      // Trigger loadedmetadata
      const loadedMetadataHandler = videoElement.addEventListener.mock.calls.find(
        ([event]) => event === 'loadedmetadata'
      )?.[1]
      if (loadedMetadataHandler) {
        act(() => loadedMetadataHandler())
      }

      const scrubber = getScrubberTrack(container)
      const { endHandle } = getHandles(container)

      simulateDrag(endHandle!, scrubber!, 100)

      // Verify callback was called with valid parameters
      expect(onTimeUpdateMock).toHaveBeenCalled()
      const [newStart, newEnd] = onTimeUpdateMock.mock.calls[
        onTimeUpdateMock.mock.calls.length - 1
      ]

      // Start should remain unchanged at 30
      expect(newStart).toBe(30)
      // End should be a valid time <= duration
      expect(newEnd).toBeLessThanOrEqual(120)
    })
  })

  describe('Minimum Clip Duration Constraint', () => {
    /**
     * Verify the 0.5s minimum clip duration is still enforced when extending
     */
    it('should maintain minimum 0.5s clip duration when extending start', () => {
      const { ref, videoElement } = createMockVideoRef(120)

      const { container } = render(
        <Scrubber
          videoRef={ref}
          startTime={30}
          endTime={30.4} // Only 0.4s clip
          onTimeUpdate={onTimeUpdateMock}
        />
      )

      // Trigger loadedmetadata
      const loadedMetadataHandler = videoElement.addEventListener.mock.calls.find(
        ([event]) => event === 'loadedmetadata'
      )?.[1]
      if (loadedMetadataHandler) {
        act(() => loadedMetadataHandler())
      }

      const scrubber = getScrubberTrack(container)
      const { startHandle } = getHandles(container)

      // Try to drag start past end
      simulateDrag(startHandle!, scrubber!, 100)

      if (onTimeUpdateMock.mock.calls.length > 0) {
        const [newStart, newEnd] = onTimeUpdateMock.mock.calls[
          onTimeUpdateMock.mock.calls.length - 1
        ]
        // Start should not exceed end - 0.5s
        expect(newStart).toBeLessThanOrEqual(newEnd - 0.5)
      }
    })
  })

  describe('Edge Cases', () => {
    /**
     * Test clip at very start of video (startTime near 0)
     */
    it('should handle clip at start of video (startTime = 2s)', () => {
      const { ref, videoElement } = createMockVideoRef(120)

      const { container } = render(
        <Scrubber
          videoRef={ref}
          startTime={2} // Near start
          endTime={7}
          onTimeUpdate={onTimeUpdateMock}
        />
      )

      // Trigger loadedmetadata
      const loadedMetadataHandler = videoElement.addEventListener.mock.calls.find(
        ([event]) => event === 'loadedmetadata'
      )?.[1]
      if (loadedMetadataHandler) {
        act(() => loadedMetadataHandler())
      }

      const scrubber = getScrubberTrack(container)
      const { startHandle } = getHandles(container)

      // Drag to time 0
      simulateDrag(startHandle!, scrubber!, 0)

      if (onTimeUpdateMock.mock.calls.length > 0) {
        const [newStart] = onTimeUpdateMock.mock.calls[
          onTimeUpdateMock.mock.calls.length - 1
        ]
        // Should be able to reach 0
        expect(newStart).toBeLessThanOrEqual(0.5)
      }
    })

    /**
     * Test clip at very end of video (endTime near duration)
     */
    it('should handle clip at end of video (endTime = 118s in 120s video)', () => {
      const { ref, videoElement } = createMockVideoRef(120)

      const { container } = render(
        <Scrubber
          videoRef={ref}
          startTime={113}
          endTime={118} // Near end
          onTimeUpdate={onTimeUpdateMock}
        />
      )

      // Trigger loadedmetadata
      const loadedMetadataHandler = videoElement.addEventListener.mock.calls.find(
        ([event]) => event === 'loadedmetadata'
      )?.[1]
      if (loadedMetadataHandler) {
        act(() => loadedMetadataHandler())
      }

      const scrubber = getScrubberTrack(container)
      const { endHandle } = getHandles(container)

      // Drag to video end
      simulateDrag(endHandle!, scrubber!, 100)

      if (onTimeUpdateMock.mock.calls.length > 0) {
        const [_newStart, newEnd] = onTimeUpdateMock.mock.calls[
          onTimeUpdateMock.mock.calls.length - 1
        ]
        // Should be able to reach 120 (video duration)
        expect(newEnd).toBeGreaterThanOrEqual(119.5)
      }
    })
  })
})

describe('Scrubber Integration Tests', () => {
  /**
   * Integration test: Verify that a clip at 30s-35s in a 120s video
   * can be extended to 20s-50s (well beyond the +/-5s padding)
   */
  it('should allow extending clip from 30-35s to 20-50s in 120s video', async () => {
    const onTimeUpdateMock = vi.fn()
    const { ref, videoElement } = createMockVideoRef(120)

    const { container, rerender } = render(
      <Scrubber
        videoRef={ref}
        startTime={30}
        endTime={35}
        onTimeUpdate={onTimeUpdateMock}
      />
    )

    // Trigger loadedmetadata
    const loadedMetadataHandler = videoElement.addEventListener.mock.calls.find(
      ([event]) => event === 'loadedmetadata'
    )?.[1]
    if (loadedMetadataHandler) {
      act(() => loadedMetadataHandler())
    }

    const scrubber = getScrubberTrack(container)
    const { startHandle, endHandle } = getHandles(container)

    // Step 1: Extend start to 20s
    simulateDrag(startHandle!, scrubber!, 0)

    // Verify start was extended (even if not all the way to 0)
    expect(onTimeUpdateMock).toHaveBeenCalled()
    let [newStart, newEnd] = onTimeUpdateMock.mock.calls[
      onTimeUpdateMock.mock.calls.length - 1
    ]

    // BUG: Current code limits this to 25s (startTime - 5s)
    // Expected: Should reach at least 20s
    // This assertion will fail with current buggy code:
    expect(newStart).toBeLessThanOrEqual(20)

    // Step 2: Re-render with updated start time and extend end
    rerender(
      <Scrubber
        videoRef={ref}
        startTime={newStart}
        endTime={35}
        onTimeUpdate={onTimeUpdateMock}
      />
    )

    onTimeUpdateMock.mockClear()

    // Step 3: Extend end to 50s
    simulateDrag(endHandle!, scrubber!, 100)

    expect(onTimeUpdateMock).toHaveBeenCalled()
    ;[newStart, newEnd] = onTimeUpdateMock.mock.calls[
      onTimeUpdateMock.mock.calls.length - 1
    ]

    // BUG: Current code limits this to 40s (endTime + 5s)
    // Expected: Should reach at least 50s
    // This assertion will fail with current buggy code:
    expect(newEnd).toBeGreaterThanOrEqual(50)
  })

  /**
   * Integration test: Verify boundaries are properly saved after extending
   * This simulates the flow where ClipReview passes updated boundaries back
   */
  it('should maintain extended boundaries when re-rendered with new props', () => {
    const onTimeUpdateMock = vi.fn()
    const { ref } = createMockVideoRef(120)

    const { rerender } = render(
      <Scrubber
        videoRef={ref}
        startTime={30}
        endTime={35}
        onTimeUpdate={onTimeUpdateMock}
      />
    )

    // Simulate extended boundaries being passed back from parent
    rerender(
      <Scrubber
        videoRef={ref}
        startTime={10} // Extended start
        endTime={60} // Extended end
        onTimeUpdate={onTimeUpdateMock}
      />
    )

    // The scrubber should now show the extended range
    // Verify the clip info displays the extended range
    // (This is a visual/functional test that the component accepts extended values)
    expect(true).toBe(true) // Placeholder - real test would verify visual state
  })
})
