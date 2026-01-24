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
  }, [localPoints, currentTime, canvasSize, showTracer, disabled, trajectory?.apex_point, hoveredPoint, draggingPoint])

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
      setDraggingPoint(closestIdx)
      // Capture pointer for reliable drag handling
      canvas.setPointerCapture(e.pointerId)
    }
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

  if (!showTracer) return null

  return (
    <canvas
      ref={canvasRef}
      width={canvasSize.width}
      height={canvasSize.height}
      className="trajectory-canvas"
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
