/**
 * ClipReview Frame Step Tests
 *
 * Tests for frame-accurate stepping using detected FPS.
 * Bug: Frame step buttons used hardcoded 1/60s step, which doesn't produce
 * visible frame changes on 30fps video (every other click lands on same frame).
 * Fix: Detect actual video FPS and snap to frame boundaries.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest'

/**
 * Frame step forward logic extracted from ClipReview.tsx stepFrameForward:
 *   const frameDuration = 1 / fps
 *   const nextFrame = Math.floor(currentTime / frameDuration + 0.01) + 1
 *   const newTime = nextFrame * frameDuration
 */
function stepFrameForward(currentTime: number, fps: number): number {
  const frameDuration = 1 / fps
  const nextFrame = Math.floor(currentTime / frameDuration + 0.01) + 1
  return nextFrame * frameDuration
}

/**
 * Frame step backward logic extracted from ClipReview.tsx stepFrameBackward:
 *   const frameDuration = 1 / fps
 *   const prevFrame = Math.ceil(currentTime / frameDuration - 0.01) - 1
 *   const newTime = Math.max(0, prevFrame * frameDuration)
 */
function stepFrameBackward(currentTime: number, fps: number): number {
  const frameDuration = 1 / fps
  const prevFrame = Math.ceil(currentTime / frameDuration - 0.01) - 1
  return Math.max(0, prevFrame * frameDuration)
}

describe('Frame Step Logic', () => {
  describe('stepFrameForward', () => {
    it('should step by 1/30s for 30fps video', () => {
      const fps = 30
      const frameDuration = 1 / 30

      const t0 = 0
      const t1 = stepFrameForward(t0, fps)
      expect(t1).toBeCloseTo(frameDuration, 10) // ~0.03333s

      const t2 = stepFrameForward(t1, fps)
      expect(t2).toBeCloseTo(2 * frameDuration, 10) // ~0.06667s
    })

    it('should step by 1/60s for 60fps video', () => {
      const fps = 60
      const frameDuration = 1 / 60

      const t0 = 0
      const t1 = stepFrameForward(t0, fps)
      expect(t1).toBeCloseTo(frameDuration, 10) // ~0.01667s

      const t2 = stepFrameForward(t1, fps)
      expect(t2).toBeCloseTo(2 * frameDuration, 10) // ~0.03333s
    })

    it('should produce 10 distinct times in 10 consecutive forward steps (30fps)', () => {
      const fps = 30
      const times: number[] = [0]

      for (let i = 0; i < 10; i++) {
        times.push(stepFrameForward(times[times.length - 1], fps))
      }

      // Remove starting time, check 10 stepped times
      const steppedTimes = times.slice(1)
      expect(steppedTimes).toHaveLength(10)

      // All times should be distinct
      const uniqueTimes = new Set(steppedTimes.map((t) => t.toFixed(10)))
      expect(uniqueTimes.size).toBe(10)

      // Each step should advance by exactly 1 frame duration
      for (let i = 1; i < steppedTimes.length; i++) {
        const delta = steppedTimes[i] - steppedTimes[i - 1]
        expect(delta).toBeCloseTo(1 / 30, 10)
      }
    })

    it('should snap to next frame boundary when between frames', () => {
      const fps = 30
      const frameDuration = 1 / 30

      // Midway between frame 0 and frame 1
      const midpoint = frameDuration / 2
      const result = stepFrameForward(midpoint, fps)
      expect(result).toBeCloseTo(frameDuration, 10) // Should snap to frame 1
    })

    it('should advance to next frame when exactly on a frame boundary', () => {
      const fps = 30
      const frameDuration = 1 / 30

      // Exactly at frame 3 boundary
      const frame3 = 3 * frameDuration
      const result = stepFrameForward(frame3, fps)
      expect(result).toBeCloseTo(4 * frameDuration, 10) // Should go to frame 4
    })
  })

  describe('stepFrameBackward', () => {
    it('should step back by 1/30s for 30fps video', () => {
      const fps = 30
      const frameDuration = 1 / 30

      const t0 = 5 * frameDuration // Start at frame 5
      const t1 = stepFrameBackward(t0, fps)
      expect(t1).toBeCloseTo(4 * frameDuration, 10) // Frame 4

      const t2 = stepFrameBackward(t1, fps)
      expect(t2).toBeCloseTo(3 * frameDuration, 10) // Frame 3
    })

    it('should produce 10 distinct times in 10 consecutive backward steps (30fps)', () => {
      const fps = 30
      const startFrame = 15
      const times: number[] = [startFrame * (1 / 30)]

      for (let i = 0; i < 10; i++) {
        times.push(stepFrameBackward(times[times.length - 1], fps))
      }

      const steppedTimes = times.slice(1)
      expect(steppedTimes).toHaveLength(10)

      // All times should be distinct
      const uniqueTimes = new Set(steppedTimes.map((t) => t.toFixed(10)))
      expect(uniqueTimes.size).toBe(10)

      // Each step should go back by exactly 1 frame duration
      for (let i = 1; i < steppedTimes.length; i++) {
        const delta = steppedTimes[i - 1] - steppedTimes[i]
        expect(delta).toBeCloseTo(1 / 30, 10)
      }
    })

    it('should not go below 0', () => {
      const fps = 30
      const result = stepFrameBackward(0, fps)
      expect(result).toBe(0)
    })

    it('should clamp to 0 when stepping back from first frame', () => {
      const fps = 30
      const frameDuration = 1 / 30

      // At frame 0 boundary
      const result = stepFrameBackward(frameDuration * 0.5, fps)
      expect(result).toBe(0) // Should clamp to 0
    })

    it('should snap to previous frame boundary when between frames', () => {
      const fps = 30
      const frameDuration = 1 / 30

      // Midway between frame 5 and frame 6
      const midpoint = 5.5 * frameDuration
      const result = stepFrameBackward(midpoint, fps)
      expect(result).toBeCloseTo(5 * frameDuration, 10) // Should snap to frame 5
    })

    it('should go to previous frame when exactly on a frame boundary', () => {
      const fps = 30
      const frameDuration = 1 / 30

      // Exactly at frame 5 boundary
      const frame5 = 5 * frameDuration
      const result = stepFrameBackward(frame5, fps)
      expect(result).toBeCloseTo(4 * frameDuration, 10) // Should go to frame 4
    })
  })

  describe('round-trip consistency', () => {
    it('should return to original position after forward then backward', () => {
      const fps = 30
      const frameDuration = 1 / 30
      const start = 5 * frameDuration

      const afterForward = stepFrameForward(start, fps)
      const afterBackward = stepFrameBackward(afterForward, fps)

      expect(afterBackward).toBeCloseTo(start, 10)
    })

    it('should return to original position after 10 forward then 10 backward steps', () => {
      const fps = 30
      const frameDuration = 1 / 30
      let time = 5 * frameDuration

      // 10 forward steps
      for (let i = 0; i < 10; i++) {
        time = stepFrameForward(time, fps)
      }

      expect(time).toBeCloseTo(15 * frameDuration, 10)

      // 10 backward steps
      for (let i = 0; i < 10; i++) {
        time = stepFrameBackward(time, fps)
      }

      expect(time).toBeCloseTo(5 * frameDuration, 10)
    })
  })

  describe('default FPS behavior', () => {
    it('should use 30fps as default (matching videoFpsRef initial value)', () => {
      // The component initializes videoFpsRef to 30
      // This verifies that the default produces correct steps for 30fps video
      const defaultFps = 30
      const result = stepFrameForward(0, defaultFps)
      expect(result).toBeCloseTo(1 / 30, 10)
      // NOT 1/60 (the old hardcoded value)
      expect(result).not.toBeCloseTo(1 / 60, 10)
    })
  })

  describe('FPS detection validation', () => {
    it('should handle common video frame rates correctly', () => {
      // Test that frame stepping works for common FPS values
      const commonFps = [24, 25, 30, 48, 50, 60, 120]

      for (const fps of commonFps) {
        const frameDuration = 1 / fps
        const result = stepFrameForward(0, fps)
        expect(result).toBeCloseTo(frameDuration, 10)

        // 10 consecutive steps should all be distinct
        const times: number[] = [0]
        for (let i = 0; i < 10; i++) {
          times.push(stepFrameForward(times[times.length - 1], fps))
        }
        const uniqueTimes = new Set(times.map((t) => t.toFixed(10)))
        expect(uniqueTimes.size).toBe(11) // 10 steps + initial = 11 unique values
      }
    })
  })
})
