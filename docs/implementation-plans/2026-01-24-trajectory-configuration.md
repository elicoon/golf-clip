# Trajectory Configuration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add user-configurable trajectory generation with target/landing point marking and shot characteristic controls.

**Architecture:** Two-step marking flow (target → landing) with three dropdown controls (starting line, shot shape, shot height). Backend generates Bezier-based trajectory constrained to hit both endpoints with appropriate curve. Fixes bug where clicks were blocked by trajectory canvas.

**Tech Stack:** React + TypeScript frontend, FastAPI + Python backend, quadratic Bezier curves for trajectory math.

---

## Task 1: Add Trajectory Config Enums to Backend Schemas

**Files:**
- Modify: `src/backend/api/schemas.py:189` (after FeedbackType enum)

**Step 1: Add the three new enums**

Add after line 194 (after `FALSE_POSITIVE = "false_positive"`):

```python
class StartingLine(str, Enum):
    """Starting line direction relative to target."""
    LEFT = "left"
    CENTER = "center"
    RIGHT = "right"


class ShotShape(str, Enum):
    """Shot shape (curve direction)."""
    HOOK = "hook"
    DRAW = "draw"
    STRAIGHT = "straight"
    FADE = "fade"
    SLICE = "slice"


class ShotHeight(str, Enum):
    """Shot height (apex level)."""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
```

**Step 2: Verify import works**

Run: `cd /Users/ecoon/golf-clip/src && python -c "from backend.api.schemas import StartingLine, ShotShape, ShotHeight; print('OK')"`

Expected: `OK`

**Step 3: Commit**

```bash
git add src/backend/api/schemas.py
git commit -m "feat(api): add trajectory config enums for starting line, shot shape, shot height"
```

---

## Task 2: Add Bezier Trajectory Generator to Tracker

**Files:**
- Modify: `src/backend/detection/tracker.py`
- Test: `src/backend/tests/test_bezier_trajectory.py` (create)

**Step 1: Write the failing test**

Create `src/backend/tests/test_bezier_trajectory.py`:

```python
"""Test Bezier-based trajectory generation with full configuration."""

import pytest
from backend.detection.tracker import ConstrainedBallTracker


class TestGenerateConfiguredTrajectory:
    """Tests for generate_configured_trajectory method."""

    def test_trajectory_starts_at_origin(self):
        """First point should be at origin."""
        tracker = ConstrainedBallTracker()
        result = tracker.generate_configured_trajectory(
            origin=(0.5, 0.85),
            target=(0.5, 0.3),
            landing=(0.55, 0.80),
            starting_line="center",
            shot_shape="straight",
            shot_height="medium",
            strike_time=10.0,
        )

        assert result is not None
        first = result["points"][0]
        assert abs(first["x"] - 0.5) < 0.01
        assert abs(first["y"] - 0.85) < 0.01

    def test_trajectory_ends_at_landing(self):
        """Last point should be exactly at landing."""
        tracker = ConstrainedBallTracker()
        result = tracker.generate_configured_trajectory(
            origin=(0.5, 0.85),
            target=(0.5, 0.3),
            landing=(0.6, 0.75),
            starting_line="center",
            shot_shape="straight",
            shot_height="medium",
            strike_time=10.0,
        )

        last = result["points"][-1]
        assert abs(last["x"] - 0.6) < 0.001
        assert abs(last["y"] - 0.75) < 0.001

    def test_draw_curves_left(self):
        """Draw shot should curve left (negative x offset at apex)."""
        tracker = ConstrainedBallTracker()
        straight = tracker.generate_configured_trajectory(
            origin=(0.5, 0.85),
            target=(0.5, 0.3),
            landing=(0.5, 0.80),
            starting_line="center",
            shot_shape="straight",
            shot_height="medium",
            strike_time=10.0,
        )
        draw = tracker.generate_configured_trajectory(
            origin=(0.5, 0.85),
            target=(0.5, 0.3),
            landing=(0.5, 0.80),
            starting_line="center",
            shot_shape="draw",
            shot_height="medium",
            strike_time=10.0,
        )

        # Find midpoint of each trajectory
        straight_mid = straight["points"][len(straight["points"]) // 2]
        draw_mid = draw["points"][len(draw["points"]) // 2]

        # Draw should be left of straight (lower x)
        assert draw_mid["x"] < straight_mid["x"]

    def test_high_shot_has_higher_apex(self):
        """High shot should have lower y value at apex (higher on screen)."""
        tracker = ConstrainedBallTracker()
        low = tracker.generate_configured_trajectory(
            origin=(0.5, 0.85),
            target=(0.5, 0.3),
            landing=(0.5, 0.80),
            starting_line="center",
            shot_shape="straight",
            shot_height="low",
            strike_time=10.0,
        )
        high = tracker.generate_configured_trajectory(
            origin=(0.5, 0.85),
            target=(0.5, 0.3),
            landing=(0.5, 0.80),
            starting_line="center",
            shot_shape="straight",
            shot_height="high",
            strike_time=10.0,
        )

        # Find min y (apex) for each
        low_apex_y = min(p["y"] for p in low["points"])
        high_apex_y = min(p["y"] for p in high["points"])

        # High shot apex should be lower y (higher on screen)
        assert high_apex_y < low_apex_y

    def test_flight_duration_varies_by_height(self):
        """Flight duration should be 3s/4.5s/6s for low/medium/high."""
        tracker = ConstrainedBallTracker()

        for height, expected_duration in [("low", 3.0), ("medium", 4.5), ("high", 6.0)]:
            result = tracker.generate_configured_trajectory(
                origin=(0.5, 0.85),
                target=(0.5, 0.3),
                landing=(0.5, 0.80),
                starting_line="center",
                shot_shape="straight",
                shot_height=height,
                strike_time=10.0,
            )
            assert abs(result["flight_duration"] - expected_duration) < 0.1
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/ecoon/golf-clip/src && python -m pytest backend/tests/test_bezier_trajectory.py -v`

Expected: FAIL with `AttributeError: 'ConstrainedBallTracker' object has no attribute 'generate_configured_trajectory'`

**Step 3: Implement generate_configured_trajectory**

Add to `src/backend/detection/tracker.py` after `_generate_constrained_trajectory` method (around line 1620):

```python
    def generate_configured_trajectory(
        self,
        origin: Tuple[float, float],
        target: Tuple[float, float],
        landing: Tuple[float, float],
        starting_line: str,
        shot_shape: str,
        shot_height: str,
        strike_time: float,
    ) -> Optional[dict]:
        """Generate trajectory using Bezier curve with full configuration.

        Args:
            origin: Ball origin (x, y) in normalized coords (0-1)
            target: Target point (x, y) where golfer was aiming
            landing: Landing point (x, y) where ball actually landed
            starting_line: "left", "center", or "right"
            shot_shape: "hook", "draw", "straight", "fade", or "slice"
            shot_height: "low", "medium", or "high"
            strike_time: When ball was struck (seconds)

        Returns:
            Trajectory dict with points, apex_point, landing_point, etc.
        """
        origin_x, origin_y = origin
        target_x, target_y = target
        landing_x, landing_y = landing

        # Flight duration by height
        duration_map = {"low": 3.0, "medium": 4.5, "high": 6.0}
        flight_duration = duration_map.get(shot_height, 4.5)

        # Apex height (screen y, lower = higher on screen)
        # These are absolute y values, not relative
        apex_y_map = {"low": 0.55, "medium": 0.35, "high": 0.15}
        apex_y = apex_y_map.get(shot_height, 0.35)

        # Curve offset for shot shape (perpendicular to flight line)
        # Negative = curves left (draw/hook), positive = curves right (fade/slice)
        curve_offset_map = {
            "hook": -0.12,
            "draw": -0.06,
            "straight": 0.0,
            "fade": 0.06,
            "slice": 0.12,
        }
        curve_offset = curve_offset_map.get(shot_shape, 0.0)

        # Starting line offset (angle adjustment)
        # For simplicity, we adjust the control point x position
        start_offset_map = {"left": -0.05, "center": 0.0, "right": 0.05}
        start_offset = start_offset_map.get(starting_line, 0.0)

        # Calculate control point for quadratic Bezier
        # Control point x: midpoint + curve offset + starting line influence
        mid_x = (origin_x + landing_x) / 2

        # Perpendicular direction for curve
        dx = landing_x - origin_x
        dy = landing_y - origin_y
        length = np.sqrt(dx**2 + dy**2) if (dx != 0 or dy != 0) else 1.0
        perp_x = -dy / length  # Perpendicular vector (rotated 90 degrees)

        control_x = mid_x + curve_offset + start_offset + perp_x * curve_offset * 0.5
        control_y = apex_y

        # Generate points using quadratic Bezier
        # B(t) = (1-t)²P₀ + 2(1-t)tP₁ + t²P₂
        sample_rate = 30.0
        num_points = int(flight_duration * sample_rate)
        points = []
        apex_idx = 0
        min_y = origin_y

        for i in range(num_points + 1):
            t = i / num_points

            x = (1 - t) ** 2 * origin_x + 2 * (1 - t) * t * control_x + t ** 2 * landing_x
            y = (1 - t) ** 2 * origin_y + 2 * (1 - t) * t * control_y + t ** 2 * landing_y

            # Clamp to valid range
            x = max(0.0, min(1.0, x))
            y = max(0.0, min(1.0, y))

            if y < min_y:
                min_y = y
                apex_idx = len(points)

            points.append({
                "timestamp": strike_time + (t * flight_duration),
                "x": x,
                "y": y,
                "confidence": 0.90,
                "interpolated": True,
            })

        # Ensure exact endpoints
        if points:
            points[0]["x"] = origin_x
            points[0]["y"] = origin_y
            points[-1]["x"] = landing_x
            points[-1]["y"] = landing_y

        if len(points) < 2:
            return None

        apex_point = {
            "timestamp": points[apex_idx]["timestamp"],
            "x": points[apex_idx]["x"],
            "y": points[apex_idx]["y"],
        }

        logger.info(
            f"Generated Bezier trajectory: {len(points)} points, "
            f"origin=({origin_x:.3f}, {origin_y:.3f}), "
            f"landing=({landing_x:.3f}, {landing_y:.3f}), "
            f"apex_y={min_y:.3f}, shape={shot_shape}, height={shot_height}"
        )

        return {
            "points": points,
            "apex_point": apex_point,
            "landing_point": {
                "timestamp": points[-1]["timestamp"],
                "x": landing_x,
                "y": landing_y,
            },
            "confidence": 0.90,
            "method": "bezier_configured",
            "starting_line": starting_line,
            "shot_shape": shot_shape,
            "shot_height": shot_height,
            "flight_duration": flight_duration,
        }
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/ecoon/golf-clip/src && python -m pytest backend/tests/test_bezier_trajectory.py -v`

Expected: All 5 tests PASS

**Step 5: Commit**

```bash
git add src/backend/detection/tracker.py src/backend/tests/test_bezier_trajectory.py
git commit -m "feat(tracker): add Bezier-based trajectory generation with shot config"
```

---

## Task 3: Update API Endpoint for New Parameters

**Files:**
- Modify: `src/backend/api/routes.py:1282-1490`
- Test: `src/backend/tests/test_trajectory_generate_sse.py` (update)

**Step 1: Update the generate endpoint signature**

In `src/backend/api/routes.py`, update the `generate_trajectory_sse` function (around line 1282):

```python
@router.get("/trajectory/{job_id}/{shot_id}/generate")
async def generate_trajectory_sse(
    job_id: str,
    shot_id: int,
    landing_x: float = Query(..., ge=0, le=1, description="Landing X coordinate (0-1)"),
    landing_y: float = Query(..., ge=0, le=1, description="Landing Y coordinate (0-1)"),
    target_x: float = Query(..., ge=0, le=1, description="Target X coordinate (0-1)"),
    target_y: float = Query(..., ge=0, le=1, description="Target Y coordinate (0-1)"),
    starting_line: str = Query("center", description="Starting line: left, center, right"),
    shot_shape: str = Query("straight", description="Shot shape: hook, draw, straight, fade, slice"),
    shot_height: str = Query("medium", description="Shot height: low, medium, high"),
):
```

**Step 2: Update the trajectory generation call inside event_generator**

Find the call to `tracker.track_with_landing_point` (around line 1417) and replace with:

```python
            # Step 3: Generate trajectory with full configuration
            yield sse_event("progress", {
                "step": "generating",
                "progress": 25,
                "message": "Generating trajectory..."
            })

            # Normalize origin
            origin_normalized = (origin.x / frame_width, origin.y / frame_height)

            # Run trajectory generation in executor
            trajectory_result = await loop.run_in_executor(
                None,
                lambda: tracker.generate_configured_trajectory(
                    origin=origin_normalized,
                    target=(target_x, target_y),
                    landing=(landing_x, landing_y),
                    starting_line=starting_line,
                    shot_shape=shot_shape,
                    shot_height=shot_height,
                    strike_time=strike_time,
                )
            )
```

**Step 3: Run server and verify endpoint accepts new params**

Run: `cd /Users/ecoon/golf-clip/src && timeout 3 uvicorn backend.main:app --host 127.0.0.1 --port 8420 || true`

Then in another terminal: `curl -s "http://127.0.0.1:8420/docs" | grep -o "target_x" | head -1`

Expected: `target_x`

**Step 4: Commit**

```bash
git add src/backend/api/routes.py
git commit -m "feat(api): update trajectory generate endpoint with target point and shot config params"
```

---

## Task 4: Fix Click Propagation in TrajectoryEditor

**Files:**
- Modify: `src/frontend/src/components/TrajectoryEditor.tsx:223-238,283-303`

**Step 1: Update handlePointerDown to propagate unhandled clicks**

In `TrajectoryEditor.tsx`, update the `handlePointerDown` callback:

```typescript
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
```

**Step 2: Add onClick handler that propagates through**

Add a new prop and handler. Update the props interface:

```typescript
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
  targetPoint?: { x: number; y: number } | null  // NEW
  onCanvasClick?: (x: number, y: number) => void  // NEW - for click passthrough
}
```

Update destructuring:

```typescript
export function TrajectoryEditor({
  videoRef,
  trajectory,
  currentTime,
  onTrajectoryUpdate,
  disabled = false,
  showTracer = true,
  landingPoint,
  targetPoint,  // NEW
  onCanvasClick,  // NEW
}: TrajectoryEditorProps) {
```

**Step 3: Add canvas onClick handler**

Add after `handlePointerLeave`:

```typescript
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
```

Update the canvas element to use onClick:

```typescript
  return (
    <canvas
      ref={canvasRef}
      width={canvasSize.width}
      height={canvasSize.height}
      className="trajectory-canvas"
      onClick={handleClick}  // ADD THIS
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
        touchAction: 'none',
      }}
    />
  )
```

**Step 4: Verify TypeScript compiles**

Run: `cd /Users/ecoon/golf-clip/src/frontend && npm run build 2>&1 | head -20`

Expected: No TypeScript errors related to TrajectoryEditor

**Step 5: Commit**

```bash
git add src/frontend/src/components/TrajectoryEditor.tsx
git commit -m "fix(frontend): propagate canvas clicks for target/landing marking"
```

---

## Task 5: Add Target Point Marker Rendering

**Files:**
- Modify: `src/frontend/src/components/TrajectoryEditor.tsx:176-203`

**Step 1: Add target marker drawing function**

Add after the landing marker drawing code (around line 203), inside the useEffect:

```typescript
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
      // Vertical line
      ctx.beginPath()
      ctx.moveTo(markerX, markerY - circleRadius - crosshairExtend)
      ctx.lineTo(markerX, markerY - circleRadius + 4)
      ctx.moveTo(markerX, markerY + circleRadius - 4)
      ctx.lineTo(markerX, markerY + circleRadius + crosshairExtend)
      ctx.stroke()

      // Horizontal line
      ctx.beginPath()
      ctx.moveTo(markerX - circleRadius - crosshairExtend, markerY)
      ctx.lineTo(markerX - circleRadius + 4, markerY)
      ctx.moveTo(markerX + circleRadius - 4, markerY)
      ctx.lineTo(markerX + circleRadius + crosshairExtend, markerY)
      ctx.stroke()

      ctx.restore()
    }
```

**Step 2: Update landing marker to arrow-to-ground design**

Replace the existing landing marker code (lines 177-202) with:

```typescript
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
```

**Step 3: Update useEffect dependencies**

Update the dependency array to include `targetPoint`:

```typescript
  }, [localPoints, currentTime, canvasSize, showTracer, disabled, trajectory?.apex_point, hoveredPoint, draggingPoint, landingPoint, targetPoint])
```

**Step 4: Verify build**

Run: `cd /Users/ecoon/golf-clip/src/frontend && npm run build 2>&1 | head -20`

Expected: Build succeeds

**Step 5: Commit**

```bash
git add src/frontend/src/components/TrajectoryEditor.tsx
git commit -m "feat(frontend): add target crosshair marker and update landing arrow marker"
```

---

## Task 6: Add Two-Step Marking Flow to ClipReview

**Files:**
- Modify: `src/frontend/src/components/ClipReview.tsx`

**Step 1: Add new state variables**

After the existing landing point state (around line 65), add:

```typescript
  // Target point marking state
  const [targetPoint, setTargetPoint] = useState<{x: number, y: number} | null>(null)

  // Marking step: 'target' -> 'landing' -> 'configure'
  type MarkingStep = 'target' | 'landing' | 'configure'
  const [markingStep, setMarkingStep] = useState<MarkingStep>('target')

  // Trajectory configuration
  const [startingLine, setStartingLine] = useState<'left' | 'center' | 'right'>('center')
  const [shotShape, setShotShape] = useState<'hook' | 'draw' | 'straight' | 'fade' | 'slice'>('straight')
  const [shotHeight, setShotHeight] = useState<'low' | 'medium' | 'high'>('medium')
```

**Step 2: Update reset effect when shot changes**

Update the useEffect that resets landing point (around line 97):

```typescript
  // Reset marking state when shot changes
  useEffect(() => {
    setTargetPoint(null)
    setLandingPoint(null)
    setMarkingStep('target')
    setStartingLine('center')
    setShotShape('straight')
    setShotHeight('medium')
    setTrajectoryProgress(null)
    setTrajectoryMessage('')
    setDetectionWarnings([])
    setTrajectoryError(null)
  }, [currentShot?.id])
```

**Step 3: Update handleVideoClick for two-step marking**

Replace `handleVideoClick` (around line 479):

```typescript
  const handleCanvasClick = useCallback((x: number, y: number) => {
    if (loadingState === 'loading' || trajectoryProgress !== null) return

    if (markingStep === 'target') {
      setTargetPoint({ x, y })
      setMarkingStep('landing')
    } else if (markingStep === 'landing') {
      setLandingPoint({ x, y })
      setMarkingStep('configure')
      // Generate trajectory with current config
      generateTrajectoryWithConfig(x, y)
    }
  }, [loadingState, trajectoryProgress, markingStep])
```

**Step 4: Add trajectory generation with config**

Add new function after `generateTrajectorySSE`:

```typescript
  const generateTrajectoryWithConfig = useCallback((landingX: number, landingY: number) => {
    if (!targetPoint || !currentShot) return

    // Cancel previous connection if any
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
    }

    setTrajectoryProgress(0)
    setTrajectoryMessage('Starting...')
    setDetectionWarnings([])
    setTrajectoryError(null)

    const params = new URLSearchParams({
      landing_x: landingX.toString(),
      landing_y: landingY.toString(),
      target_x: targetPoint.x.toString(),
      target_y: targetPoint.y.toString(),
      starting_line: startingLine,
      shot_shape: shotShape,
      shot_height: shotHeight,
    })

    const url = `http://127.0.0.1:8420/api/trajectory/${jobId}/${currentShot.id}/generate?${params}`
    const eventSource = new EventSource(url)
    eventSourceRef.current = eventSource

    eventSource.addEventListener('progress', (e) => {
      const data = JSON.parse(e.data)
      setTrajectoryProgress(data.progress)
      setTrajectoryMessage(data.message || '')
    })

    eventSource.addEventListener('warning', (e) => {
      const data = JSON.parse(e.data)
      setDetectionWarnings(prev => [...prev, data.message])
    })

    eventSource.addEventListener('complete', (e) => {
      const data = JSON.parse(e.data)
      setTrajectory(data.trajectory)
      setTrajectoryProgress(null)
      setTrajectoryMessage('')
      eventSource.close()
      eventSourceRef.current = null
    })

    eventSource.addEventListener('error', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data)
        setTrajectoryError(data.error || 'Failed to generate trajectory')
      } catch {
        setTrajectoryError('Connection lost during trajectory generation')
      }
      setTrajectoryProgress(null)
      eventSource.close()
      eventSourceRef.current = null
    })

    eventSource.onerror = () => {
      setTrajectoryError('Connection lost during trajectory generation')
      setTrajectoryProgress(null)
      eventSource.close()
      eventSourceRef.current = null
    }
  }, [jobId, currentShot?.id, targetPoint, startingLine, shotShape, shotHeight])
```

**Step 5: Add regenerate when config changes**

Add useEffect to regenerate trajectory when config changes:

```typescript
  // Regenerate trajectory when config changes (only if already in configure step)
  useEffect(() => {
    if (markingStep === 'configure' && landingPoint && targetPoint) {
      generateTrajectoryWithConfig(landingPoint.x, landingPoint.y)
    }
  }, [startingLine, shotShape, shotHeight])  // Intentionally not including generateTrajectoryWithConfig
```

**Step 6: Commit partial progress**

```bash
git add src/frontend/src/components/ClipReview.tsx
git commit -m "feat(frontend): add two-step marking flow state and trajectory config"
```

---

## Task 7: Add UI Controls for Trajectory Config

**Files:**
- Modify: `src/frontend/src/components/ClipReview.tsx` (continue from Task 6)

**Step 1: Update clearLandingPoint to clear all marking state**

Replace `clearLandingPoint`:

```typescript
  const clearMarking = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }

    setTargetPoint(null)
    setLandingPoint(null)
    setMarkingStep('target')
    setTrajectory(null)
    setTrajectoryProgress(null)
    setTrajectoryMessage('')
    setDetectionWarnings([])
    setTrajectoryError(null)
  }, [])
```

**Step 2: Add instruction banner component**

Add before the video container (around line 673):

```typescript
      {/* Instruction banner */}
      <div className="marking-instruction">
        {markingStep === 'target' && (
          <>
            <span className="step-badge">Step 1</span>
            <span>Click where you were aiming (the target)</span>
          </>
        )}
        {markingStep === 'landing' && (
          <>
            <span className="step-badge">Step 2</span>
            <span>Click where the ball actually landed</span>
          </>
        )}
        {markingStep === 'configure' && (
          <>
            <span className="step-badge">Step 3</span>
            <span>Adjust trajectory settings below</span>
          </>
        )}
      </div>
```

**Step 3: Update video container cursor and click handling**

Update the video container div:

```typescript
      <div
        className={`video-container ${!videoLoaded ? 'video-loading' : ''}`}
        style={{ cursor: markingStep !== 'configure' ? 'crosshair' : 'default' }}
      >
```

**Step 4: Update TrajectoryEditor props**

Update the TrajectoryEditor component:

```typescript
        <TrajectoryEditor
          videoRef={videoRef}
          trajectory={trajectory}
          currentTime={currentTime}
          showTracer={showTracer}
          disabled={trajectoryProgress !== null}
          landingPoint={landingPoint}
          targetPoint={targetPoint}
          onCanvasClick={handleCanvasClick}
          onTrajectoryUpdate={(points) => {
            if (!currentShot) return
            fetch(`http://127.0.0.1:8420/api/trajectory/${jobId}/${currentShot.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ points }),
            }).catch((err) => console.error('Failed to save trajectory:', err))
          }}
        />
```

**Step 5: Add trajectory config controls**

Replace the landing-point-section div (around line 784):

```typescript
      {/* Trajectory configuration section */}
      <div className="trajectory-config-section">
        {trajectoryProgress !== null ? (
          <div className="trajectory-progress">
            <div className="progress-header">
              Generating tracer... {trajectoryProgress}%
            </div>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${trajectoryProgress}%` }}
              />
            </div>
            <div className="progress-message">{trajectoryMessage}</div>
          </div>
        ) : markingStep === 'configure' ? (
          <div className="trajectory-controls">
            <div className="control-row">
              <label>Starting line:</label>
              <div className="button-group">
                {(['left', 'center', 'right'] as const).map((value) => (
                  <button
                    key={value}
                    className={`btn-option ${startingLine === value ? 'active' : ''}`}
                    onClick={() => setStartingLine(value)}
                  >
                    {value.charAt(0).toUpperCase() + value.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div className="control-row">
              <label>Shot shape:</label>
              <div className="button-group">
                {(['hook', 'draw', 'straight', 'fade', 'slice'] as const).map((value) => (
                  <button
                    key={value}
                    className={`btn-option ${shotShape === value ? 'active' : ''}`}
                    onClick={() => setShotShape(value)}
                  >
                    {value.charAt(0).toUpperCase() + value.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div className="control-row">
              <label>Shot height:</label>
              <div className="button-group">
                {(['low', 'medium', 'high'] as const).map((value) => (
                  <button
                    key={value}
                    className={`btn-option ${shotHeight === value ? 'active' : ''}`}
                    onClick={() => setShotHeight(value)}
                  >
                    {value.charAt(0).toUpperCase() + value.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <button className="btn-clear" onClick={clearMarking}>
              Start Over
            </button>
          </div>
        ) : (
          <div className="marking-status">
            {targetPoint && (
              <div className="marked-point">
                <span className="marker-icon">⊕</span>
                <span>Target: ({targetPoint.x.toFixed(2)}, {targetPoint.y.toFixed(2)})</span>
              </div>
            )}
            {landingPoint && (
              <div className="marked-point">
                <span className="marker-icon">▼</span>
                <span>Landing: ({landingPoint.x.toFixed(2)}, {landingPoint.y.toFixed(2)})</span>
              </div>
            )}
            {(targetPoint || landingPoint) && (
              <button className="btn-clear" onClick={clearMarking}>
                Clear
              </button>
            )}
          </div>
        )}

        {trajectoryError && (
          <div className="trajectory-error">
            <span>⚠️ {trajectoryError}</span>
          </div>
        )}

        {detectionWarnings.length > 0 && (
          <div className="detection-warnings">
            {detectionWarnings.map((warning, i) => (
              <div key={i} className="warning-item">
                <span className="warning-icon">⚠</span>
                <span>{warning}</span>
              </div>
            ))}
          </div>
        )}
      </div>
```

**Step 6: Update Next button condition**

Update the Next button disabled condition:

```typescript
          disabled={loadingState === 'loading' || trajectoryProgress !== null || markingStep !== 'configure'}
          title={markingStep !== 'configure' ? "Complete trajectory setup first" : "Next (Enter)"}
```

**Step 7: Verify build**

Run: `cd /Users/ecoon/golf-clip/src/frontend && npm run build 2>&1 | head -30`

Expected: Build succeeds

**Step 8: Commit**

```bash
git add src/frontend/src/components/ClipReview.tsx
git commit -m "feat(frontend): add trajectory config UI controls and instruction banners"
```

---

## Task 8: Add CSS Styles for New UI Elements

**Files:**
- Modify: `src/frontend/src/index.css` or appropriate CSS file

**Step 1: Find the CSS file**

Run: `ls -la /Users/ecoon/golf-clip/src/frontend/src/*.css`

**Step 2: Add styles for new elements**

Add to the CSS file:

```css
/* Marking instruction banner */
.marking-instruction {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: rgba(59, 130, 246, 0.1);
  border: 1px solid rgba(59, 130, 246, 0.3);
  border-radius: 8px;
  margin-bottom: 12px;
  font-size: 14px;
}

.step-badge {
  background: #3b82f6;
  color: white;
  padding: 4px 10px;
  border-radius: 4px;
  font-weight: 600;
  font-size: 12px;
}

/* Trajectory config section */
.trajectory-config-section {
  padding: 16px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
  margin-top: 12px;
}

.trajectory-controls {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.control-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.control-row label {
  min-width: 100px;
  font-size: 13px;
  color: #a0a0a0;
}

.button-group {
  display: flex;
  gap: 4px;
}

.btn-option {
  padding: 6px 12px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: transparent;
  color: #e0e0e0;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-option:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.3);
}

.btn-option.active {
  background: #3b82f6;
  border-color: #3b82f6;
  color: white;
}

.marking-status {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.marked-point {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #a0a0a0;
}

.marker-icon {
  font-size: 14px;
}

.btn-clear {
  padding: 6px 12px;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #a0a0a0;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
}

.btn-clear:hover {
  background: rgba(255, 255, 255, 0.05);
  color: #e0e0e0;
}
```

**Step 3: Verify build**

Run: `cd /Users/ecoon/golf-clip/src/frontend && npm run build`

Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/frontend/src/*.css
git commit -m "style(frontend): add CSS for trajectory config UI"
```

---

## Task 9: Integration Test

**Files:**
- Test manually in browser

**Step 1: Start backend**

Run: `cd /Users/ecoon/golf-clip/src && uvicorn backend.main:app --host 127.0.0.1 --port 8420 --reload &`

**Step 2: Start frontend**

Run: `cd /Users/ecoon/golf-clip/src/frontend && npm run dev &`

**Step 3: Test the flow**

1. Open http://localhost:5173
2. Upload a test video
3. When review screen appears, verify:
   - "Step 1: Click where you were aiming" instruction shows
   - Clicking on video places target marker (crosshair with circle)
   - Instruction changes to "Step 2: Click where ball landed"
   - Clicking again places landing marker (arrow to ground)
   - Trajectory generates automatically
   - Config controls appear (starting line, shot shape, shot height)
   - Changing config regenerates trajectory
   - "Start Over" button resets marking state
   - "Next" button works when trajectory is complete

**Step 4: Verify bugs are fixed**

- Bug 0: Can click immediately after video loads (no need to play)
- Bug 1: Trajectory endpoint exactly matches landing marker position

**Step 5: Run backend tests**

Run: `cd /Users/ecoon/golf-clip/src && python -m pytest backend/tests/test_bezier_trajectory.py backend/tests/test_track_with_landing.py -v`

Expected: All tests pass

**Step 6: Final commit**

```bash
git add -A
git commit -m "test: verify trajectory configuration integration"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Add enums to schemas | schemas.py |
| 2 | Add Bezier trajectory generator | tracker.py, test_bezier_trajectory.py |
| 3 | Update API endpoint | routes.py |
| 4 | Fix click propagation | TrajectoryEditor.tsx |
| 5 | Add marker rendering | TrajectoryEditor.tsx |
| 6 | Add two-step marking flow | ClipReview.tsx |
| 7 | Add config UI controls | ClipReview.tsx |
| 8 | Add CSS styles | index.css |
| 9 | Integration testing | Manual |

Total: 9 tasks, ~8 commits
