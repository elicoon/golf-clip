import { useRef, useEffect, useState, useCallback } from 'react'
import { drawTracerLine } from '../lib/tracer-renderer'
import { DEFAULT_TRACER_STYLE } from '../types/tracer'

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
  apexPoint?: { x: number; y: number } | null
  originPoint?: { x: number; y: number } | null
  onCanvasClick?: (x: number, y: number) => void
  markingStep?: 'confirming_shot' | 'marking_landing' | 'generating' | 'reviewing'
  isMarkingApex?: boolean
  isMarkingOrigin?: boolean
  isMarkingLanding?: boolean
}

// Custom cursor SVG for landing point marker placement
// Landing cursor: downward arrow (arrow-down)
const landingCursorSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <polygon points="16,28 8,16 12,16 12,4 20,4 20,16 24,16" fill="white" stroke="black" stroke-width="1"/>
</svg>`

// Apex cursor: diamond shape (highest point marker)
const apexCursorSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <polygon points="16,4 28,16 16,28 4,16" fill="#FFD700" stroke="black" stroke-width="1"/>
</svg>`

// Origin cursor: circle with dot (starting point marker)
const originCursorSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <circle cx="16" cy="16" r="10" fill="none" stroke="#00FF00" stroke-width="2"/>
  <circle cx="16" cy="16" r="3" fill="#00FF00"/>
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
  apexPoint,
  originPoint,
  onCanvasClick,
  markingStep = 'reviewing',
  isMarkingApex = false,
  isMarkingOrigin = false,
  isMarkingLanding = false,
}: TrajectoryEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  // Video content bounds within the canvas (accounting for object-fit: contain letterboxing)
  const [videoContentBounds, setVideoContentBounds] = useState<{
    offsetX: number
    offsetY: number
    width: number
    height: number
  } | null>(null)
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
  // Also calculate video content bounds to account for object-fit: contain letterboxing
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

      // Calculate video content bounds (where the actual video renders within the container)
      // This accounts for object-fit: contain letterboxing
      const containerWidth = rect.width
      const containerHeight = rect.height
      const videoWidth = video.videoWidth
      const videoHeight = video.videoHeight

      if (videoWidth && videoHeight) {
        const containerRatio = containerWidth / containerHeight
        const videoRatio = videoWidth / videoHeight

        let contentWidth: number
        let contentHeight: number
        let offsetX: number
        let offsetY: number

        if (videoRatio > containerRatio) {
          // Video is wider than container - letterbox top/bottom
          contentWidth = containerWidth
          contentHeight = containerWidth / videoRatio
          offsetX = 0
          offsetY = (containerHeight - contentHeight) / 2
        } else {
          // Video is taller than container - letterbox left/right
          contentHeight = containerHeight
          contentWidth = containerHeight * videoRatio
          offsetX = (containerWidth - contentWidth) / 2
          offsetY = 0
        }

        setVideoContentBounds({ offsetX, offsetY, width: contentWidth, height: contentHeight })
      }
    }

    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(video)

    // Update when video metadata loads (to get videoWidth/videoHeight)
    video.addEventListener('loadedmetadata', updateSize)

    // Also update on window resize for DPR changes (e.g., moving between monitors)
    window.addEventListener('resize', updateSize)

    return () => {
      observer.disconnect()
      video.removeEventListener('loadedmetadata', updateSize)
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

    // Helper to convert normalized coords (0-1) to canvas coords
    // Uses video content bounds to account for object-fit: contain letterboxing
    const bounds = videoContentBounds || { offsetX: 0, offsetY: 0, width: canvasSize.width, height: canvasSize.height }

    // Clamped version that ensures coordinates stay within video bounds (used by markers)
    const clampedToCanvas = (x: number, y: number) => ({
      x: bounds.offsetX + Math.max(0, Math.min(1, x)) * bounds.width,
      y: bounds.offsetY + Math.max(0, Math.min(1, y)) * bounds.height,
    })

    // Main render function - called 60 times per second
    const render = () => {
      const dpr = window.devicePixelRatio || 1
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, canvasSize.width, canvasSize.height)

      // Draw landing marker (downward arrow)
      if (landingPoint) {
        const markerPos = clampedToCanvas(landingPoint.x, landingPoint.y)
        const markerX = markerPos.x
        const markerY = markerPos.y
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

      // Draw user-marked apex point (gold diamond)
      if (apexPoint) {
        const apexPos = clampedToCanvas(apexPoint.x, apexPoint.y)
        const apexX = apexPos.x
        const apexY = apexPos.y
        const diamondSize = 10

        ctx.save()
        ctx.shadowColor = 'rgba(255, 215, 0, 0.8)'
        ctx.shadowBlur = 8
        ctx.fillStyle = '#FFD700'
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 2

        ctx.beginPath()
        ctx.moveTo(apexX, apexY - diamondSize)
        ctx.lineTo(apexX + diamondSize, apexY)
        ctx.lineTo(apexX, apexY + diamondSize)
        ctx.lineTo(apexX - diamondSize, apexY)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()

        ctx.restore()
      }

      // Draw user-marked origin point (green circle with dot)
      if (originPoint) {
        const originPos = clampedToCanvas(originPoint.x, originPoint.y)
        const originX = originPos.x
        const originY = originPos.y
        const outerRadius = 12
        const innerRadius = 4

        ctx.save()
        ctx.shadowColor = 'rgba(0, 255, 0, 0.8)'
        ctx.shadowBlur = 8
        ctx.strokeStyle = '#00FF00'
        ctx.fillStyle = '#00FF00'
        ctx.lineWidth = 2

        // Outer circle
        ctx.beginPath()
        ctx.arc(originX, originY, outerRadius, 0, Math.PI * 2)
        ctx.stroke()

        // Inner dot
        ctx.beginPath()
        ctx.arc(originX, originY, innerRadius, 0, Math.PI * 2)
        ctx.fill()

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

      // Handle trajectory completion hold - keep full line visible for HOLD_DURATION after completion
      // Use real time (performance.now) so hold works even if video loops
      const now = performance.now()

      let effectiveTime = videoTime
      if (timeRatio >= 1.0) {
        if (completionTimestamp === null) {
          completionTimestamp = now
        }
        effectiveTime = lastPointTime // force full trajectory
      } else if (completionTimestamp !== null) {
        const msSinceCompletion = now - completionTimestamp
        if (msSinceCompletion <= HOLD_DURATION_MS) {
          effectiveTime = lastPointTime // still in hold period
        } else {
          completionTimestamp = null
        }
      }

      // Draw trajectory using shared renderer (same code as export pipeline)
      drawTracerLine({
        ctx,
        points: localPoints,
        currentTime: effectiveTime,
        width: canvasSize.width,
        height: canvasSize.height,
        style: DEFAULT_TRACER_STYLE,
        contentBounds: videoContentBounds || undefined,
      })

      // Draw apex marker if visible
      if (trajectory?.apex_point && videoTime >= trajectory.apex_point.timestamp) {
        const apex = clampedToCanvas(trajectory.apex_point.x, trajectory.apex_point.y)
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
  }, [localPoints, canvasSize, videoContentBounds, showTracer, disabled, trajectory?.apex_point, landingPoint, apexPoint, originPoint, videoRef])

  // Suppress unused parameter warnings - kept for API compatibility
  void currentTime
  void onTrajectoryUpdate

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

    // Get click position relative to canvas
    const clickX = e.clientX - rect.left
    const clickY = e.clientY - rect.top

    // Convert to normalized coordinates relative to video content area (not full canvas)
    // This accounts for object-fit: contain letterboxing
    const bounds = videoContentBounds || { offsetX: 0, offsetY: 0, width: rect.width, height: rect.height }
    const x = (clickX - bounds.offsetX) / bounds.width
    const y = (clickY - bounds.offsetY) / bounds.height

    // All clicks trigger marker placement (tracer is not selectable for now)
    onCanvasClick(
      Math.max(0, Math.min(1, x)),
      Math.max(0, Math.min(1, y))
    )
  }, [disabled, onCanvasClick, videoContentBounds])

  if (!showTracer) return null

  // Get cursor based on marking step or mode
  const getCursor = () => {
    // Origin marking takes priority when active
    if (isMarkingOrigin) {
      return svgToCursor(originCursorSvg, 16, 16)  // Hotspot at center of circle
    }
    // Apex marking takes priority when active
    if (isMarkingApex) {
      return svgToCursor(apexCursorSvg, 16, 16)  // Hotspot at center of diamond
    }
    // Landing re-marking mode
    if (isMarkingLanding) {
      return svgToCursor(landingCursorSvg, 16, 28)  // Hotspot at arrow tip
    }
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
        overflow: 'hidden', // Safety net for any out-of-bounds rendering
      }}
    />
  )
}
