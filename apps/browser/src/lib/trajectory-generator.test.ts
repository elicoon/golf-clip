import { describe, it, expect } from 'vitest'
import { generateTrajectory, Point2D } from './trajectory-generator'
import { TracerConfig } from '../stores/processingStore'

const defaultLanding: Point2D = { x: 0.8, y: 0.3 }

function makeConfig(overrides: Partial<TracerConfig> = {}): TracerConfig {
  return { height: 'medium', shape: 'straight', flightTime: 3, ...overrides }
}

describe('generateTrajectory', () => {
  describe('default origin', () => {
    it('uses default origin (0.5, 0.85) when none provided', () => {
      const result = generateTrajectory(defaultLanding, makeConfig())
      // First point should be at the default origin
      expect(result.points[0].x).toBeCloseTo(0.5, 5)
      expect(result.points[0].y).toBeCloseTo(0.85, 5)
    })

    it('uses custom origin when provided', () => {
      const origin: Point2D = { x: 0.3, y: 0.9 }
      const result = generateTrajectory(defaultLanding, makeConfig(), origin)
      expect(result.points[0].x).toBeCloseTo(0.3, 5)
      expect(result.points[0].y).toBeCloseTo(0.9, 5)
    })
  })

  describe('landing point', () => {
    it('last point lands at the landing coordinates', () => {
      const result = generateTrajectory(defaultLanding, makeConfig())
      const last = result.points[result.points.length - 1]
      expect(last.x).toBeCloseTo(0.8, 5)
      expect(last.y).toBeCloseTo(0.3, 5)
    })
  })

  describe('point count scales with flight time', () => {
    it('generates ~60 points per second of flight time', () => {
      const result3s = generateTrajectory(defaultLanding, makeConfig({ flightTime: 3 }))
      // numPoints = ceil(3 * 60) = 180, plus endpoint = 181
      expect(result3s.points).toHaveLength(181)

      const result5s = generateTrajectory(defaultLanding, makeConfig({ flightTime: 5 }))
      // numPoints = ceil(5 * 60) = 300, plus endpoint = 301
      expect(result5s.points).toHaveLength(301)
    })

    it('enforces minimum of 30 points for very short flights', () => {
      const result = generateTrajectory(defaultLanding, makeConfig({ flightTime: 0.1 }))
      // max(30, ceil(0.1 * 60)) = max(30, 6) = 30, plus endpoint = 31
      expect(result.points).toHaveLength(31)
    })
  })

  describe('bezier math - apex at t=0.5', () => {
    it('curve passes through calculated apex at midpoint', () => {
      const config = makeConfig({ height: 'medium' })
      const result = generateTrajectory(defaultLanding, config)

      // Default origin: (0.5, 0.85), landing: (0.8, 0.3)
      // defaultApex.x = (0.5 + 0.8) / 2 = 0.65
      // defaultApex.y = min(0.85, 0.3) - 0.25 = 0.3 - 0.25 = 0.05
      // The midpoint of the curve (t=0.5) should pass through the apex
      const midIdx = Math.floor(result.points.length / 2)
      const midPoint = result.points[midIdx]

      // At t=0.5 the bezier passes exactly through the apex (that's the control point formula)
      // The point should be very close to apex (with shape=straight, no lateral offset)
      expect(midPoint.x).toBeCloseTo(0.65, 1)
      expect(midPoint.y).toBeCloseTo(0.05, 1)
    })

    it('apex_point in result matches the target apex coordinates', () => {
      const config = makeConfig({ height: 'high' })
      const result = generateTrajectory(defaultLanding, config)

      // defaultApex.y = min(0.85, 0.3) - 0.35 = -0.05 -> clamped to 0
      expect(result.apex_point!.x).toBeCloseTo(0.65, 1)
      expect(result.apex_point!.y).toBe(0) // clamped
    })
  })

  describe('shot heights', () => {
    it('low height produces highest y apex (closer to bottom)', () => {
      const low = generateTrajectory(defaultLanding, makeConfig({ height: 'low' }))
      const high = generateTrajectory(defaultLanding, makeConfig({ height: 'high' }))
      // Lower y = higher on screen. "high" shot should have lower y apex
      expect(low.apex_point!.y).toBeGreaterThan(high.apex_point!.y)
    })

    it('medium height is between low and high', () => {
      const low = generateTrajectory(defaultLanding, makeConfig({ height: 'low' }))
      const med = generateTrajectory(defaultLanding, makeConfig({ height: 'medium' }))
      const high = generateTrajectory(defaultLanding, makeConfig({ height: 'high' }))
      expect(med.apex_point!.y).toBeLessThan(low.apex_point!.y)
      expect(med.apex_point!.y).toBeGreaterThan(high.apex_point!.y)
    })

    it('applies correct height multipliers', () => {
      // With origin (0.5, 0.85) and landing (0.8, 0.3):
      // min(0.85, 0.3) = 0.3
      // low:    apex_y = 0.3 - 0.15 = 0.15
      // medium: apex_y = 0.3 - 0.25 = 0.05
      // high:   apex_y = 0.3 - 0.35 = -0.05 -> clamped to 0
      const low = generateTrajectory(defaultLanding, makeConfig({ height: 'low' }))
      const med = generateTrajectory(defaultLanding, makeConfig({ height: 'medium' }))
      const high = generateTrajectory(defaultLanding, makeConfig({ height: 'high' }))

      expect(low.apex_point!.y).toBeCloseTo(0.15, 1)
      expect(med.apex_point!.y).toBeCloseTo(0.05, 1)
      expect(high.apex_point!.y).toBe(0) // clamped from -0.05
    })
  })

  describe('shot shapes', () => {
    it('straight shape has no lateral offset', () => {
      const result = generateTrajectory(defaultLanding, makeConfig({ shape: 'straight' }))
      const midIdx = Math.floor(result.points.length / 2)
      // Midpoint x should be exactly at apex x = (0.5 + 0.8) / 2 = 0.65
      expect(result.points[midIdx].x).toBeCloseTo(0.65, 1)
    })

    it('draw/hook shifts trajectory left (negative x offset)', () => {
      const straight = generateTrajectory(defaultLanding, makeConfig({ shape: 'straight' }))
      const draw = generateTrajectory(defaultLanding, makeConfig({ shape: 'draw' }))
      const hook = generateTrajectory(defaultLanding, makeConfig({ shape: 'hook' }))

      // Sample at ~25% through trajectory where shape offset is visible
      const qIdx = Math.floor(straight.points.length / 4)
      // Draw and hook should shift left (lower x) relative to straight
      expect(draw.points[qIdx].x).toBeLessThan(straight.points[qIdx].x)
      expect(hook.points[qIdx].x).toBeLessThan(draw.points[qIdx].x)
    })

    it('fade/slice shifts trajectory right (positive x offset)', () => {
      const straight = generateTrajectory(defaultLanding, makeConfig({ shape: 'straight' }))
      const fade = generateTrajectory(defaultLanding, makeConfig({ shape: 'fade' }))
      const slice = generateTrajectory(defaultLanding, makeConfig({ shape: 'slice' }))

      const qIdx = Math.floor(straight.points.length / 4)
      expect(fade.points[qIdx].x).toBeGreaterThan(straight.points[qIdx].x)
      expect(slice.points[qIdx].x).toBeGreaterThan(fade.points[qIdx].x)
    })

    it('all five shapes produce different midpoint positions', () => {
      const shapes: TracerConfig['shape'][] = ['hook', 'draw', 'straight', 'fade', 'slice']
      const midXs = shapes.map((shape) => {
        const result = generateTrajectory(defaultLanding, makeConfig({ shape }))
        const midIdx = Math.floor(result.points.length / 2)
        return result.points[midIdx].x
      })

      // hook < draw < straight < fade < slice (in x)
      for (let i = 0; i < midXs.length - 1; i++) {
        expect(midXs[i]).toBeLessThan(midXs[i + 1])
      }
    })
  })

  describe('shape curve disabled with explicit apex', () => {
    it('ignores shape offset when apexPoint is provided', () => {
      const apex: Point2D = { x: 0.6, y: 0.1 }
      const hookResult = generateTrajectory(
        defaultLanding,
        makeConfig({ shape: 'hook' }),
        undefined,
        apex
      )
      const sliceResult = generateTrajectory(
        defaultLanding,
        makeConfig({ shape: 'slice' }),
        undefined,
        apex
      )

      // With explicit apex, shape curve offset = 0, so hook and slice should be identical
      for (let i = 0; i < hookResult.points.length; i++) {
        expect(hookResult.points[i].x).toBeCloseTo(sliceResult.points[i].x, 10)
        expect(hookResult.points[i].y).toBeCloseTo(sliceResult.points[i].y, 10)
      }
    })
  })

  describe('custom apex overrides default', () => {
    it('uses provided apex point instead of auto-calculating', () => {
      const apex: Point2D = { x: 0.4, y: 0.1 }
      const result = generateTrajectory(defaultLanding, makeConfig(), undefined, apex)

      expect(result.apex_point!.x).toBeCloseTo(0.4, 1)
      expect(result.apex_point!.y).toBeCloseTo(0.1, 1)
    })

    it('bezier passes through custom apex at midpoint', () => {
      const apex: Point2D = { x: 0.7, y: 0.05 }
      const result = generateTrajectory(defaultLanding, makeConfig(), undefined, apex)
      const midIdx = Math.floor(result.points.length / 2)

      expect(result.points[midIdx].x).toBeCloseTo(0.7, 1)
      expect(result.points[midIdx].y).toBeCloseTo(0.05, 1)
    })
  })

  describe('startTimeOffset', () => {
    it('shifts all timestamps by the offset', () => {
      const offset = 5.0
      const result = generateTrajectory(defaultLanding, makeConfig({ flightTime: 2 }), undefined, undefined, offset)

      expect(result.points[0].timestamp).toBeCloseTo(5.0, 5)
      expect(result.points[result.points.length - 1].timestamp).toBeCloseTo(7.0, 5)
    })

    it('defaults to 0 offset', () => {
      const result = generateTrajectory(defaultLanding, makeConfig({ flightTime: 2 }))
      expect(result.points[0].timestamp).toBeCloseTo(0, 5)
      expect(result.points[result.points.length - 1].timestamp).toBeCloseTo(2.0, 5)
    })

    it('timestamps are evenly spaced', () => {
      const result = generateTrajectory(defaultLanding, makeConfig({ flightTime: 1 }))
      const dt = result.points[1].timestamp - result.points[0].timestamp
      for (let i = 2; i < result.points.length; i++) {
        expect(result.points[i].timestamp - result.points[i - 1].timestamp).toBeCloseTo(dt, 10)
      }
    })
  })

  describe('coordinate clamping to [0, 1]', () => {
    it('clamps points that would go out of bounds', () => {
      // Use extreme values that will push bezier control point out of [0,1]
      const origin: Point2D = { x: 0.0, y: 0.0 }
      const landing: Point2D = { x: 1.0, y: 0.0 }
      const apex: Point2D = { x: 0.5, y: -0.5 } // Way above screen

      const result = generateTrajectory(landing, makeConfig(), origin, apex)

      for (const point of result.points) {
        expect(point.x).toBeGreaterThanOrEqual(0)
        expect(point.x).toBeLessThanOrEqual(1)
        expect(point.y).toBeGreaterThanOrEqual(0)
        expect(point.y).toBeLessThanOrEqual(1)
      }
    })

    it('clamps apex_point in result to [0, 1]', () => {
      // high height with low landing creates negative apex_y
      const landing: Point2D = { x: 0.8, y: 0.1 }
      const result = generateTrajectory(landing, makeConfig({ height: 'high' }))
      // apex_y = min(0.85, 0.1) - 0.35 = -0.25 -> clamped to 0
      expect(result.apex_point!.y).toBe(0)
      expect(result.apex_point!.x).toBeGreaterThanOrEqual(0)
    })
  })

  describe('output metadata', () => {
    it('returns shot_id as "generated"', () => {
      const result = generateTrajectory(defaultLanding, makeConfig())
      expect(result.shot_id).toBe('generated')
    })

    it('returns confidence 1.0', () => {
      const result = generateTrajectory(defaultLanding, makeConfig())
      expect(result.confidence).toBe(1.0)
    })

    it('returns 1920x1080 frame dimensions', () => {
      const result = generateTrajectory(defaultLanding, makeConfig())
      expect(result.frame_width).toBe(1920)
      expect(result.frame_height).toBe(1080)
    })

    it('all points have confidence 1.0 and interpolated false', () => {
      const result = generateTrajectory(defaultLanding, makeConfig())
      for (const point of result.points) {
        expect(point.confidence).toBe(1.0)
        expect(point.interpolated).toBe(false)
      }
    })
  })

  describe('edge cases', () => {
    it('handles very short flight time (1s)', () => {
      const result = generateTrajectory(defaultLanding, makeConfig({ flightTime: 1 }))
      // ceil(1 * 60) = 60 + 1 = 61 points
      expect(result.points).toHaveLength(61)
      expect(result.points[0].timestamp).toBeCloseTo(0, 5)
      expect(result.points[result.points.length - 1].timestamp).toBeCloseTo(1, 5)
    })

    it('handles very long flight time (10s)', () => {
      const result = generateTrajectory(defaultLanding, makeConfig({ flightTime: 10 }))
      // ceil(10 * 60) = 600 + 1 = 601 points
      expect(result.points).toHaveLength(601)
      expect(result.points[result.points.length - 1].timestamp).toBeCloseTo(10, 5)
    })

    it('handles zero-area trajectory (origin == landing)', () => {
      const point: Point2D = { x: 0.5, y: 0.5 }
      const result = generateTrajectory(point, makeConfig(), point)

      // Should still generate points without error
      expect(result.points.length).toBeGreaterThan(0)
      // All points should be at or near the same position
      for (const p of result.points) {
        expect(p.x).toBeGreaterThanOrEqual(0)
        expect(p.x).toBeLessThanOrEqual(1)
        expect(p.y).toBeGreaterThanOrEqual(0)
        expect(p.y).toBeLessThanOrEqual(1)
      }
    })

    it('handles landing at frame edge (0, 0)', () => {
      const landing: Point2D = { x: 0, y: 0 }
      const result = generateTrajectory(landing, makeConfig())
      expect(result.points.length).toBeGreaterThan(0)
      const last = result.points[result.points.length - 1]
      expect(last.x).toBeCloseTo(0, 5)
      expect(last.y).toBeCloseTo(0, 5)
    })

    it('handles landing at frame edge (1, 1)', () => {
      const landing: Point2D = { x: 1, y: 1 }
      const result = generateTrajectory(landing, makeConfig())
      const last = result.points[result.points.length - 1]
      expect(last.x).toBeCloseTo(1, 5)
      expect(last.y).toBeCloseTo(1, 5)
    })
  })
})
