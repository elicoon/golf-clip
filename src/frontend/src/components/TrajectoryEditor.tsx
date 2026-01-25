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
  currentTime: number
  onTrajectoryUpdate?: (points: TrajectoryPoint[]) => void
  disabled?: boolean
  showTracer?: boolean
  landingPoint?: { x: number; y: number } | null
  targetPoint?: { x: number; y: number } | null
  onCanvasClick?: (x: number, y: number) => void
}

// Check if canvas filter is supported (Safari < 15.4 doesn't support it)
const supportsFilter = (() => {
  if (typeof document === 'undefined') return false
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  return ctx && 'filter' in ctx
})()

export function TrajectoryEditor({
  videoRef,
  trajectory,
  currentTime,
  onTrajectoryUpdate,
  disabled = false,
  showTracer = true,
  landingPoint,
  targetPoint,
  onCanvasClick,
}: TrajectoryEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const [draggingPoint, setDraggingPoint] = useState<number | null>(null)
  const [hoveredPoint, setHoveredPoint] = useState<number | null>(null)
  const [localPoints, setLocalPoints] = useState<TrajectoryPoint[]>([])

  // Sync local points with trajectory prop
  useEffect(() => {
    if (trajectory?.points) {
      setLocalPoints([...trajectory.points])
    } else {
      setLocalPoints([])
    }
  }, [trajectory?.points])

  // Resize canvas to match video
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const updateSize = () => {
      const rect = video.getBoundingClientRect()
      setCanvasSize({ width: rect.width, height: rect.height })
    }

    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(video)

    return () => observer.disconnect()
  }, [videoRef])

  // Draw trajectory
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || !showTracer) return

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    if (!localPoints.length) return

    // Filter points up to current time
    const visiblePoints = localPoints.filter(p => p.timestamp <= currentTime)
    if (visiblePoints.length < 2) return

    // Convert normalized coords to canvas coords
    const toCanvas = (x: number, y: number) => ({
      x: x * canvas.width,
      y: y * canvas.height,
    })

    // Draw glow layer (with fallback for browsers without filter support)
    ctx.save()
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)'
    ctx.lineWidth = 12
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    if (supportsFilter) {
      ctx.filter = 'blur(8px)'
    } else {
      // Fallback: draw multiple layers with increasing transparency
      ctx.lineWidth = 16
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)'
    }

    ctx.beginPath()
    const first = toCanvas(visiblePoints[0].x, visiblePoints[0].y)
    ctx.moveTo(first.x, first.y)
    for (let i = 1; i < visiblePoints.length; i++) {
      const pt = toCanvas(visiblePoints[i].x, visiblePoints[i].y)
      ctx.lineTo(pt.x, pt.y)
    }
    ctx.stroke()
    ctx.restore()

    // Draw main line
    ctx.strokeStyle = '#FFFFFF'
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    ctx.beginPath()
    ctx.moveTo(first.x, first.y)
    for (let i = 1; i < visiblePoints.length; i++) {
      const pt = toCanvas(visiblePoints[i].x, visiblePoints[i].y)
      ctx.lineTo(pt.x, pt.y)
    }
    ctx.stroke()

    // Draw apex marker if visible
    if (trajectory?.apex_point && trajectory.apex_point.timestamp <= currentTime) {
      const apex = toCanvas(trajectory.apex_point.x, trajectory.apex_point.y)
      ctx.fillStyle = '#FFFFFF'
      ctx.beginPath()
      ctx.arc(apex.x, apex.y, 6, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#000000'
      ctx.lineWidth = 2
      ctx.stroke()
    }

    // Draw control points if not disabled (for editing)
    if (!disabled) {
      for (let i = 0; i < visiblePoints.length; i++) {
        const pt = toCanvas(visiblePoints[i].x, visiblePoints[i].y)
        const pointIndex = localPoints.indexOf(visiblePoints[i])
        const isHovered = pointIndex === hoveredPoint
        const isDragging = pointIndex === draggingPoint

        // Draw hover/drag highlight ring
        if (isHovered || isDragging) {
          ctx.strokeStyle = '#FFFF00'
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.arc(pt.x, pt.y, 10, 0, Math.PI * 2)
          ctx.stroke()
        }

        // Draw point with different colors based on state
        if (isDragging) {
          ctx.fillStyle = '#FFFF00'
        } else if (visiblePoints[i].interpolated) {
          ctx.fillStyle = '#888888'
        } else {
          ctx.fillStyle = '#00FF00'
        }
        ctx.beginPath()
        ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    // Draw landing marker (downward arrow touching ground line)
    if (landingPoint && canvas.width && canvas.height) {
      const markerX = landingPoint.x * canvas.width
      const markerY = landingPoint.y * canvas.height
      const arrowWidth = 12
      const arrowHeight = 14
      const lineWidth = 24

      ctx.save()

      // Glow effect
      ctx.shadowColor = 'rgba(255, 255, 255, 0.8)'
      ctx.shadowBlur = 8

      ctx.strokeStyle = '#ffffff'
      ctx.fillStyle = '#ffffff'
      ctx.lineWidth = 2
      ctx.lineCap = 'round'

      // Draw downward arrow (triangle)
      ctx.beginPath()
      ctx.moveTo(markerX, markerY)  // Tip at landing point
      ctx.lineTo(markerX - arrowWidth / 2, markerY - arrowHeight)
      ctx.lineTo(markerX + arrowWidth / 2, markerY - arrowHeight)
      ctx.closePath()
      ctx.fill()

      // Draw ground line below arrow tip
      ctx.beginPath()
      ctx.moveTo(markerX - lineWidth / 2, markerY + 3)
      ctx.lineTo(markerX + lineWidth / 2, markerY + 3)
      ctx.stroke()

      ctx.restore()
    }

    // Draw target marker (crosshair with circle)
    if (targetPoint && canvas.width && canvas.height) {
      const markerX = targetPoint.x * canvas.width
      const markerY = targetPoint.y * canvas.height
      const circleRadius = 16
      const crosshairExtend = 8  // How far lines extend beyond circle

      ctx.save()

      // Glow effect
      ctx.shadowColor = 'rgba(255, 255, 255, 0.8)'
      ctx.shadowBlur = 6

      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2
      ctx.lineCap = 'round'

      // Draw circle
      ctx.beginPath()
      ctx.arc(markerX, markerY, circleRadius, 0, Math.PI * 2)
      ctx.stroke()

      // Draw crosshair lines extending beyond circle
      // Vertical line (top part)
      ctx.beginPath()
      ctx.moveTo(markerX, markerY - circleRadius - crosshairExtend)
      ctx.lineTo(markerX, markerY - circleRadius + 4)
      ctx.stroke()

      // Vertical line (bottom part)
      ctx.beginPath()
      ctx.moveTo(markerX, markerY + circleRadius - 4)
      ctx.lineTo(markerX, markerY + circleRadius + crosshairExtend)
      ctx.stroke()

      // Horizontal line (left part)
      ctx.beginPath()
      ctx.moveTo(markerX - circleRadius - crosshairExtend, markerY)
      ctx.lineTo(markerX - circleRadius + 4, markerY)
      ctx.stroke()

      // Horizontal line (right part)
      ctx.beginPath()
      ctx.moveTo(markerX + circleRadius - 4, markerY)
      ctx.lineTo(markerX + circleRadius + crosshairExtend, markerY)
      ctx.stroke()

      ctx.restore()
    }
  }, [localPoints, currentTime, canvasSize, showTracer, disabled, trajectory?.apex_point, hoveredPoint, draggingPoint, landingPoint, targetPoint])

  // Find closest point to a normalized position
  const findClosestPoint = useCallback((x: number, y: number): number => {
    const visiblePoints = localPoints.filter(p => p.timestamp <= currentTime)
    let closestIdx = -1
    let closestDist = Infinity

    for (let i = 0; i < visiblePoints.length; i++) {
      const pt = visiblePoints[i]
      const dist = Math.sqrt((pt.x - x) ** 2 + (pt.y - y) ** 2)
      if (dist < 0.03 && dist < closestDist) { // 3% threshold
        closestDist = dist
        closestIdx = localPoints.indexOf(pt)
      }
    }
    return closestIdx
  }, [localPoints, currentTime])

  // Pointer handlers for point dragging (supports both mouse and touch)
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (disabled || !canvasRef.current) return

    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height

    const closestIdx = findClosestPoint(x, y)

    if (closestIdx >= 0) {
      // Dragging an existing trajectory point
      setDraggingPoint(closestIdx)
      canvas.setPointerCapture(e.pointerId)
      e.stopPropagation()  // Only stop propagation when we're handling it
    }
    // If no point found, let the event bubble up to parent (for landing/target marking)
  }, [disabled, findClosestPoint])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!canvasRef.current) return

    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))

    if (draggingPoint !== null) {
      // Dragging a point
      setLocalPoints(prev => {
        const updated = [...prev]
        updated[draggingPoint] = {
          ...updated[draggingPoint],
          x,
          y,
          interpolated: false, // Manual edit
        }
        return updated
      })
    } else if (!disabled) {
      // Just hovering - find closest point for hover effect
      const closestIdx = findClosestPoint(x, y)
      setHoveredPoint(closestIdx >= 0 ? closestIdx : null)
    }
  }, [draggingPoint, disabled, findClosestPoint])

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (canvasRef.current) {
      canvasRef.current.releasePointerCapture(e.pointerId)
    }
    if (draggingPoint !== null) {
      setDraggingPoint(null)
      onTrajectoryUpdate?.(localPoints)
    }
  }, [draggingPoint, localPoints, onTrajectoryUpdate])

  const handlePointerLeave = useCallback(() => {
    setHoveredPoint(null)
  }, [])

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (disabled || !canvasRef.current || !onCanvasClick) return

    // Only fire if not dragging a point
    if (draggingPoint !== null) return

    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height

    // Check if clicking near an existing trajectory point
    const closestIdx = findClosestPoint(x, y)
    if (closestIdx >= 0) return  // Don't trigger if near a draggable point

    onCanvasClick(
      Math.max(0, Math.min(1, x)),
      Math.max(0, Math.min(1, y))
    )
  }, [disabled, onCanvasClick, draggingPoint, findClosestPoint])

  if (!showTracer) return null

  return (
    <canvas
      ref={canvasRef}
      width={canvasSize.width}
      height={canvasSize.height}
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
        width: '100%',
        height: '100%',
        pointerEvents: disabled ? 'none' : 'auto',
        cursor: draggingPoint !== null ? 'grabbing' : (hoveredPoint !== null ? 'grab' : 'crosshair'),
        touchAction: 'none', // Prevent scroll/zoom while interacting
      }}
    />
  )
}
