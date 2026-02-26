/**
 * TrajectoryEditor Bounds Bug Verification Test
 *
 * Bug: Trajectory/marker lines render outside video area
 * Issue: Trajectory lines render in bottom-right corner of screen, outside video player
 *
 * This test should FAIL until the bug is fixed.
 *
 * Test Strategy:
 * 1. Mock the canvas context to capture all drawing coordinates
 * 2. Render TrajectoryEditor with trajectory data
 * 3. Verify ALL drawing operations use coordinates within container bounds
 *
 * Root Cause Investigation:
 * Based on the bug description "bottom-right corner of screen", the likely causes are:
 * - Canvas element positioned relative to window instead of container
 * - DevicePixelRatio mismatch between canvas internal size and CSS size
 * - Canvas draws at 2x/3x resolution but CSS doesn't scale it down
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { TrajectoryEditor } from './TrajectoryEditor'
import React from 'react'

// Track all coordinates passed to canvas drawing operations
interface DrawingCoordinate {
  method: string
  x: number
  y: number
}

let capturedCoordinates: DrawingCoordinate[] = []

// Mock canvas context that captures all drawing coordinates
function createMockCanvasContext() {
  capturedCoordinates = []

  const captureCoord = (method: string, x: number, y: number) => {
    capturedCoordinates.push({ method, x, y })
  }

  return {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    moveTo: vi.fn((x: number, y: number) => captureCoord('moveTo', x, y)),
    lineTo: vi.fn((x: number, y: number) => captureCoord('lineTo', x, y)),
    quadraticCurveTo: vi.fn((cpx: number, cpy: number, x: number, y: number) => {
      captureCoord('quadraticCurveTo:control', cpx, cpy)
      captureCoord('quadraticCurveTo:end', x, y)
    }),
    arc: vi.fn((x: number, y: number) => captureCoord('arc', x, y)),
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 0,
    lineCap: '',
    lineJoin: '',
    shadowColor: '',
    shadowBlur: 0,
    globalAlpha: 1,
    filter: '',
  }
}

// Mock video element with realistic dimensions
function createMockVideoRef(
  containerWidth = 800,
  containerHeight = 450,
  videoWidth = 1920,
  videoHeight = 1080,
) {
  const video = {
    getBoundingClientRect: () => ({
      width: containerWidth,
      height: containerHeight,
      top: 0,
      left: 0,
      right: containerWidth,
      bottom: containerHeight,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
    videoWidth,
    videoHeight,
    currentTime: 1.5,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }
  return { current: video as unknown as HTMLVideoElement }
}

// Create trajectory data that should render within video bounds
function createMockTrajectory() {
  return {
    points: [
      { timestamp: 0, x: 0.5, y: 0.85, confidence: 1, interpolated: false },
      { timestamp: 0.5, x: 0.55, y: 0.6, confidence: 0.9, interpolated: true },
      { timestamp: 1.0, x: 0.6, y: 0.3, confidence: 0.9, interpolated: true },
      { timestamp: 1.5, x: 0.7, y: 0.5, confidence: 0.9, interpolated: true },
      { timestamp: 2.0, x: 0.8, y: 0.75, confidence: 0.9, interpolated: true },
    ],
    apex_point: { timestamp: 1.0, x: 0.6, y: 0.3, confidence: 0.9, interpolated: true },
    frame_width: 1920,
    frame_height: 1080,
  }
}

describe('TrajectoryEditor Bounds Bug Verification', () => {
  let mockCtx: ReturnType<typeof createMockCanvasContext>
  let originalGetContext: typeof HTMLCanvasElement.prototype.getContext
  let rafCallbacks: FrameRequestCallback[] = []
  let rafId = 0

  beforeEach(() => {
    vi.clearAllMocks()
    capturedCoordinates = []
    rafCallbacks = []
    rafId = 0

    mockCtx = createMockCanvasContext()
    originalGetContext = HTMLCanvasElement.prototype.getContext

    HTMLCanvasElement.prototype.getContext = function (contextId: string) {
      if (contextId === '2d') {
        return mockCtx as unknown as CanvasRenderingContext2D
      }
      return originalGetContext.call(this, contextId) as RenderingContext | null
    }

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      rafCallbacks.push(callback)
      return ++rafId
    })

    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    Object.defineProperty(window, 'devicePixelRatio', { value: 1, writable: true })

    global.ResizeObserver = vi.fn().mockImplementation(() => ({
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    }))

    vi.spyOn(performance, 'now').mockReturnValue(1000)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    HTMLCanvasElement.prototype.getContext = originalGetContext
  })

  it('should render ALL trajectory coordinates within container bounds', async () => {
    const containerWidth = 800
    const containerHeight = 450

    const videoRef = createMockVideoRef(containerWidth, containerHeight, 1920, 1080)
    const trajectory = createMockTrajectory()

    const { unmount } = render(
      <TrajectoryEditor
        videoRef={videoRef}
        trajectory={trajectory}
        currentTime={1.5}
        showTracer={true}
        landingPoint={{ x: 0.8, y: 0.75 }}
        apexPoint={{ x: 0.6, y: 0.3 }}
        originPoint={{ x: 0.5, y: 0.85 }}
      />,
    )

    act(() => {
      if (rafCallbacks.length > 0) {
        rafCallbacks[rafCallbacks.length - 1](performance.now())
      }
    })

    const outOfBoundsCoords = capturedCoordinates.filter((coord) => {
      const tolerance = 10
      return (
        coord.x < -tolerance ||
        coord.x > containerWidth + tolerance ||
        coord.y < -tolerance ||
        coord.y > containerHeight + tolerance
      )
    })

    expect(outOfBoundsCoords).toHaveLength(0)

    if (capturedCoordinates.length > 0) {
      const maxX = Math.max(...capturedCoordinates.map((c) => c.x))
      const maxY = Math.max(...capturedCoordinates.map((c) => c.y))
      const minX = Math.min(...capturedCoordinates.map((c) => c.x))
      const minY = Math.min(...capturedCoordinates.map((c) => c.y))

      expect(maxX).toBeLessThanOrEqual(containerWidth + 10)
      expect(maxY).toBeLessThanOrEqual(containerHeight + 10)
      expect(minX).toBeGreaterThanOrEqual(-10)
      expect(minY).toBeGreaterThanOrEqual(-10)

      console.log(
        `Coordinate ranges: X [${minX.toFixed(0)}, ${maxX.toFixed(0)}], Y [${minY.toFixed(0)}, ${maxY.toFixed(0)}]`,
      )
      console.log(`Container bounds: [0, ${containerWidth}] x [0, ${containerHeight}]`)
    }

    unmount()
  })

  describe('DevicePixelRatio Bug Tests', () => {
    /**
     * BUG HYPOTHESIS: The bug may occur when devicePixelRatio > 1 (Retina/HiDPI displays).
     *
     * The TrajectoryEditor scales canvas internal resolution by DPR (line 118-119):
     *   canvas.width = rect.width * dpr
     *   canvas.height = rect.height * dpr
     *
     * And applies a transform (line 124):
     *   ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
     *
     * If the CSS size and internal size don't match, coordinates could appear
     * at 2x or 3x scale, pushing them outside the visible area.
     */

    it('BUG TEST: should handle devicePixelRatio = 2 (Retina display)', async () => {
      // Simulate Retina display
      Object.defineProperty(window, 'devicePixelRatio', { value: 2, writable: true })

      const containerWidth = 800
      const containerHeight = 450
      const videoRef = createMockVideoRef(containerWidth, containerHeight, 1920, 1080)
      const trajectory = createMockTrajectory()

      const { container, unmount } = render(
        <TrajectoryEditor
          videoRef={videoRef}
          trajectory={trajectory}
          currentTime={1.5}
          showTracer={true}
          landingPoint={{ x: 0.8, y: 0.75 }}
        />,
      )

      act(() => {
        if (rafCallbacks.length > 0) {
          rafCallbacks[rafCallbacks.length - 1](performance.now())
        }
      })

      // Verify canvas has correct internal size (2x for Retina)
      const canvas = container.querySelector('canvas') as HTMLCanvasElement
      expect(canvas).not.toBeNull()

      // Canvas internal size should be 2x the CSS size
      // If width/height are set in the useEffect, they should be containerWidth * 2
      // But the CSS style.width should still be containerWidth

      // BUG CHECK: Drawing coordinates should still be in CSS pixel space (800x450)
      // NOT in canvas internal space (1600x900)
      for (const coord of capturedCoordinates) {
        expect(coord.x).toBeLessThanOrEqual(containerWidth + 50) // Allow for line width
        expect(coord.y).toBeLessThanOrEqual(containerHeight + 50)
      }

      // If coordinates are at 2x scale, they would be > 800 for x
      const coordsAt2xScale = capturedCoordinates.filter(
        (c) => c.x > containerWidth || c.y > containerHeight,
      )

      // This test should FAIL if the bug exists (coordinates at 2x scale)
      expect(coordsAt2xScale.length).toBe(0)

      if (coordsAt2xScale.length > 0) {
        console.error('BUG DETECTED: Coordinates at 2x scale (DPR issue)')
        console.error('Coordinates exceeding container bounds:', coordsAt2xScale)
      }

      unmount()
    })

    it('BUG TEST: should handle devicePixelRatio = 3 (High-end mobile)', async () => {
      Object.defineProperty(window, 'devicePixelRatio', { value: 3, writable: true })

      const containerWidth = 800
      const containerHeight = 450
      const videoRef = createMockVideoRef(containerWidth, containerHeight, 1920, 1080)
      const trajectory = createMockTrajectory()

      const { unmount } = render(
        <TrajectoryEditor
          videoRef={videoRef}
          trajectory={trajectory}
          currentTime={1.5}
          showTracer={true}
          landingPoint={{ x: 0.8, y: 0.75 }}
        />,
      )

      act(() => {
        if (rafCallbacks.length > 0) {
          rafCallbacks[rafCallbacks.length - 1](performance.now())
        }
      })

      // Coordinates should NOT be at 3x scale
      const coordsAt3xScale = capturedCoordinates.filter(
        (c) => c.x > containerWidth + 50 || c.y > containerHeight + 50,
      )

      expect(coordsAt3xScale.length).toBe(0)

      unmount()
    })
  })

  describe('Canvas Positioning Bug Tests', () => {
    it('BUG TEST: canvas style should use absolute positioning with proper anchor', async () => {
      const containerWidth = 800
      const containerHeight = 450
      const videoRef = createMockVideoRef(containerWidth, containerHeight)

      const { container, unmount } = render(
        <TrajectoryEditor
          videoRef={videoRef}
          trajectory={createMockTrajectory()}
          currentTime={1.5}
          showTracer={true}
          landingPoint={{ x: 0.8, y: 0.75 }}
        />,
      )

      const canvas = container.querySelector('canvas')
      expect(canvas).not.toBeNull()

      if (canvas) {
        const style = canvas.style

        // Canvas MUST be absolutely positioned
        expect(style.position).toBe('absolute')

        // Canvas MUST anchor to top-left (not bottom-right!)
        expect(style.top).toBe('0px')
        expect(style.left).toBe('0px')

        // Canvas should NOT have bottom/right positioning
        // (If it did, it would anchor to bottom-right corner - the bug!)
        expect(style.bottom).toBeFalsy()
        expect(style.right).toBeFalsy()
      }

      unmount()
    })

    it('BUG TEST: canvas z-index should be above video but below controls', async () => {
      const videoRef = createMockVideoRef(800, 450)

      const { container, unmount } = render(
        <TrajectoryEditor
          videoRef={videoRef}
          trajectory={createMockTrajectory()}
          currentTime={1.5}
          showTracer={true}
        />,
      )

      const canvas = container.querySelector('canvas')
      expect(canvas).not.toBeNull()

      if (canvas) {
        // z-index should be set to layer canvas above video
        const zIndex = parseInt(canvas.style.zIndex || '0', 10)
        expect(zIndex).toBeGreaterThan(0) // Should have explicit z-index

        // The component sets z-index: 10 (line 607)
        expect(zIndex).toBe(10)
      }

      unmount()
    })
  })

  describe('Edge Cases', () => {
    it('should NOT render when video dimensions are unknown (0x0)', async () => {
      const containerWidth = 800
      const containerHeight = 450
      const videoRef = createMockVideoRef(containerWidth, containerHeight, 0, 0)
      const trajectory = createMockTrajectory()

      const { unmount } = render(
        <TrajectoryEditor
          videoRef={videoRef}
          trajectory={trajectory}
          currentTime={1.5}
          showTracer={true}
          landingPoint={{ x: 0.8, y: 0.75 }}
        />,
      )

      act(() => {
        if (rafCallbacks.length > 0) {
          rafCallbacks[rafCallbacks.length - 1](performance.now())
        }
      })

      console.log('Coordinates when video has 0x0 dimensions:', capturedCoordinates.length)

      // Should either not draw, or draw valid coordinates
      if (capturedCoordinates.length > 0) {
        const allAtZero = capturedCoordinates.every((c) => c.x === 0 && c.y === 0)
        expect(allAtZero).toBe(false)
      }

      unmount()
    })

    it('should handle container with getBoundingClientRect returning zero', async () => {
      const videoRef = createMockVideoRef(0, 0, 1920, 1080)
      const trajectory = createMockTrajectory()

      const { unmount } = render(
        <TrajectoryEditor
          videoRef={videoRef}
          trajectory={trajectory}
          currentTime={1.5}
          showTracer={true}
          landingPoint={{ x: 0.8, y: 0.75 }}
        />,
      )

      act(() => {
        if (rafCallbacks.length > 0) {
          rafCallbacks[rafCallbacks.length - 1](performance.now())
        }
      })

      console.log('Coordinates when container rect is 0x0:', capturedCoordinates.length)

      for (const coord of capturedCoordinates) {
        expect(coord.x).toBeLessThan(10000)
        expect(coord.y).toBeLessThan(10000)
      }

      unmount()
    })

    it('should render marker coordinates within video bounds', async () => {
      const containerWidth = 800
      const containerHeight = 450
      const videoRef = createMockVideoRef(containerWidth, containerHeight)

      const { unmount } = render(
        <TrajectoryEditor
          videoRef={videoRef}
          trajectory={null}
          currentTime={0}
          showTracer={true}
          landingPoint={{ x: 0.8, y: 0.75 }}
          apexPoint={{ x: 0.6, y: 0.3 }}
          originPoint={{ x: 0.5, y: 0.85 }}
        />,
      )

      act(() => {
        if (rafCallbacks.length > 0) {
          rafCallbacks[rafCallbacks.length - 1](performance.now())
        }
      })

      for (const coord of capturedCoordinates) {
        expect(coord.x).toBeGreaterThanOrEqual(-20)
        expect(coord.x).toBeLessThanOrEqual(containerWidth + 20)
        expect(coord.y).toBeGreaterThanOrEqual(-20)
        expect(coord.y).toBeLessThanOrEqual(containerHeight + 20)
      }

      unmount()
    })

    it('should handle letterboxed video (4:3 video in 16:9 container)', async () => {
      const containerWidth = 800
      const containerHeight = 450
      const videoWidth = 1280
      const videoHeight = 960

      const videoRef = createMockVideoRef(containerWidth, containerHeight, videoWidth, videoHeight)
      const trajectory = createMockTrajectory()

      const { unmount } = render(
        <TrajectoryEditor
          videoRef={videoRef}
          trajectory={trajectory}
          currentTime={1.5}
          showTracer={true}
          landingPoint={{ x: 0.8, y: 0.75 }}
        />,
      )

      act(() => {
        if (rafCallbacks.length > 0) {
          rafCallbacks[rafCallbacks.length - 1](performance.now())
        }
      })

      for (const coord of capturedCoordinates) {
        expect(coord.x).toBeGreaterThanOrEqual(-20)
        expect(coord.x).toBeLessThanOrEqual(containerWidth + 20)
        expect(coord.y).toBeGreaterThanOrEqual(-20)
        expect(coord.y).toBeLessThanOrEqual(containerHeight + 20)
      }

      unmount()
    })
  })

  describe('Coordinate Transformation Unit Tests', () => {
    it('should correctly transform normalized coords to container coords', () => {
      const bounds = { offsetX: 0, offsetY: 0, width: 800, height: 450 }
      const toCanvas = (x: number, y: number) => ({
        x: bounds.offsetX + x * bounds.width,
        y: bounds.offsetY + y * bounds.height,
      })

      expect(toCanvas(0, 0)).toEqual({ x: 0, y: 0 })
      expect(toCanvas(1, 1)).toEqual({ x: 800, y: 450 })
      expect(toCanvas(0.5, 0.5)).toEqual({ x: 400, y: 225 })
      expect(toCanvas(0.8, 0.75)).toEqual({ x: 640, y: 337.5 })
    })

    it('should correctly transform with letterbox offset', () => {
      const bounds = { offsetX: 100, offsetY: 0, width: 600, height: 450 }
      const toCanvas = (x: number, y: number) => ({
        x: bounds.offsetX + x * bounds.width,
        y: bounds.offsetY + y * bounds.height,
      })

      expect(toCanvas(0, 0)).toEqual({ x: 100, y: 0 })
      expect(toCanvas(1, 1)).toEqual({ x: 700, y: 450 })
      expect(toCanvas(0.5, 0.5)).toEqual({ x: 400, y: 225 })

      const testPoints = [0, 0.25, 0.5, 0.75, 1].map((x) => toCanvas(x, 0.5))
      for (const point of testPoints) {
        expect(point.x).toBeGreaterThanOrEqual(100)
        expect(point.x).toBeLessThanOrEqual(700)
      }
    })

    it('should handle zero-size bounds gracefully', () => {
      const bounds = { offsetX: 0, offsetY: 0, width: 0, height: 0 }
      const toCanvas = (x: number, y: number) => ({
        x: bounds.offsetX + x * bounds.width,
        y: bounds.offsetY + y * bounds.height,
      })

      const result = toCanvas(0.8, 0.75)
      expect(result).toEqual({ x: 0, y: 0 })
    })
  })

  describe('BUG: Out-of-bounds apex marker coordinates', () => {
    /**
     * BUG ROOT CAUSE IDENTIFIED:
     *
     * The trajectory generator (trajectory-generator.ts) can produce apex coordinates
     * outside the 0-1 normalized range.
     *
     * Line 81: y: Math.min(origin.y, landingPoint.y) - heightMultiplier
     *
     * Example:
     * - origin.y = 0.2 (user clicked high in frame)
     * - heightMultiplier = 0.35 (high trajectory)
     * - apex.y = 0.2 - 0.35 = -0.15 (NEGATIVE! Outside video bounds!)
     *
     * While trajectory POINTS are clamped (line 109), the APEX_POINT is NOT clamped.
     * This causes the apex marker to render outside the video area.
     */

    it('BUG TEST: should clamp apex marker coordinates to video bounds', async () => {
      const containerWidth = 800
      const containerHeight = 450
      const videoRef = createMockVideoRef(containerWidth, containerHeight)

      // Trajectory with INVALID apex coordinates (outside 0-1 range)
      // This simulates the bug where apex.y becomes negative
      const buggyTrajectory = {
        points: [
          { timestamp: 0, x: 0.5, y: 0.2, confidence: 1, interpolated: false },
          { timestamp: 1, x: 0.6, y: -0.1, confidence: 0.9, interpolated: true }, // NEGATIVE Y!
          { timestamp: 2, x: 0.7, y: 0.2, confidence: 0.9, interpolated: true },
        ],
        apex_point: {
          timestamp: 1,
          x: 0.6,
          y: -0.15, // BUG: Negative Y coordinate - will render ABOVE the video!
          confidence: 0.9,
          interpolated: true,
        },
        frame_width: 1920,
        frame_height: 1080,
      }

      const { unmount } = render(
        <TrajectoryEditor
          videoRef={videoRef}
          trajectory={buggyTrajectory}
          currentTime={1} // At apex time
          showTracer={true}
        />,
      )

      act(() => {
        if (rafCallbacks.length > 0) {
          rafCallbacks[rafCallbacks.length - 1](performance.now())
        }
      })

      // Find coordinates that are out of bounds
      const outOfBoundsCoords = capturedCoordinates.filter((coord) => {
        return coord.x < 0 || coord.x > containerWidth || coord.y < 0 || coord.y > containerHeight
      })

      // Log the bug detection
      if (outOfBoundsCoords.length > 0) {
        console.log('BUG DETECTED: Out-of-bounds coordinates from negative apex Y')
        console.log('Out-of-bounds coordinates:', JSON.stringify(outOfBoundsCoords, null, 2))
        console.log('Container bounds: [0, %d] x [0, %d]', containerWidth, containerHeight)
      }

      // This test should FAIL if the bug exists
      // Out-of-bounds apex at y=-0.15 would render at y = -0.15 * 450 = -67.5
      expect(outOfBoundsCoords).toHaveLength(0)

      unmount()
    })

    it('BUG TEST: should clamp origin marker at edge of frame', async () => {
      const containerWidth = 800
      const containerHeight = 450
      const videoRef = createMockVideoRef(containerWidth, containerHeight)

      // Origin at x > 1.0 (bug scenario)
      const { unmount } = render(
        <TrajectoryEditor
          videoRef={videoRef}
          trajectory={null}
          currentTime={0}
          showTracer={true}
          originPoint={{ x: 1.2, y: 0.5 }} // BUG: x > 1 - outside video!
        />,
      )

      act(() => {
        if (rafCallbacks.length > 0) {
          rafCallbacks[rafCallbacks.length - 1](performance.now())
        }
      })

      // Origin at x=1.2 would render at 1.2 * 800 = 960, outside the 800px container
      const outOfBoundsCoords = capturedCoordinates.filter((coord) => {
        return coord.x > containerWidth + 20 || coord.y > containerHeight + 20
      })

      if (outOfBoundsCoords.length > 0) {
        console.log('BUG DETECTED: Origin marker renders outside container')
        console.log('Out-of-bounds coordinates:', JSON.stringify(outOfBoundsCoords, null, 2))
      }

      // This should FAIL if marker coordinates aren't clamped
      expect(outOfBoundsCoords).toHaveLength(0)

      unmount()
    })

    it('BUG TEST: should handle extreme trajectory shape producing out-of-bounds control points', async () => {
      const containerWidth = 800
      const containerHeight = 450
      const videoRef = createMockVideoRef(containerWidth, containerHeight)

      // Extreme trajectory that could produce out-of-bounds bezier control points
      // The bezier formula can produce points outside 0-1 for extreme control points
      const extremeTrajectory = {
        points: [
          { timestamp: 0, x: 0.1, y: 0.9, confidence: 1, interpolated: false },
          { timestamp: 0.5, x: 0.5, y: -0.2, confidence: 0.9, interpolated: true }, // Way above frame!
          { timestamp: 1, x: 0.9, y: 0.9, confidence: 0.9, interpolated: true },
        ],
        apex_point: { timestamp: 0.5, x: 0.5, y: -0.2, confidence: 0.9, interpolated: true },
        frame_width: 1920,
        frame_height: 1080,
      }

      const { unmount } = render(
        <TrajectoryEditor
          videoRef={videoRef}
          trajectory={extremeTrajectory}
          currentTime={0.5}
          showTracer={true}
        />,
      )

      act(() => {
        if (rafCallbacks.length > 0) {
          rafCallbacks[rafCallbacks.length - 1](performance.now())
        }
      })

      // Any coordinate at y=-0.2 would render at y = -0.2 * 450 = -90 (above the container)
      const coordsBelowZero = capturedCoordinates.filter((coord) => coord.y < 0)

      if (coordsBelowZero.length > 0) {
        console.log('BUG DETECTED: Trajectory renders above video (negative Y coordinates)')
        console.log('Negative Y coordinates:', JSON.stringify(coordsBelowZero, null, 2))
      }

      // This test FAILS if trajectory renders at negative Y
      expect(coordsBelowZero).toHaveLength(0)

      unmount()
    })
  })
})
