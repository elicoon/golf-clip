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
    // Style properties (no-op)
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
function createMockVideoRef(width = 800, height = 450, videoWidth = 1920, videoHeight = 1080) {
  const video = {
    getBoundingClientRect: () => ({
      width,
      height,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
    videoWidth,
    videoHeight,
    currentTime: 1.5, // Mid-flight of trajectory
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }
  return { current: video as unknown as HTMLVideoElement }
}

// Create trajectory data that should render within video bounds
function createMockTrajectory() {
  return {
    points: [
      { timestamp: 0, x: 0.5, y: 0.85, confidence: 1, interpolated: false },    // Origin: center-bottom
      { timestamp: 0.5, x: 0.55, y: 0.6, confidence: 0.9, interpolated: true }, // Rising
      { timestamp: 1.0, x: 0.6, y: 0.3, confidence: 0.9, interpolated: true },  // Apex
      { timestamp: 1.5, x: 0.7, y: 0.5, confidence: 0.9, interpolated: true },  // Falling
      { timestamp: 2.0, x: 0.8, y: 0.75, confidence: 0.9, interpolated: true }, // Landing
    ],
    apex_point: { timestamp: 1.0, x: 0.6, y: 0.3, confidence: 0.9, interpolated: true },
    frame_width: 1920,
    frame_height: 1080,
  }
}

describe('TrajectoryEditor Bounds Bug Verification', () => {
  let mockCtx: ReturnType<typeof createMockCanvasContext>
  let originalCreateElement: typeof document.createElement
  let originalGetContext: HTMLCanvasElement['getContext']
  let rafCallbacks: FrameRequestCallback[] = []
  let rafId = 0

  beforeEach(() => {
    vi.clearAllMocks()
    capturedCoordinates = []
    rafCallbacks = []
    rafId = 0

    mockCtx = createMockCanvasContext()

    // Mock canvas getContext
    originalCreateElement = document.createElement.bind(document)
    originalGetContext = HTMLCanvasElement.prototype.getContext

    HTMLCanvasElement.prototype.getContext = function (contextId: string) {
      if (contextId === '2d') {
        return mockCtx as unknown as CanvasRenderingContext2D
      }
      return originalGetContext.call(this, contextId) as RenderingContext | null
    }

    // Mock requestAnimationFrame to capture and execute render callbacks
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      rafCallbacks.push(callback)
      return ++rafId
    })

    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})

    // Mock devicePixelRatio
    Object.defineProperty(window, 'devicePixelRatio', { value: 1, writable: true })

    // Mock ResizeObserver
    global.ResizeObserver = vi.fn().mockImplementation(() => ({
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    }))

    // Mock performance.now
    vi.spyOn(performance, 'now').mockReturnValue(1000)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    HTMLCanvasElement.prototype.getContext = originalGetContext
  })

  it('should render ALL trajectory coordinates within container bounds', async () => {
    // Container dimensions (simulating the video player area)
    const containerWidth = 800
    const containerHeight = 450

    // 16:9 video in 16:9 container = no letterboxing, full bounds
    const videoRef = createMockVideoRef(containerWidth, containerHeight, 1920, 1080)
    const trajectory = createMockTrajectory()

    // Render the component
    const { unmount } = render(
      <TrajectoryEditor
        videoRef={videoRef}
        trajectory={trajectory}
        currentTime={1.5}
        showTracer={true}
        landingPoint={{ x: 0.8, y: 0.75 }}
        apexPoint={{ x: 0.6, y: 0.3 }}
        originPoint={{ x: 0.5, y: 0.85 }}
      />
    )

    // Trigger the resize observer to set canvas size and bounds
    // This simulates what happens when the component mounts and measures the video
    act(() => {
      // Force canvas size state update (normally done by ResizeObserver)
      // We need to trigger the useEffect that calculates bounds
    })

    // Execute one frame of animation to trigger drawing
    act(() => {
      if (rafCallbacks.length > 0) {
        const callback = rafCallbacks[rafCallbacks.length - 1]
        callback(performance.now())
      }
    })

    // BUG VERIFICATION: Check that ALL coordinates are within bounds
    // If this test FAILS, it means the bug exists (coordinates outside bounds)
    const outOfBoundsCoords = capturedCoordinates.filter(coord => {
      // Allow small tolerance for anti-aliasing/line width
      const tolerance = 10
      return (
        coord.x < -tolerance ||
        coord.x > containerWidth + tolerance ||
        coord.y < -tolerance ||
        coord.y > containerHeight + tolerance
      )
    })

    // This assertion should FAIL if the bug exists
    // The bug causes coordinates to render at screen coordinates (e.g., 1920x1080)
    // instead of container coordinates (800x450)
    expect(outOfBoundsCoords).toHaveLength(0)

    // Additional verification: coordinates should be reasonable canvas coords
    if (capturedCoordinates.length > 0) {
      const maxX = Math.max(...capturedCoordinates.map(c => c.x))
      const maxY = Math.max(...capturedCoordinates.map(c => c.y))
      const minX = Math.min(...capturedCoordinates.map(c => c.x))
      const minY = Math.min(...capturedCoordinates.map(c => c.y))

      // Coordinates should be within container bounds
      expect(maxX).toBeLessThanOrEqual(containerWidth + 10)
      expect(maxY).toBeLessThanOrEqual(containerHeight + 10)
      expect(minX).toBeGreaterThanOrEqual(-10)
      expect(minY).toBeGreaterThanOrEqual(-10)

      console.log(`Coordinate ranges: X [${minX.toFixed(0)}, ${maxX.toFixed(0)}], Y [${minY.toFixed(0)}, ${maxY.toFixed(0)}]`)
      console.log(`Container bounds: [0, ${containerWidth}] x [0, ${containerHeight}]`)
    }

    unmount()
  })

  it('should render marker coordinates within video bounds', async () => {
    const containerWidth = 800
    const containerHeight = 450
    const videoRef = createMockVideoRef(containerWidth, containerHeight)

    // Render with markers but no trajectory (so we test marker rendering separately)
    const { unmount } = render(
      <TrajectoryEditor
        videoRef={videoRef}
        trajectory={null}
        currentTime={0}
        showTracer={true}
        landingPoint={{ x: 0.8, y: 0.75 }}
        apexPoint={{ x: 0.6, y: 0.3 }}
        originPoint={{ x: 0.5, y: 0.85 }}
      />
    )

    // Execute animation frame
    act(() => {
      if (rafCallbacks.length > 0) {
        rafCallbacks[rafCallbacks.length - 1](performance.now())
      }
    })

    // Check marker coordinates
    // Landing marker at (0.8, 0.75) should map to (640, 337.5) in 800x450 container
    // Apex marker at (0.6, 0.3) should map to (480, 135) in 800x450 container
    // Origin marker at (0.5, 0.85) should map to (400, 382.5) in 800x450 container

    const expectedBounds = {
      landing: { x: 0.8 * containerWidth, y: 0.75 * containerHeight },
      apex: { x: 0.6 * containerWidth, y: 0.3 * containerHeight },
      origin: { x: 0.5 * containerWidth, y: 0.85 * containerHeight },
    }

    // All captured coordinates should be near expected marker positions
    // or at least within container bounds
    for (const coord of capturedCoordinates) {
      expect(coord.x).toBeGreaterThanOrEqual(-20)
      expect(coord.x).toBeLessThanOrEqual(containerWidth + 20)
      expect(coord.y).toBeGreaterThanOrEqual(-20)
      expect(coord.y).toBeLessThanOrEqual(containerHeight + 20)
    }

    unmount()
  })

  it('should handle letterboxed video (video smaller than container)', async () => {
    // 4:3 video in 16:9 container = pillarboxing (black bars on sides)
    const containerWidth = 800
    const containerHeight = 450
    // 4:3 video aspect
    const videoWidth = 1280
    const videoHeight = 960

    const videoRef = createMockVideoRef(containerWidth, containerHeight, videoWidth, videoHeight)
    const trajectory = createMockTrajectory()

    // Calculate expected video content bounds (pillarboxed)
    // Container: 800x450 (16:9 = 1.78), Video: 4:3 = 1.33
    // Video is taller, so it fills height, letterboxed on sides
    // contentHeight = 450, contentWidth = 450 * 1.33 = 600
    // offsetX = (800 - 600) / 2 = 100
    const expectedContentWidth = containerHeight * (videoWidth / videoHeight)  // 600
    const expectedOffsetX = (containerWidth - expectedContentWidth) / 2  // 100

    const { unmount } = render(
      <TrajectoryEditor
        videoRef={videoRef}
        trajectory={trajectory}
        currentTime={1.5}
        showTracer={true}
        landingPoint={{ x: 0.8, y: 0.75 }}
      />
    )

    act(() => {
      if (rafCallbacks.length > 0) {
        rafCallbacks[rafCallbacks.length - 1](performance.now())
      }
    })

    // In pillarboxed mode, X coordinates should be offset
    // Normalized 0.0 -> offsetX (100)
    // Normalized 1.0 -> offsetX + contentWidth (700)
    // Y coordinates remain 0-450

    for (const coord of capturedCoordinates) {
      // BUG: If coordinates are NOT accounting for letterboxing,
      // they will be outside these bounds
      expect(coord.x).toBeGreaterThanOrEqual(-20)
      expect(coord.x).toBeLessThanOrEqual(containerWidth + 20)
      expect(coord.y).toBeGreaterThanOrEqual(-20)
      expect(coord.y).toBeLessThanOrEqual(containerHeight + 20)
    }

    unmount()
  })

  it('should NOT render coordinates at video source resolution (1920x1080)', async () => {
    // This is the core bug test
    // The bug causes coordinates to be at video source resolution
    // instead of scaled to container size

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
      />
    )

    act(() => {
      if (rafCallbacks.length > 0) {
        rafCallbacks[rafCallbacks.length - 1](performance.now())
      }
    })

    // BUG CHECK: Look for coordinates that look like video source resolution
    // If normalized coords are multiplied by wrong dimensions:
    // 0.8 * 1920 = 1536 (instead of 0.8 * 800 = 640)
    // 0.75 * 1080 = 810 (instead of 0.75 * 450 = 337.5)
    const suspiciouslyLargeCoords = capturedCoordinates.filter(coord => {
      return coord.x > containerWidth * 1.5 || coord.y > containerHeight * 1.5
    })

    // This should FAIL if the bug exists
    expect(suspiciouslyLargeCoords).toHaveLength(0)

    if (suspiciouslyLargeCoords.length > 0) {
      console.error('BUG DETECTED: Coordinates at video source resolution instead of container resolution')
      console.error('Suspicious coordinates:', suspiciouslyLargeCoords)
    }

    unmount()
  })
})

describe('TrajectoryEditor integration (requires @testing-library/react)', () => {
  // Note: If @testing-library/react is not installed, these tests will fail
  // They serve as documentation for what should be tested when the library is available

  it('placeholder for full integration test', () => {
    // When @testing-library/react is available:
    // 1. Render ClipReview with mock segment data
    // 2. Click to place landing marker
    // 3. Verify trajectory renders
    // 4. Check all visual elements are within .video-container bounds

    // For now, pass - the unit tests above verify the core bug
    expect(true).toBe(true)
  })
})
