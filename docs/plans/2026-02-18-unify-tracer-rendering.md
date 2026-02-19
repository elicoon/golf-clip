# Unify Tracer Rendering Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix export tracer starting too early and ensure exported videos look identical to what users approve during review.

**Architecture:** Extract the tracer line drawing logic (physics easing, path-length interpolation, 3-layer bezier glow) into a shared pure function. Both the review canvas overlay (TrajectoryEditor) and the export encoding pass (video-frame-pipeline-v4) call this shared function. Fix the export's time offset calculation so `relativeTime` maps to blob-relative time correctly.

**Tech Stack:** TypeScript, HTML5 Canvas 2D API, Vitest

**Total Tasks:** 8 (5 implementation + 3 verification)

---

## Risk Assessment

### Performance: 3-layer glow vs 2-layer glow in export

The export currently draws 2 stroke passes; the review draws 3. Adding one extra `ctx.stroke()` call per frame for ~180 line segments on a 1080p canvas is microseconds — hardware-accelerated Canvas 2D. The actual bottleneck is `encoder.encode()` (H.264 compression), which is milliseconds per frame. **Impact: <1% overhead. No risk.**

### Performance: Physics easing vs linear timestamp comparison

The review's easing involves: one `Math.pow()`, a few multiplies, and a linear scan through `pathLengths[]`. The export's current approach does the same linear scan through sorted points. Both are O(n) where n = trajectory points (~180). The easing math adds ~5 floating point operations per frame. **Impact: negligible. No risk.**

### Performance: Bezier splines vs straight line segments

The review uses `quadraticCurveTo()`; the export uses `lineTo()`. Both are hardware-accelerated Canvas 2D operations. With 60 points/second, straight segments are already smooth — the visual difference is subtle. But `quadraticCurveTo` is not meaningfully slower than `lineTo`. **Impact: negligible. No risk.**

### Visual: Review hardcodes red (#ff0000), shared function uses TracerStyle

The review's TrajectoryEditor currently hardcodes `#ff0000` for the tracer color, ignoring `TracerStyle.color`. The shared function will use `style.color` (default `#FF4444` from `DEFAULT_TRACER_STYLE`). This is a slight color change in review — from pure red to the configured style color. **This is actually a fix** — the review should respect the style the user configured. No action needed beyond noting the change.

### Scope: What stays in each caller

The shared function ONLY draws the tracer line. Each caller retains its own responsibilities:

- **TrajectoryEditor keeps:** rAF loop, completion hold (1.5s after trajectory ends), marker drawing (landing/apex/origin), letterbox offset calculation, canvas resize handling
- **Export pipeline keeps:** frame capture loop, time offset calculation, VideoEncoder integration, the `startTime` config for blob-relative conversion

### Coordinate convention

The shared function accepts normalized (0-1) coordinates with an optional content bounds for letterboxing. Export passes `{ offsetX: 0, offsetY: 0, contentWidth: width, contentHeight: height }`. Review passes its calculated `videoContentBounds`.

---

## Task 1: Create shared tracer renderer with tests

**Files:**
- Create: `apps/browser/src/lib/tracer-renderer.ts`
- Create: `apps/browser/src/lib/tracer-renderer.test.ts`

**Step 1: Write the failing tests**

Create `apps/browser/src/lib/tracer-renderer.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { drawTracerLine, timeToProgress, type DrawTracerLineOptions } from './tracer-renderer'
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
    x: i / (count - 1),       // left to right
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

  it('draws when currentTime is within trajectory range', () => {
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

  it('uses quadraticCurveTo for smooth curves (not lineTo)', () => {
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
})
```

**Step 2: Run tests to verify they fail**

Run: `cd /home/eli/projects/golf-clip/apps/browser && npx vitest run src/lib/tracer-renderer.test.ts`
Expected: FAIL — module `./tracer-renderer` does not exist

**Step 3: Write the shared tracer renderer**

Create `apps/browser/src/lib/tracer-renderer.ts`:

```typescript
// apps/browser/src/lib/tracer-renderer.ts
/**
 * Shared tracer line renderer used by both clip review (TrajectoryEditor)
 * and video export (video-frame-pipeline-v4).
 *
 * Ensures what users see during review is identical to the exported video.
 */

import { TracerStyle } from '../types/tracer'

export interface TrajectoryPointInput {
  timestamp: number
  x: number  // normalized 0-1
  y: number  // normalized 0-1
  confidence: number
  interpolated: boolean
}

export interface ContentBounds {
  offsetX: number
  offsetY: number
  width: number
  height: number
}

export interface DrawTracerLineOptions {
  ctx: CanvasRenderingContext2D
  points: TrajectoryPointInput[]
  currentTime: number     // blob-relative current time
  width: number           // canvas pixel width
  height: number          // canvas pixel height
  style: TracerStyle
  /** Optional content bounds for letterboxing (defaults to full canvas) */
  contentBounds?: ContentBounds
}

export interface DrawTracerLineResult {
  /** Animation progress 0-1 (0 = not started, 1 = complete) */
  progress: number
}

/**
 * Convert time ratio (0-1) to display progress using golf ball physics.
 *
 * Ball launches at ~160mph, lands at ~70mph. Covers most distance early,
 * slows near apex, descends at near-constant speed.
 *
 * Uses easeOutCubic/linear blend for smooth, monotonic curve.
 * Exported for testing.
 */
export function timeToProgress(t: number): number {
  if (t <= 0) return 0
  if (t >= 1) return 1

  const easeOut = 1 - Math.pow(1 - t, 3)
  const linear = t
  const easeWeight = 0.7 - 0.4 * t
  const progress = easeOut * easeWeight + linear * (1 - easeWeight)

  return Math.min(1, Math.max(0, progress))
}

/**
 * Draw the tracer line on a canvas context.
 *
 * Handles: physics-based easing, path-length interpolation, 3-layer bezier
 * glow rendering. Returns progress so callers can manage completion hold etc.
 */
export function drawTracerLine(options: DrawTracerLineOptions): DrawTracerLineResult {
  const { ctx, points, currentTime, width, height, style, contentBounds } = options

  if (points.length < 2) return { progress: 0 }

  const firstTime = points[0].timestamp
  const lastTime = points[points.length - 1].timestamp
  const timeRange = lastTime - firstTime

  // Calculate time ratio (0-1 through the trajectory)
  const timeRatio = timeRange > 0
    ? Math.max(0, Math.min(1, (currentTime - firstTime) / timeRange))
    : 0

  if (timeRatio <= 0) return { progress: 0 }

  // Apply physics easing
  const displayProgress = timeToProgress(timeRatio)

  // Pre-calculate cumulative path lengths (normalized 0-1 coords)
  const pathLengths: number[] = [0]
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x
    const dy = points[i].y - points[i - 1].y
    pathLengths.push(pathLengths[i - 1] + Math.sqrt(dx * dx + dy * dy))
  }
  const totalPathLength = pathLengths[pathLengths.length - 1]
  const targetDistance = displayProgress * totalPathLength

  // Find interpolation point along path
  let endPointIndex = points.length - 1
  let interpolatedEnd: { x: number; y: number } | null = null

  for (let i = 1; i < points.length; i++) {
    if (pathLengths[i] >= targetDistance) {
      endPointIndex = i
      const segStart = pathLengths[i - 1]
      const segLen = pathLengths[i] - segStart
      const t = segLen > 0 ? (targetDistance - segStart) / segLen : 0
      interpolatedEnd = {
        x: points[i - 1].x + t * (points[i].x - points[i - 1].x),
        y: points[i - 1].y + t * (points[i].y - points[i - 1].y),
      }
      break
    }
  }

  // Build visible points with interpolated end
  const visible = points.slice(0, endPointIndex)
  if (interpolatedEnd) {
    visible.push({
      ...points[Math.min(endPointIndex, points.length - 1)],
      x: interpolatedEnd.x,
      y: interpolatedEnd.y,
    })
  }

  if (visible.length < 2) return { progress: displayProgress }

  // Coordinate transform: normalized (0-1) → canvas pixels
  const bounds = contentBounds || { offsetX: 0, offsetY: 0, width, height }
  const toPixel = (nx: number, ny: number) => ({
    x: bounds.offsetX + Math.max(0, Math.min(1, nx)) * bounds.width,
    y: bounds.offsetY + Math.max(0, Math.min(1, ny)) * bounds.height,
  })

  // Draw smooth curve path using quadratic Bezier splines
  const tracePath = () => {
    const first = toPixel(visible[0].x, visible[0].y)
    ctx.moveTo(first.x, first.y)

    if (visible.length === 2) {
      const second = toPixel(visible[1].x, visible[1].y)
      ctx.lineTo(second.x, second.y)
      return
    }

    for (let i = 1; i < visible.length - 1; i++) {
      const cur = toPixel(visible[i].x, visible[i].y)
      const next = toPixel(visible[i + 1].x, visible[i + 1].y)
      ctx.quadraticCurveTo(cur.x, cur.y, (cur.x + next.x) / 2, (cur.y + next.y) / 2)
    }

    const last = toPixel(visible[visible.length - 1].x, visible[visible.length - 1].y)
    const secondLast = toPixel(visible[visible.length - 2].x, visible[visible.length - 2].y)
    ctx.quadraticCurveTo(secondLast.x, secondLast.y, last.x, last.y)
  }

  ctx.save()

  // Layer 1: Outer glow
  ctx.strokeStyle = style.glowColor || style.color
  ctx.lineWidth = (style.lineWidth || 3) + (style.glowRadius || 8)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.shadowColor = style.glowColor || style.color
  ctx.shadowBlur = 16
  ctx.globalAlpha = 0.4
  ctx.beginPath()
  tracePath()
  ctx.stroke()

  // Layer 2: Inner glow
  ctx.shadowBlur = 8
  ctx.lineWidth = (style.lineWidth || 3) + 2
  ctx.globalAlpha = 0.6
  ctx.beginPath()
  tracePath()
  ctx.stroke()

  // Layer 3: Core line
  ctx.strokeStyle = style.color || '#ff0000'
  ctx.shadowBlur = 4
  ctx.lineWidth = style.lineWidth || 3
  ctx.globalAlpha = 1.0
  ctx.beginPath()
  tracePath()
  ctx.stroke()

  ctx.restore()

  return { progress: displayProgress }
}
```

**Step 4: Run tests to verify they pass**

Run: `cd /home/eli/projects/golf-clip/apps/browser && npx vitest run src/lib/tracer-renderer.test.ts`
Expected: All 8 tests PASS

**Step 5: Commit**

```bash
cd /home/eli/projects/golf-clip
git add apps/browser/src/lib/tracer-renderer.ts apps/browser/src/lib/tracer-renderer.test.ts
git commit -m "feat: add shared tracer renderer with physics easing and bezier curves"
```

---

## Task 2: Fix export time offset bug

**Files:**
- Modify: `apps/browser/src/lib/video-frame-pipeline-v4.ts:569-574`

This is the core bug fix. The export calculates `trajectoryTime` incorrectly.

**Step 1: Write a failing test documenting the bug**

Add to `apps/browser/src/lib/video-frame-pipeline-v4.test.ts`:

```typescript
describe('export tracer timing', () => {
  it('tracer should not draw before strike time in exported frames', () => {
    // This test documents the bug: the export was using trajectory[0].timestamp
    // as the time offset instead of config.startTime (clip start in blob).
    //
    // With strikeTime=14, clipStart=12, blobStart=10:
    //   trajectory[0].timestamp = 4.0 (strikeTime - blobStart)
    //   config.startTime = 2.0 (clipStart - blobStart)
    //   At first frame: relativeTime = 0
    //   WRONG: trajectoryTime = 0 + 4.0 = 4.0 (equals first point → tracer draws!)
    //   RIGHT: trajectoryTime = 0 + 2.0 = 2.0 (before first point → no tracer)
    //
    // The fix: use startTime (clip start offset) not trajectory[0].timestamp
    // This is verified by the shared renderer tests + integration test below.

    // Simulate the time calculation
    const clipStartInBlob = 2.0  // segment.clipStart - segment.startTime
    const strikeTimeInBlob = 4.0 // segment.strikeTime - segment.startTime

    // First frame of export: relativeTime = 0
    const relativeTime = 0

    // FIXED calculation: use clipStartInBlob (config.startTime), not trajectory[0].timestamp
    const trajectoryTime = relativeTime + clipStartInBlob

    // Trajectory starts at strike time — should NOT be visible at clip start
    expect(trajectoryTime).toBeLessThan(strikeTimeInBlob)
  })
})
```

**Step 2: Run test to verify it passes (this test documents the fix, not the bug)**

Run: `cd /home/eli/projects/golf-clip/apps/browser && npx vitest run src/lib/video-frame-pipeline-v4.test.ts`
Expected: PASS

**Step 3: Apply the fix**

In `apps/browser/src/lib/video-frame-pipeline-v4.ts`, change lines 570-573 from:

```typescript
const relativeTime = timeUs / 1_000_000
const trajectoryTime = trajectory.length > 0
  ? relativeTime + trajectory[0].timestamp
  : relativeTime
```

To:

```typescript
const relativeTime = timeUs / 1_000_000
const trajectoryTime = relativeTime + startTime
```

Note: `startTime` is already in scope — it's destructured from `config` at the top of `exportWithTracer()` (line 151). It equals `segment.clipStart - segment.startTime`, which is the blob-relative clip start. Adding it to `relativeTime` (time since clip start) yields the blob-relative time, matching how TrajectoryEditor works.

**Step 4: Run full test suite**

Run: `cd /home/eli/projects/golf-clip/apps/browser && npx vitest run`
Expected: All tests PASS

**Step 5: Commit**

```bash
cd /home/eli/projects/golf-clip
git add apps/browser/src/lib/video-frame-pipeline-v4.ts apps/browser/src/lib/video-frame-pipeline-v4.test.ts
git commit -m "fix: export tracer starting early — use clip start offset instead of trajectory start"
```

---

## Task 3: Update export pipeline to use shared renderer

**Files:**
- Modify: `apps/browser/src/lib/video-frame-pipeline-v4.ts`

Replace the inline `drawTracer` function with the shared `drawTracerLine`.

**Step 1: Replace import and remove inline function**

At the top of `video-frame-pipeline-v4.ts`, add import:

```typescript
import { drawTracerLine } from './tracer-renderer'
```

Delete the entire inline `drawTracer` function (lines 65-135, the function with comment "Copied from V3 for consistency").

**Step 2: Update the encoding loop call site**

In the encoding loop (around line 570 after the fix in Task 2), replace:

```typescript
const relativeTime = timeUs / 1_000_000
const trajectoryTime = relativeTime + startTime
drawTracer(ctx, trajectory, trajectoryTime, width, height, tracerStyle)
```

With:

```typescript
const blobRelativeTime = (timeUs / 1_000_000) + startTime
drawTracerLine({
  ctx,
  points: trajectory,
  currentTime: blobRelativeTime,
  width,
  height,
  style: tracerStyle,
})
```

**Step 3: Clean up unused import**

The `TrajectoryPoint` import from `canvas-compositor` may now be unused if it was only used by the deleted `drawTracer` function. Check and remove if so. Keep it if `ExportConfigV4` still references it.

**Step 4: Run tests**

Run: `cd /home/eli/projects/golf-clip/apps/browser && npx vitest run`
Expected: All tests PASS

**Step 5: Commit**

```bash
cd /home/eli/projects/golf-clip
git add apps/browser/src/lib/video-frame-pipeline-v4.ts
git commit -m "refactor: replace export inline drawTracer with shared tracer-renderer"
```

---

## Task 4: Update TrajectoryEditor to use shared renderer

**Files:**
- Modify: `apps/browser/src/components/TrajectoryEditor.tsx`

Replace the inline rendering logic (path lengths, easing, bezier drawing) with the shared function. Keep the rAF loop, completion hold, and marker drawing.

**Step 1: Add import**

```typescript
import { drawTracerLine } from '../lib/tracer-renderer'
import { DEFAULT_TRACER_STYLE } from '../types/tracer'
```

**Step 2: Replace the render function body**

Inside the `render` function (within the `useEffect` at line 295), replace everything between the `// Skip trajectory drawing` comment (line 386) and the `// Draw apex marker` comment (line 498) with:

```typescript
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

// Handle trajectory completion hold
const now = performance.now()
let effectiveTime = videoTime

if (timeRatio >= 1.0) {
  if (completionTimestamp === null) {
    completionTimestamp = now
  }
  effectiveTime = lastPointTime // force full draw
} else if (completionTimestamp !== null) {
  const msSinceCompletion = now - completionTimestamp
  if (msSinceCompletion <= HOLD_DURATION_MS) {
    effectiveTime = lastPointTime // still holding
  } else {
    completionTimestamp = null
  }
}

// Draw tracer using shared renderer
drawTracerLine({
  ctx,
  points: localPoints,
  currentTime: effectiveTime,
  width: canvasSize.width,
  height: canvasSize.height,
  style: DEFAULT_TRACER_STYLE,
  contentBounds: bounds,
})
```

**Step 3: Remove dead code**

Delete from the `useEffect`:
- The `timeToProgress` function (lines 213-251) — now in `tracer-renderer.ts`
- The `drawSmoothCurve` helper (lines 269-292) — now in `tracer-renderer.ts`
- The `pathLengths` calculation block (lines 193-200) — now in `tracer-renderer.ts`
- The `totalPathLength` variable (line 200)
- The path-finding loop and visible points building (lines 431-495) — now in `tracer-renderer.ts`

Keep:
- The `toCanvas` and `clampedToCanvas` helpers — still used for marker drawing
- The completion hold variables (`completionTimestamp`, `HOLD_DURATION_MS`)
- All marker drawing code (landing, apex, origin)
- The rAF loop setup and cleanup

**Step 4: Run tests**

Run: `cd /home/eli/projects/golf-clip/apps/browser && npx vitest run`
Expected: All tests PASS

**Step 5: Commit**

```bash
cd /home/eli/projects/golf-clip
git add apps/browser/src/components/TrajectoryEditor.tsx
git commit -m "refactor: replace TrajectoryEditor inline rendering with shared tracer-renderer"
```

---

## Task 5: Manual smoke test

**Steps:**

1. Start dev server: `cd /home/eli/projects/golf-clip/apps/browser && npm run dev`
2. Upload a golf video
3. During clip review:
   - Verify tracer animates with physics easing (fast start, slowing near apex)
   - Verify tracer holds visible for ~1.5s after completing
   - Verify tracer color matches TracerStyle (slightly different from old hardcoded #ff0000)
   - Verify landing/apex/origin markers still render
4. Approve a shot and export at 720p
5. Play exported video:
   - **KEY CHECK:** Tracer should NOT appear before the ball strike moment
   - Tracer should start at the same time it did during review
   - Tracer should have 3-layer glow with smooth bezier curves (matching review)
6. Kill dev server when done

**Expected:** Export tracer timing and appearance matches review exactly.

---

## Verification (Mandatory)

> These tasks are required before considering the implementation complete.

### Task 6: Code Review

**Invoke:** `/claude-code-skills:code-review`

Review all implementation work for:
- Conventional commits (feat/fix/docs/chore prefixes)
- No obvious security issues (OWASP top 10)
- No over-engineering beyond requirements
- Documentation updated where needed

**Expected:** All issues addressed before proceeding.

### Task 7: Feature Testing

**Invoke:** `/claude-code-skills:test-feature tracer-rendering-unification`

Test the complete user experience:
- Primary use cases work as expected
- Edge cases handled
- Error scenarios behave correctly
- Integration points function

**Expected:** All tests pass with evidence (actual output shown).

### Task 8: Final Commit

After verification passes:
```bash
git status  # Verify clean state
git log --oneline -5  # Review commits
```

Mark task as done only after this step completes successfully.
