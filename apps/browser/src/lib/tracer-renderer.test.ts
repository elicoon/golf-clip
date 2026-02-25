import { describe, it, expect, vi } from 'vitest'
import { drawTracerLine, timeToProgress } from './tracer-renderer'
import { DEFAULT_TRACER_STYLE } from '../types/tracer'

// ── timeToProgress (physics easing) ──

describe('timeToProgress', () => {
  it('returns 0 for t <= 0', () => {
    expect(timeToProgress(-0.5)).toBe(0)
    expect(timeToProgress(0)).toBe(0)
  })

  it('returns 1 for t >= 1', () => {
    expect(timeToProgress(1)).toBe(1)
    expect(timeToProgress(1.5)).toBe(1)
  })

  it('is monotonically increasing', () => {
    let prev = 0
    for (let t = 0.01; t <= 1.0; t += 0.01) {
      const val = timeToProgress(t)
      expect(val).toBeGreaterThanOrEqual(prev)
      prev = val
    }
  })

  it('progress > time in early phase (fast launch)', () => {
    // Ball moves fast early — progress should lead time
    expect(timeToProgress(0.1)).toBeGreaterThan(0.1)
    expect(timeToProgress(0.2)).toBeGreaterThan(0.2)
  })

  it('stays in [0, 1] for all inputs', () => {
    for (let t = -1; t <= 2; t += 0.05) {
      const val = timeToProgress(t)
      expect(val).toBeGreaterThanOrEqual(0)
      expect(val).toBeLessThanOrEqual(1)
    }
  })
})

// ── drawTracerLine ──

function createMockCtx(): CanvasRenderingContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    stroke: vi.fn(),
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt' as CanvasLineCap,
    lineJoin: 'miter' as CanvasLineJoin,
    shadowColor: '',
    shadowBlur: 0,
    globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D
}

function makePoints(startTime: number, flightTime: number, count: number = 10) {
  return Array.from({ length: count }, (_, i) => ({
    timestamp: startTime + (i / (count - 1)) * flightTime,
    x: i / (count - 1), // left to right
    y: 0.8 - 0.6 * Math.sin((i / (count - 1)) * Math.PI), // arc shape
    confidence: 1,
    interpolated: false,
  }))
}

describe('drawTracerLine', () => {
  it('does not draw when currentTime is before trajectory start', () => {
    const ctx = createMockCtx()
    const points = makePoints(4.0, 3.0) // trajectory starts at t=4

    drawTracerLine({
      ctx,
      points,
      currentTime: 2.0, // before trajectory starts
      width: 1920,
      height: 1080,
      style: DEFAULT_TRACER_STYLE,
    })

    // No stroke calls — nothing to draw
    expect(ctx.stroke).not.toHaveBeenCalled()
  })

  it('draws 3 layers when currentTime is within trajectory range', () => {
    const ctx = createMockCtx()
    const points = makePoints(4.0, 3.0)

    drawTracerLine({
      ctx,
      points,
      currentTime: 5.5, // midway through trajectory
      width: 1920,
      height: 1080,
      style: DEFAULT_TRACER_STYLE,
    })

    // Should have drawn 3 layers (outer glow, inner glow, core)
    expect(ctx.stroke).toHaveBeenCalledTimes(3)
  })

  it('draws full trajectory when currentTime is past end', () => {
    const ctx = createMockCtx()
    const points = makePoints(4.0, 3.0)

    drawTracerLine({
      ctx,
      points,
      currentTime: 10.0, // well past trajectory end
      width: 1920,
      height: 1080,
      style: DEFAULT_TRACER_STYLE,
    })

    expect(ctx.stroke).toHaveBeenCalledTimes(3)
  })

  it('uses quadraticCurveTo for smooth curves with enough points', () => {
    const ctx = createMockCtx()
    const points = makePoints(0, 3.0, 20) // enough points for curves

    drawTracerLine({
      ctx,
      points,
      currentTime: 3.0,
      width: 1920,
      height: 1080,
      style: DEFAULT_TRACER_STYLE,
    })

    expect(ctx.quadraticCurveTo).toHaveBeenCalled()
  })

  it('applies content bounds offset for letterboxing', () => {
    const ctx = createMockCtx()
    const points = makePoints(0, 1.0, 5)

    drawTracerLine({
      ctx,
      points,
      currentTime: 1.0,
      width: 1920,
      height: 1080,
      style: DEFAULT_TRACER_STYLE,
      contentBounds: { offsetX: 100, offsetY: 50, width: 1720, height: 980 },
    })

    // moveTo should be called with offset coordinates, not raw 0,0
    const moveToCall = (ctx.moveTo as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(moveToCall[0]).toBeGreaterThanOrEqual(100) // offsetX applied
  })

  it('does not draw with fewer than 2 points', () => {
    const ctx = createMockCtx()

    drawTracerLine({
      ctx,
      points: [{ timestamp: 0, x: 0.5, y: 0.5, confidence: 1, interpolated: false }],
      currentTime: 0,
      width: 100,
      height: 100,
      style: DEFAULT_TRACER_STYLE,
    })

    expect(ctx.stroke).not.toHaveBeenCalled()
  })

  it('does not draw with empty points array', () => {
    const ctx = createMockCtx()

    drawTracerLine({
      ctx,
      points: [],
      currentTime: 0,
      width: 100,
      height: 100,
      style: DEFAULT_TRACER_STYLE,
    })

    expect(ctx.stroke).not.toHaveBeenCalled()
  })

  it('returns progress value between 0 and 1', () => {
    const ctx = createMockCtx()
    const points = makePoints(4.0, 3.0)

    const result = drawTracerLine({
      ctx,
      points,
      currentTime: 5.5,
      width: 1920,
      height: 1080,
      style: DEFAULT_TRACER_STYLE,
    })

    expect(result.progress).toBeGreaterThan(0)
    expect(result.progress).toBeLessThanOrEqual(1)
  })

  it('returns progress 0 when currentTime is before trajectory', () => {
    const ctx = createMockCtx()
    const points = makePoints(4.0, 3.0)

    const result = drawTracerLine({
      ctx,
      points,
      currentTime: 2.0,
      width: 1920,
      height: 1080,
      style: DEFAULT_TRACER_STYLE,
    })

    expect(result.progress).toBe(0)
  })

  // Documents the export time offset fix:
  // In export, relativeTime = (currentVideoTime - clipStart), startTime = (clipStart - segmentStart)
  // So blobRelativeTime = relativeTime + startTime = currentVideoTime - segmentStart
  // Trajectory timestamps are also blob-relative (strikeTime - segmentStart + t * flightTime)
  // BUG was: using trajectory[0].timestamp (strikeOffset) instead of startTime (clipStart offset)
  it('does not draw tracer during pre-strike padding (export time offset)', () => {
    const ctx = createMockCtx()
    // Simulate: segmentStart=10, clipStart=16, strikeTime=18
    // startTime = clipStart - segmentStart = 6
    // trajectory starts at strikeOffset = strikeTime - segmentStart = 8
    const strikeOffset = 8
    const points = makePoints(strikeOffset, 3.0) // trajectory timestamps: 8.0 to 11.0

    // At relativeTime=0 (first frame of clip), blobRelativeTime = 0 + startTime = 6.0
    // This is BEFORE trajectory[0].timestamp (8.0), so NO tracer should draw
    const startTime = 6.0
    const relativeTime = 0
    const blobRelativeTime = relativeTime + startTime // = 6.0

    drawTracerLine({
      ctx,
      points,
      currentTime: blobRelativeTime,
      width: 1920,
      height: 1080,
      style: DEFAULT_TRACER_STYLE,
    })

    // No tracer at clip start — the ~2s padding before strike should be tracer-free
    expect(ctx.stroke).not.toHaveBeenCalled()
  })

  it('draws tracer after strike time in export (export time offset)', () => {
    const ctx = createMockCtx()
    // Same setup: strikeOffset=8, startTime=6
    const strikeOffset = 8
    const points = makePoints(strikeOffset, 3.0)

    // At relativeTime=3.0 (3s into clip), blobRelativeTime = 3 + 6 = 9.0
    // This is AFTER trajectory start (8.0), so tracer SHOULD draw
    const startTime = 6.0
    const relativeTime = 3.0
    const blobRelativeTime = relativeTime + startTime // = 9.0

    drawTracerLine({
      ctx,
      points,
      currentTime: blobRelativeTime,
      width: 1920,
      height: 1080,
      style: DEFAULT_TRACER_STYLE,
    })

    expect(ctx.stroke).toHaveBeenCalledTimes(3) // 3 glow layers
  })

  it('uses lineTo for 2-point trajectories (no curves needed)', () => {
    const ctx = createMockCtx()
    const points = makePoints(0, 1.0, 2)

    drawTracerLine({
      ctx,
      points,
      currentTime: 1.0,
      width: 100,
      height: 100,
      style: DEFAULT_TRACER_STYLE,
    })

    expect(ctx.lineTo).toHaveBeenCalled()
    expect(ctx.quadraticCurveTo).not.toHaveBeenCalled()
  })
})
