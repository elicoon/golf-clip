import { useRef, useEffect, useState, useCallback } from 'react'

interface TrajectoryPoint {
  timestamp: number
  x: number
  y: number
  confidence: number
  interpolated: boolean
}

interface TrajectoryEditorProps {
  videoRef: React.RefObject<HTMLVideoElement>
  trajectory: {
    points: TrajectoryPoint[]
    apex_point?: TrajectoryPoint
    frame_width: number
    frame_height: number
  } | null
  currentTime: number  // Still passed for compatibility, but we read video.currentTime directly for 60fps
  onTrajectoryUpdate?: (points: TrajectoryPoint[]) => void
  disabled?: boolean
  showTracer?: boolean
  landingPoint?: { x: number; y: number } | null
  onCanvasClick?: (x: number, y: number) => void
  markingStep?: 'confirming_shot' | 'marking_landing' | 'generating' | 'reviewing'
}

// Custom cursor SVG for landing point marker placement
// Landing cursor: downward arrow (↓)
const landingCursorSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <polygon points="16,28 8,16 12,16 12,4 20,4 20,16 24,16" fill="white" stroke="black" stroke-width="1"/>
</svg>`

// Convert SVG to data URI for cursor
const svgToCursor = (svg: string, hotspotX: number = 16, hotspotY: number = 16): string => {
  const encoded = encodeURIComponent(svg)
  return `url("data:image/svg+xml,${encoded}") ${hotspotX} ${hotspotY}, crosshair`
}

// Check if canvas filter is supported (Safari < 15.4 doesn't support it)
// Note: This variable is intentionally unused but kept for future Safari compatibility
const _supportsFilter = (() => {
  if (typeof document === 'undefined') return false
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  return ctx && 'filter' in ctx
})()
void _supportsFilter // suppress unused warning

export function TrajectoryEditor({
  videoRef,
  trajectory,
  currentTime,
  onTrajectoryUpdate,
  disabled = false,
  showTracer = true,
  landingPoint,
  onCanvasClick,
  markingStep = 'reviewing',
}: TrajectoryEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  // Dragging disabled - state not used for now
  // const [draggingPoint, setDraggingPoint] = useState<number | null>(null)
  // Hover effect disabled - dragging not supported for now
  // const [hoveredPoint, setHoveredPoint] = useState<number | null>(null)
  const [localPoints, setLocalPoints] = useState<TrajectoryPoint[]>([])

  // Sync local points with trajectory prop
  useEffect(() => {
    if (trajectory?.points) {
      setLocalPoints([...trajectory.points])
    } else {
      setLocalPoints([])
    }
  }, [trajectory?.points])

  // Resize canvas to match video with devicePixelRatio scaling for crisp rendering
  useEffect(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return

    const updateSize = () => {
      const rect = video.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1

      // Set canvas internal resolution to match display pixels
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr

      // Scale context to account for devicePixelRatio
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      }

      setCanvasSize({ width: rect.width, height: rect.height })
    }

    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(video)

    // Also update on window resize for DPR changes (e.g., moving between monitors)
    window.addEventListener('resize', updateSize)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateSize)
    }
  }, [videoRef])

  // 60fps animation loop using requestAnimationFrame
  // This reads video.currentTime directly each frame for smooth pixel-by-pixel animation
  useEffect(() => {
    const canvas = canvasRef.current
    const video = videoRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || !video || !showTracer || !canvasSize.width || !canvasSize.height) return

    let animationFrameId: number
    let completionTimestamp: number | null = null  // Track REAL time (performance.now) when trajectory completed
    const HOLD_DURATION_MS = 1500  // Milliseconds to hold the complete trajectory visible

    // Pre-calculate path lengths once (doesn't change during animation)
    const pathLengths: number[] = [0]
    for (let i = 1; i < localPoints.length; i++) {
      const dx = localPoints[i].x - localPoints[i - 1].x
      const dy = localPoints[i].y - localPoints[i - 1].y
      const segmentLength = Math.sqrt(dx * dx + dy * dy)
      pathLengths.push(pathLengths[i - 1] + segmentLength)
    }
    const totalPathLength = pathLengths[pathLengths.length - 1]

    // Convert time ratio to display progress using golf ball physics
    // Based on research: ball covers most distance early (high velocity), slows before apex,
    // then descends at near-constant speed (drag limits acceleration, terminal velocity ~72mph)
    //
    // Physics-based timing:
    // - Ball launches at ~160mph, lands at ~70mph
    // - Covers ~45% of path in first 25% of time (peak velocity phase)
    // - Apex around 50-55% of time, ~55% of path distance
    // - Descent is nearly linear (terminal velocity limited, no real acceleration)
    //
    // Uses a single continuous curve (modified Bezier) to avoid abrupt transitions
    const timeToProgress = (t: number): number => {
      if (t <= 0) return 0
      if (t >= 1) return 1

      // Single continuous easing function using a custom curve
      // This avoids the jarring transition between discrete stages
      //
      // The curve is designed to:
      // - Start fast (explosive launch)
      // - Smoothly decelerate approaching apex (~50% time)
      // - Nearly linear descent after apex
      //
      // We use a combination of easing functions blended by a smoothstep
      // to create one continuous curve

      // Use a monotonic easing function that:
      // - Has fast early progress (ease-out character)
      // - Gradually decelerates without abrupt transitions
      // - Never goes backwards (guaranteed monotonic)
      //
      // We blend easeOutCubic with linear using a smooth transition
      // Both curves are monotonic, and linear >= cubic at all points,
      // so any blend is also monotonic.

      // easeOutCubic: fast start, slowing down
      const easeOut = 1 - Math.pow(1 - t, 3)

      // Linear component
      const linear = t

      // Blend from easeOut (early) toward more linear (late)
      // Use smooth blend that transitions from 70% easeOut to 30% easeOut
      const easeWeight = 0.7 - 0.4 * t  // Goes from 0.7 at t=0 to 0.3 at t=1

      // Combined progress (weighted average)
      const progress = easeOut * easeWeight + linear * (1 - easeWeight)

      return Math.min(1, Math.max(0, progress))
    }

    // Helper to convert normalized coords to canvas coords
    const toCanvas = (x: number, y: number) => ({
      x: x * canvasSize.width,
      y: y * canvasSize.height,
    })

    // Helper to draw smooth curve using quadratic Bezier spline
    const drawSmoothCurve = (points: TrajectoryPoint[]) => {
      if (points.length < 2) return

      const first = toCanvas(points[0].x, points[0].y)
      ctx.moveTo(first.x, first.y)

      if (points.length === 2) {
        const second = toCanvas(points[1].x, points[1].y)
        ctx.lineTo(second.x, second.y)
        return
      }

      for (let i = 1; i < points.length - 1; i++) {
        const current = toCanvas(points[i].x, points[i].y)
        const next = toCanvas(points[i + 1].x, points[i + 1].y)
        const midX = (current.x + next.x) / 2
        const midY = (current.y + next.y) / 2
        ctx.quadraticCurveTo(current.x, current.y, midX, midY)
      }

      const last = toCanvas(points[points.length - 1].x, points[points.length - 1].y)
      const secondLast = toCanvas(points[points.length - 2].x, points[points.length - 2].y)
      ctx.quadraticCurveTo(secondLast.x, secondLast.y, last.x, last.y)
    }

    // Main render function - called 60 times per second
    const render = () => {
      const dpr = window.devicePixelRatio || 1
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, canvasSize.width, canvasSize.height)

      // Draw landing marker (downward arrow)
      if (landingPoint) {
        const markerX = landingPoint.x * canvasSize.width
        const markerY = landingPoint.y * canvasSize.height
        const arrowWidth = 12
        const arrowHeight = 14
        const lineWidth = 24

        ctx.save()
        ctx.shadowColor = 'rgba(255, 255, 255, 0.8)'
        ctx.shadowBlur = 8
        ctx.strokeStyle = '#ffffff'
        ctx.fillStyle = '#ffffff'
        ctx.lineWidth = 2
        ctx.lineCap = 'round'

        ctx.beginPath()
        ctx.moveTo(markerX, markerY)
        ctx.lineTo(markerX - arrowWidth / 2, markerY - arrowHeight)
        ctx.lineTo(markerX + arrowWidth / 2, markerY - arrowHeight)
        ctx.closePath()
        ctx.fill()

        ctx.beginPath()
        ctx.moveTo(markerX - lineWidth / 2, markerY + 3)
        ctx.lineTo(markerX + lineWidth / 2, markerY + 3)
        ctx.stroke()

        ctx.restore()
      }

      // Skip trajectory drawing if no points
      if (!localPoints.length) {
        animationFrameId = requestAnimationFrame(render)
        return
      }

      // Read video time directly for 60fps precision
      const videoTime = video.currentTime
      const firstPointTime = localPoints[0].timestamp
      const lastPointTime = localPoints[localPoints.length - 1].timestamp
      const timeRange = lastPointTime - firstPointTime

      const timeRatio = timeRange > 0
        ? Math.max(0, Math.min(1, (videoTime - firstPointTime) / timeRange))
        : 0

      let displayProgress = timeToProgress(timeRatio)

      // Handle trajectory completion hold - keep full line visible for HOLD_DURATION after completion
      // Use real time (performance.now) so hold works even if video loops
      const now = performance.now()

      if (timeRatio >= 1.0) {
        // We're at or past the trajectory end time
        if (completionTimestamp === null) {
          completionTimestamp = now
        }
        displayProgress = 1.0
      } else if (completionTimestamp !== null) {
        // Trajectory was complete - check if we're still in the hold period
        const msSinceCompletion = now - completionTimestamp
        if (msSinceCompletion <= HOLD_DURATION_MS) {
          // Still in hold period - keep full trajectory visible even though video may have looped
          displayProgress = 1.0
        } else {
          // Hold period expired - reset and allow normal animation
          completionTimestamp = null
        }
      }

      // Calculate target distance in pixels for sub-pixel precision check
      const targetDistance = displayProgress * totalPathLength
      // Note: targetPixelDistance kept for potential future sub-pixel precision optimization
      void (targetDistance * canvasSize.width) // suppress unused warning

      // Find which segment contains the target distance and interpolate
      let endPointIndex = localPoints.length - 1
      let interpolatedEndPoint: { x: number; y: number } | null = null

      for (let i = 1; i < localPoints.length; i++) {
        if (pathLengths[i] >= targetDistance) {
          endPointIndex = i
          const segmentStart = pathLengths[i - 1]
          const segmentEnd = pathLengths[i]
          const segmentLength = segmentEnd - segmentStart
          const t = segmentLength > 0 ? (targetDistance - segmentStart) / segmentLength : 0

          interpolatedEndPoint = {
            x: localPoints[i - 1].x + t * (localPoints[i].x - localPoints[i - 1].x),
            y: localPoints[i - 1].y + t * (localPoints[i].y - localPoints[i - 1].y),
          }
          break
        }
      }

      // Build visible points array with interpolated end point
      const visiblePoints: TrajectoryPoint[] = localPoints.slice(0, endPointIndex)
      if (interpolatedEndPoint) {
        visiblePoints.push({
          ...localPoints[Math.min(endPointIndex, localPoints.length - 1)],
          x: interpolatedEndPoint.x,
          y: interpolatedEndPoint.y,
        })
      }

      if (visiblePoints.length >= 2) {
        // Draw RED trajectory line with glow effect
        ctx.save()

        // Outer glow layer
        ctx.strokeStyle = '#ff0000'
        ctx.lineWidth = 8
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.shadowColor = '#ff0000'
        ctx.shadowBlur = 16
        ctx.globalAlpha = 0.4

        ctx.beginPath()
        drawSmoothCurve(visiblePoints)
        ctx.stroke()

        // Inner glow layer
        ctx.shadowBlur = 8
        ctx.lineWidth = 5
        ctx.globalAlpha = 0.6
        ctx.beginPath()
        drawSmoothCurve(visiblePoints)
        ctx.stroke()

        // Core RED line
        ctx.shadowBlur = 4
        ctx.lineWidth = 3
        ctx.globalAlpha = 1.0
        ctx.beginPath()
        drawSmoothCurve(visiblePoints)
        ctx.stroke()

        ctx.restore()
      }

      // Draw apex marker if visible
      if (trajectory?.apex_point && videoTime >= trajectory.apex_point.timestamp) {
        const apex = toCanvas(trajectory.apex_point.x, trajectory.apex_point.y)
        ctx.save()
        ctx.fillStyle = '#ff0000'
        ctx.shadowColor = '#ff0000'
        ctx.shadowBlur = 8
        ctx.beginPath()
        ctx.arc(apex.x, apex.y, 5, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }

      // Continue animation loop
      animationFrameId = requestAnimationFrame(render)
    }

    // Start the 60fps animation loop
    animationFrameId = requestAnimationFrame(render)

    // Cleanup on unmount or dependency change
    return () => {
      cancelAnimationFrame(animationFrameId)
    }
  }, [localPoints, canvasSize, showTracer, disabled, trajectory?.apex_point, landingPoint, videoRef])

  // Find closest point to a normalized position
  // NOTE: Temporarily disabled - dragging feature moved to backlog
  // Keeping the function definition for future use when dragging is re-enabled
  // const findClosestPoint = useCallback((x: number, y: number): number => {
  //   const visiblePoints = localPoints.filter(p => p.timestamp <= currentTime)
  //   let closestIdx = -1
  //   let closestDist = Infinity
  //
  //   for (let i = 0; i < visiblePoints.length; i++) {
  //     const pt = visiblePoints[i]
  //     const dist = Math.sqrt((pt.x - x) ** 2 + (pt.y - y) ** 2)
  //     if (dist < 0.03 && dist < closestDist) { // 3% threshold
  //       closestDist = dist
  //       closestIdx = localPoints.indexOf(pt)
  //     }
  //   }
  //   return closestIdx
  // }, [localPoints, currentTime])
  void currentTime  // suppress unused warning - kept for future drag feature
  void onTrajectoryUpdate  // suppress unused warning - kept for API compatibility

  // Pointer handlers - dragging disabled for now to allow marker placement
  // TODO: Add tracer point dragging to backlog as optional feature
  const handlePointerDown = useCallback((_e: React.PointerEvent) => {
    // Dragging disabled - all clicks pass through to parent for marker placement
    // This ensures users can always place target/landing/apex markers
  }, [])

  const handlePointerMove = useCallback((_e: React.PointerEvent) => {
    // Dragging disabled - no hover effects needed
    // All pointer events pass through to parent for marker placement
  }, [])

  const handlePointerUp = useCallback((_e: React.PointerEvent) => {
    // Dragging disabled - nothing to do on pointer up
  }, [])

  const handlePointerLeave = useCallback(() => {
    // Hover effect disabled - nothing to clear
  }, [])

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (disabled || !canvasRef.current || !onCanvasClick) return

    // Dragging disabled - all clicks pass through for marker placement

    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height

    // All clicks trigger marker placement (tracer is not selectable for now)
    onCanvasClick(
      Math.max(0, Math.min(1, x)),
      Math.max(0, Math.min(1, y))
    )
  }, [disabled, onCanvasClick])

  if (!showTracer) return null

  // Get cursor based on marking step
  const getCursor = () => {
    switch (markingStep) {
      case 'marking_landing':
        return svgToCursor(landingCursorSvg, 16, 28)  // Hotspot at arrow tip
      default:
        return 'default'
    }
  }

  return (
    <canvas
      ref={canvasRef}
      className="trajectory-canvas"
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: canvasSize.width || '100%',
        height: canvasSize.height || '100%',
        pointerEvents: disabled ? 'none' : 'auto',
        cursor: getCursor(),
        touchAction: 'none', // Prevent scroll/zoom while interacting
        zIndex: 10,
        filter: 'none',
        mixBlendMode: 'normal' as const,
      }}
    />
  )
}
