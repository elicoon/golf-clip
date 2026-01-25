# Trajectory Configuration Design

**Date:** 2026-01-24
**Status:** Ready for implementation

## Overview

This design adds user-configurable trajectory generation with explicit target and landing point marking, plus shot characteristic controls (starting line, shot shape, shot height). It also fixes two existing bugs.

## Bug Fixes

### Bug 0: Can't select landing point until video plays

**Problem:** Users must play the video before they can click to mark landing point.

**Root cause:** State check in `handleVideoClick` or related logic that prevents interaction before playback.

**Fix:** Allow clicking on video as soon as `videoLoaded` is true, regardless of playback state. Remove any dependency on `isPlaying` for click handling.

### Bug 1: Trajectory ends below landing point (vertical line issue)

**Problem:** The generated trajectory's endpoint doesn't match the user-marked landing point. A vertical line connects them, indicating a discontinuity.

**Root cause:** In `_generate_constrained_trajectory`, the physics model computes a parabola that naturally lands at `origin_y` (same height as start), then forces `points[-1]` to the landing coordinates. This creates a visual disconnect because the curve doesn't actually pass through the landing point.

**Fix:** Rewrite the trajectory math to solve for a parabola that is constrained to pass through BOTH the origin point AND the landing point. The parabola equation must satisfy:
- `y(0) = origin_y`
- `y(T) = landing_y`
- `x(0) = origin_x`
- `x(T) = landing_x`
- `y'(t_apex) = 0` (apex at specified time)

## New Feature: Trajectory Configuration

### User Flow

1. User sees shot at impact frame with video playback controls
2. **Step 1 - Mark Target:** Instruction banner shows "**Step 1:** Click where you were aiming (the target)". User clicks on video to mark target point.
3. **Step 2 - Mark Landing:** Instruction banner shows "**Step 2:** Click where the ball actually landed". User clicks to mark landing point.
4. **Step 3 - Configure Shot:** Dropdown controls appear for trajectory parameters:
   - Starting line: Left / Center / Right
   - Shot shape: Hook / Draw / Straight / Fade / Slice
   - Shot height: Low / Medium / High
5. Trajectory generates automatically using all constraints
6. User can re-click markers or change dropdowns to regenerate
7. User clicks "Next →" to confirm or "Skip Shot" to reject

### Visual Markers

#### Target Marker (Crosshair with Circle)

```
      |
   ╱──┼──╲
  │   |   │
──┼───────┼──
  │   |   │
   ╲──┼──╱
      |
```

- White circle with crosshair lines extending beyond
- Classic scope/reticle appearance
- Subtle glow for visibility
- Size: ~24px radius

#### Landing Marker (Arrow to Ground)

```
    ▼
────────
```

- Downward-pointing triangle/arrow
- Horizontal line beneath (representing ground)
- Arrow tip touches the line
- White with glow effect
- Size: ~20px wide

### Trajectory Parameters

#### Starting Line

Describes where the ball starts relative to the target line (origin → target vector):

| Option | Behavior |
|--------|----------|
| Left | Initial direction rotated ~8° left of target line |
| Center | Initial direction straight at target |
| Right | Initial direction rotated ~8° right of target line |

#### Shot Shape

Describes how the ball curves during flight:

| Option | Curve | Description |
|--------|-------|-------------|
| Hook | Severe R→L | Ball curves hard left (RH golfer) |
| Draw | Gentle R→L | Ball curves gently left |
| Straight | None | No lateral curve |
| Fade | Gentle L→R | Ball curves gently right |
| Slice | Severe L→R | Ball curves hard right |

The curve is implemented using a quadratic Bezier with a control point offset perpendicular to the start→end line:
- Hook: -15% offset
- Draw: -7% offset
- Straight: 0% offset
- Fade: +7% offset
- Slice: +15% offset

#### Shot Height

Describes how high the ball travels (apex position):

| Option | Apex Y | Flight Duration | Use Case |
|--------|--------|-----------------|----------|
| Low | 60-70% from top | 3.0 seconds | Punch shots, stingers |
| Medium | 35-50% from top | 4.5 seconds | Standard iron shots |
| High | 10-25% from top | 6.0 seconds | Wedges, high draws |

Note: "% from top" means screen Y coordinate where 0% = top of frame, 100% = bottom.

### Trajectory Generation Algorithm

Given:
- `origin`: (x₀, y₀) - auto-detected ball position at impact
- `target`: (xₜ, yₜ) - user-marked aiming point
- `landing`: (xₗ, yₗ) - user-marked landing point
- `starting_line`: left | center | right
- `shot_shape`: hook | draw | straight | fade | slice
- `shot_height`: low | medium | high

**Step 1: Compute target line and initial direction**

```python
target_vector = normalize(target - origin)
starting_angle_offset = {left: -8°, center: 0°, right: +8°}
initial_direction = rotate(target_vector, starting_angle_offset[starting_line])
```

**Step 2: Determine flight parameters**

```python
flight_duration = {low: 3.0, medium: 4.5, high: 6.0}[shot_height]
apex_ratio = {low: 0.35, medium: 0.45, high: 0.50}[shot_height]  # when apex occurs
apex_height_normalized = {low: 0.65, medium: 0.42, high: 0.18}[shot_height]  # screen Y
```

**Step 3: Compute Bezier control point for curve**

```python
midpoint = (origin + landing) / 2
perpendicular = rotate(normalize(landing - origin), 90°)
curve_offset = {hook: -0.15, draw: -0.07, straight: 0, fade: 0.07, slice: 0.15}
control_lateral = midpoint + perpendicular * curve_offset[shot_shape] * distance(origin, landing)
control_point = (control_lateral.x, apex_height_normalized)
```

**Step 4: Generate trajectory using quadratic Bezier**

```python
for t in range(0, flight_duration, 1/30):
    progress = t / flight_duration
    # Quadratic Bezier: B(t) = (1-t)²P₀ + 2(1-t)tP₁ + t²P₂
    x = (1-progress)² * origin.x + 2*(1-progress)*progress * control.x + progress² * landing.x
    y = (1-progress)² * origin.y + 2*(1-progress)*progress * control.y + progress² * landing.y
    points.append({x, y, timestamp: strike_time + t})
```

This approach guarantees:
- Trajectory starts exactly at origin
- Trajectory ends exactly at landing point
- Curve shape matches selected shot shape
- Apex height matches selected shot height

## API Changes

### Updated Endpoint: `GET /api/trajectory/{job_id}/{shot_id}/generate`

**New Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| landing_x | float | Yes | Landing X coordinate (0-1) |
| landing_y | float | Yes | Landing Y coordinate (0-1) |
| target_x | float | Yes | Target X coordinate (0-1) |
| target_y | float | Yes | Target Y coordinate (0-1) |
| starting_line | string | No | "left", "center" (default), "right" |
| shot_shape | string | No | "hook", "draw", "straight" (default), "fade", "slice" |
| shot_height | string | No | "low", "medium" (default), "high" |

**Response:** Same SSE format as before, with trajectory data in `complete` event.

## File Changes

### Frontend

#### `src/frontend/src/components/ClipReview.tsx`

- Add state: `targetPoint`, `markingStep` ('target' | 'landing' | 'configure')
- Update `handleVideoClick` to handle two-step marking
- Remove play-state dependency for clicking
- Add instruction banner component
- Add trajectory config dropdowns (starting line, shot shape, shot height)
- Update SSE URL to include new parameters

#### `src/frontend/src/components/TrajectoryEditor.tsx`

- Update `landingPoint` marker to arrow-to-ground design
- Add `targetPoint` prop and crosshair-circle marker rendering
- Both markers rendered in canvas with glow effects

### Backend

#### `src/backend/api/routes.py`

- Update `generate_trajectory_sse` to accept new query parameters
- Pass parameters to tracker

#### `src/backend/api/schemas.py`

- Add enums: `StartingLine`, `ShotShape`, `ShotHeight`
- Update trajectory-related schemas if needed

#### `src/backend/detection/tracker.py`

- Add new method: `generate_configured_trajectory(origin, target, landing, starting_line, shot_shape, shot_height, strike_time)`
- Implement Bezier-based trajectory generation
- Remove or deprecate old constrained trajectory method

## UI Mockup (ASCII)

```
┌─────────────────────────────────────────────────────────┐
│  Review Shot #1                              1 of 3     │
├─────────────────────────────────────────────────────────┤
│  [Skip Shot]                              [Next →]      │
├─────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────────┐  │
│  │  Step 1: Click where you were aiming (the target) │  │
│  └───────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────┐  │
│  │                                                   │  │
│  │                    ⊕ (target)                     │  │
│  │                                                   │  │
│  │           ~~~~~~~~trajectory~~~~~~~~              │  │
│  │                                                   │  │
│  │                              ▼                    │  │
│  │                           ────── (landing)        │  │
│  │                                                   │  │
│  │                 ● (origin - auto-detected)        │  │
│  │                                                   │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  ══════════════════●════════════════════════ (scrubber) │
│                                                         │
│  [⏪] [◀] [▶ Play] [▶] [⏩]                              │
│                                                         │
│  ┌─────────────────────────────────────────────────────┐│
│  │ Starting line: [Left] [•Center] [Right]             ││
│  │ Shot shape:    [Hook][Draw][•Straight][Fade][Slice] ││
│  │ Shot height:   [Low] [•Medium] [High]               ││
│  └─────────────────────────────────────────────────────┘│
│                                                         │
│  [✓] Show Tracer    [✓] Render Shot Tracers            │
└─────────────────────────────────────────────────────────┘
```

## Testing Plan

1. **Bug 0:** Verify clicking works immediately after video loads, before playing
2. **Bug 1:** Verify trajectory endpoint exactly matches landing marker position
3. **Two-step marking:** Verify target → landing flow with clear instructions
4. **Parameter changes:** Verify trajectory regenerates when dropdowns change
5. **Visual markers:** Verify crosshair-circle (target) and arrow-line (landing) render correctly
6. **Shot shapes:** Verify hook/slice produce visible curves in correct direction
7. **Shot heights:** Verify low/medium/high produce different apex heights
8. **Edge cases:** Very short distances, landing above origin, extreme angles

## Future Considerations

- Save trajectory config to database for export with tracer
- Default values based on club type (if detected)
- Preset combinations (e.g., "Power Fade" = Right + Fade + Low)
