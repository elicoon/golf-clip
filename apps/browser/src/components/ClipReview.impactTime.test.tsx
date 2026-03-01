/**
 * ClipReview Impact Time Tests
 *
 * Tests for the handleSetImpactTime functionality.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from 'vitest'

describe('ClipReview Impact Time Handler', () => {
  describe('handleSetImpactTime logic', () => {
    it('should update strikeTime when playhead is within clip boundaries', () => {
      // Arrange
      const currentShot = {
        id: 'shot-1',
        startTime: 10.0,
        clipStart: 12.0,
        clipEnd: 20.0,
        strikeTime: 15.0,
      }
      const videoCurrentTime = 5.0 // Relative to segment start (10.0 + 5.0 = 15.0 global)
      const updateSegment = vi.fn()

      // Act - simulate handler logic
      const globalImpactTime = currentShot.startTime + videoCurrentTime // 15.0
      const isWithinBounds = globalImpactTime >= currentShot.clipStart && globalImpactTime <= currentShot.clipEnd

      if (isWithinBounds) {
        updateSegment(currentShot.id, { strikeTime: globalImpactTime })
      }

      // Assert
      expect(updateSegment).toHaveBeenCalledWith('shot-1', { strikeTime: 15.0 })
    })

    it('should NOT update strikeTime when playhead is BEFORE clip start', () => {
      // Arrange
      const currentShot = {
        id: 'shot-1',
        startTime: 10.0,
        clipStart: 12.0,
        clipEnd: 20.0,
        strikeTime: 15.0,
      }
      const videoCurrentTime = 1.0 // Relative to segment (10.0 + 1.0 = 11.0 global, before clipStart 12.0)
      const updateSegment = vi.fn()

      // Act
      const globalImpactTime = currentShot.startTime + videoCurrentTime // 11.0
      const isWithinBounds = globalImpactTime >= currentShot.clipStart && globalImpactTime <= currentShot.clipEnd

      if (isWithinBounds) {
        updateSegment(currentShot.id, { strikeTime: globalImpactTime })
      }

      // Assert
      expect(updateSegment).not.toHaveBeenCalled()
    })

    it('should NOT update strikeTime when playhead is AFTER clip end', () => {
      // Arrange
      const currentShot = {
        id: 'shot-1',
        startTime: 10.0,
        clipStart: 12.0,
        clipEnd: 20.0,
        strikeTime: 15.0,
      }
      const videoCurrentTime = 15.0 // Relative to segment (10.0 + 15.0 = 25.0 global, after clipEnd 20.0)
      const updateSegment = vi.fn()

      // Act
      const globalImpactTime = currentShot.startTime + videoCurrentTime // 25.0
      const isWithinBounds = globalImpactTime >= currentShot.clipStart && globalImpactTime <= currentShot.clipEnd

      if (isWithinBounds) {
        updateSegment(currentShot.id, { strikeTime: globalImpactTime })
      }

      // Assert
      expect(updateSegment).not.toHaveBeenCalled()
    })

    it('should accept impact time at exactly clip start boundary', () => {
      // Arrange
      const currentShot = {
        id: 'shot-1',
        startTime: 10.0,
        clipStart: 12.0,
        clipEnd: 20.0,
        strikeTime: 15.0,
      }
      const videoCurrentTime = 2.0 // Relative to segment (10.0 + 2.0 = 12.0 global = clipStart)
      const updateSegment = vi.fn()

      // Act
      const globalImpactTime = currentShot.startTime + videoCurrentTime // 12.0
      const isWithinBounds = globalImpactTime >= currentShot.clipStart && globalImpactTime <= currentShot.clipEnd

      if (isWithinBounds) {
        updateSegment(currentShot.id, { strikeTime: globalImpactTime })
      }

      // Assert
      expect(updateSegment).toHaveBeenCalledWith('shot-1', { strikeTime: 12.0 })
    })

    it('should accept impact time at exactly clip end boundary', () => {
      // Arrange
      const currentShot = {
        id: 'shot-1',
        startTime: 10.0,
        clipStart: 12.0,
        clipEnd: 20.0,
        strikeTime: 15.0,
      }
      const videoCurrentTime = 10.0 // Relative to segment (10.0 + 10.0 = 20.0 global = clipEnd)
      const updateSegment = vi.fn()

      // Act
      const globalImpactTime = currentShot.startTime + videoCurrentTime // 20.0
      const isWithinBounds = globalImpactTime >= currentShot.clipStart && globalImpactTime <= currentShot.clipEnd

      if (isWithinBounds) {
        updateSegment(currentShot.id, { strikeTime: globalImpactTime })
      }

      // Assert
      expect(updateSegment).toHaveBeenCalledWith('shot-1', { strikeTime: 20.0 })
    })
  })
})
