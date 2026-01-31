// apps/browser/src/lib/canvas-compositor.ts

export interface TrajectoryPoint {
  x: number  // 0-1 normalized
  y: number  // 0-1 normalized
  timestamp: number
}

export interface TracerStyle {
  color: string
  lineWidth: number
  glowEnabled?: boolean
  glowColor?: string
  glowRadius?: number
}

export interface CompositeOptions {
  trajectory: TrajectoryPoint[]
  currentTime: number
  startTime: number
  endTime: number
  tracerStyle: TracerStyle
  landingPoint?: { x: number; y: number }
  apexPoint?: { x: number; y: number }
  originPoint?: { x: number; y: number }
}

export class CanvasCompositor {
  private canvas: OffscreenCanvas
  private ctx: OffscreenCanvasRenderingContext2D

  constructor(width: number, height: number) {
    this.canvas = new OffscreenCanvas(width, height)
    const ctx = this.canvas.getContext('2d')
    if (!ctx) {
      throw new Error('Failed to get 2D context from OffscreenCanvas')
    }
    this.ctx = ctx
  }

  /**
   * Composite a video frame with tracer overlay
   * @param videoFrame - The video frame to composite (canvas, image, or ImageBitmap)
   * @param options - Composite options including trajectory and style
   * @returns ImageData containing the composited frame
   */
  compositeFrame(
    videoFrame: HTMLCanvasElement | ImageBitmap | HTMLImageElement,
    options: CompositeOptions
  ): ImageData {
    const { trajectory, currentTime, startTime, endTime, tracerStyle, landingPoint, apexPoint, originPoint } = options
    const width = this.canvas.width
    const height = this.canvas.height

    // Clear and draw video frame
    this.ctx.clearRect(0, 0, width, height)
    this.ctx.drawImage(videoFrame, 0, 0, width, height)

    // Draw tracer path up to current time
    this.drawTracer(trajectory, currentTime, startTime, endTime, tracerStyle, width, height)

    // Draw markers if provided
    if (originPoint) {
      this.drawMarker(originPoint.x * width, originPoint.y * height, '#00ff00', 'Origin')
    }
    if (apexPoint) {
      this.drawMarker(apexPoint.x * width, apexPoint.y * height, '#ffff00', 'Apex')
    }
    if (landingPoint) {
      this.drawMarker(landingPoint.x * width, landingPoint.y * height, '#ff0000', 'Landing')
    }

    return this.ctx.getImageData(0, 0, width, height)
  }

  private drawTracer(
    trajectory: TrajectoryPoint[],
    currentTime: number,
    _startTime: number,
    _endTime: number,
    style: TracerStyle,
    width: number,
    height: number
  ): void {
    if (trajectory.length < 2) return

    // Filter points up to current time
    const visiblePoints = trajectory.filter(p => p.timestamp <= currentTime)
    if (visiblePoints.length < 2) return

    // Apply glow effect if enabled
    if (style.glowEnabled && style.glowColor && style.glowRadius) {
      this.ctx.save()
      this.ctx.shadowColor = style.glowColor
      this.ctx.shadowBlur = style.glowRadius
      this.ctx.strokeStyle = style.glowColor
      this.ctx.lineWidth = style.lineWidth + 2
      this.ctx.lineCap = 'round'
      this.ctx.lineJoin = 'round'

      this.ctx.beginPath()
      this.ctx.moveTo(visiblePoints[0].x * width, visiblePoints[0].y * height)
      for (let i = 1; i < visiblePoints.length; i++) {
        this.ctx.lineTo(visiblePoints[i].x * width, visiblePoints[i].y * height)
      }
      this.ctx.stroke()
      this.ctx.restore()
    }

    // Draw main tracer line
    this.ctx.strokeStyle = style.color
    this.ctx.lineWidth = style.lineWidth
    this.ctx.lineCap = 'round'
    this.ctx.lineJoin = 'round'

    this.ctx.beginPath()
    this.ctx.moveTo(visiblePoints[0].x * width, visiblePoints[0].y * height)
    for (let i = 1; i < visiblePoints.length; i++) {
      this.ctx.lineTo(visiblePoints[i].x * width, visiblePoints[i].y * height)
    }
    this.ctx.stroke()

    // Draw ball indicator at current position
    if (visiblePoints.length > 0) {
      const lastPoint = visiblePoints[visiblePoints.length - 1]
      this.ctx.beginPath()
      this.ctx.arc(lastPoint.x * width, lastPoint.y * height, style.lineWidth * 2, 0, Math.PI * 2)
      this.ctx.fillStyle = style.color
      this.ctx.fill()
    }
  }

  private drawMarker(x: number, y: number, color: string, _label: string): void {
    // Draw circle marker
    this.ctx.beginPath()
    this.ctx.arc(x, y, 8, 0, Math.PI * 2)
    this.ctx.strokeStyle = color
    this.ctx.lineWidth = 2
    this.ctx.stroke()

    // Draw crosshair
    this.ctx.beginPath()
    this.ctx.moveTo(x - 12, y)
    this.ctx.lineTo(x + 12, y)
    this.ctx.moveTo(x, y - 12)
    this.ctx.lineTo(x, y + 12)
    this.ctx.stroke()
  }
}
