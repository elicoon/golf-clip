# Early Ball Detection & UI Improvements Design

**Date:** 2026-01-25
**Status:** Draft - Pending Approval

## Overview

This design covers two major improvements to the golf-clip shot tracer system:

1. **Improved Early Ball Detection** - Better detection of the ball in the first 0.5 seconds after impact using a layered approach: physics-guided search cones, color family matching, and multi-frame validation.

2. **UI Enhancements** - Add optional apex point marking and a visual status tracker showing which points have been set.

### Goals

- Reduce false negatives in early ball detection (prefer false positives that can be filtered)
- Support any ball color (white, orange, yellow, pink, green)
- Work with mixed backgrounds (sky, trees, overcast)
- Provide better launch parameters for physics-based trajectory generation
- Improve user experience with clear visual feedback on marking progress

### Non-Goals

- Real-time detection during recording
- Support for camera angles other than behind-the-golfer (down-the-line)
- Perfect frame-by-frame tracking (we're extracting trajectory characteristics, not pixel-perfect positions)

---

## Part 1: Early Ball Detection

### 1.1 Combined Detection Approach

The detection pipeline uses three layers working together:

```
┌─────────────────────────────────────────────────────────────────┐
│                    Layer 1: Physics-Guided Search               │
│         Constrains WHERE to look based on expected trajectory   │
├─────────────────────────────────────────────────────────────────┤
│                    Layer 2: Color Family Matching               │
│          Finds WHAT to look for based on ball template          │
├─────────────────────────────────────────────────────────────────┤
│                  Layer 3: Multi-Frame Validation                │
│         CONFIRMS detections by requiring consistency            │
└─────────────────────────────────────────────────────────────────┘
```

**Combined scoring formula:**

```python
final_score = (
    0.35 × color_match_score +      # How well it matches ball template
    0.25 × motion_score +           # Frame-to-frame brightness change
    0.25 × physics_score +          # How close to predicted position
    0.15 × consistency_score        # Multi-frame trajectory coherence
)
```

### 1.2 Cone Geometry and Physics Prediction

For behind-the-golfer (down-the-line) camera view, the ball moves mostly upward initially with minimal horizontal movement.

**Cone parameters by time:**

| Time (ms) | Vertical Range | Horizontal Range | Rationale |
|-----------|----------------|------------------|-----------|
| 0-100ms | 0-150px above | ±40px | Ball just launched, tight search |
| 100-250ms | 100-350px above | ±60px | Ball rising fast |
| 250-500ms | 250-600px above | ±100px | Ball higher, more drift possible |

**Physics-based position prediction:**

```python
# Simplified physics for behind-the-golfer view
elapsed_sec = frame_number / fps
initial_velocity_y = 400  # pixels/sec upward (tunable)
gravity = 300  # pixels/sec² (perspective-adjusted)

# Predicted vertical displacement (upward = negative Y in screen coords)
predicted_dy = initial_velocity_y * elapsed_sec - 0.5 * gravity * elapsed_sec²

# Horizontal drift (minimal for this camera angle)
predicted_dx = lateral_drift * elapsed_sec  # ±20 pixels max at 0.5s

# Search window expands with time
window_half_width = 40 + elapsed_sec * 120   # 40px → 100px over 0.5s
window_half_height = 50 + elapsed_sec * 100  # 50px → 100px over 0.5s
```

### 1.3 Template Extraction and Color Family Matching

**Template extraction timing:** 500ms before impact (golfer in backswing, ball unobstructed)

**Color space:** HSV (Hue-Saturation-Value) for robust matching

**Tolerance ranges:**

| Component | Tolerance | Rationale |
|-----------|-----------|-----------|
| Hue | ±20° | Color family stays consistent |
| Saturation | ±40% | Shadows/distance reduce saturation significantly |
| Value | ±50% | Lighting varies wildly frame-to-frame |

**Adaptive tolerance:** Widens as elapsed time increases (ball gets smaller/farther)

```python
time_factor = 1.0 + elapsed_sec * 0.5  # 1.0 → 1.25 over 0.5s

hue_tolerance = 20 * time_factor
sat_tolerance = 40 * time_factor
val_tolerance = 50 * time_factor
```

**Color families:**

| Ball Color | Hue Range | Notes |
|------------|-----------|-------|
| White | Any hue, Sat < 30% | Match on low saturation |
| Orange | 10° - 35° | Warm tones |
| Yellow | 40° - 70° | Bright/neon yellows |
| Pink | 310° - 360° or 0° - 10° | Magenta range |
| Green | 80° - 150° | Lime to forest |

**White ball handling:**

```python
if template_color.family == ColorFamily.WHITE:
    # White balls: low saturation, variable value
    # Can get darker (shadows) but shouldn't get more saturated
    if pixel_hsv[1] > 50 * time_factor:  # Too saturated to be white
        return 0.0

    # Score based on value similarity
    val_diff = abs(pixel_hsv[2] - template_color.value)
    score = 1.0 - (val_diff / (val_tolerance * 2.55))
    return max(0.0, score)
```

### 1.4 Multi-Frame Motion Validation

**Key principle:** Validate on DIRECTION consistency, not distance. Golf balls move fast (50-150+ pixels per frame).

**Movement constraints:**

```python
MIN_MOVEMENT = 10   # If it moved less, probably not the ball
MAX_MOVEMENT = 200  # Sanity check for extreme cases

# Direction: must be moving generally UPWARD
MIN_UPWARD_RATIO = 0.5  # At least 50% of movement should be upward
```

**Direction consistency:**

```python
def find_best_continuation(prev, candidates, track_history):
    for candidate in candidates:
        dx = candidate.x - prev.x
        dy = candidate.y - prev.y
        distance = math.sqrt(dx**2 + dy**2)

        # Distance sanity check (very permissive)
        if distance < MIN_MOVEMENT or distance > MAX_MOVEMENT:
            continue

        # Must be moving upward (dy < 0 in screen coords)
        if dy >= 0:
            continue

        # Check upward ratio
        upward_ratio = abs(dy) / (abs(dy) + abs(dx))
        if upward_ratio < MIN_UPWARD_RATIO:
            continue

        # Score based on direction consistency with track history
        # Allow up to ~25° deviation per frame
        ...
```

**Velocity validation:**

- Ball should generally decelerate (drag)
- Shouldn't speed up dramatically
- Direction changes limited to ~25° per frame max

### 1.5 Progressive Search Expansion

**Strategy:** Start tight, expand if nothing found. Prefer finding something over finding nothing.

**Expansion levels:**

| Level | Name | Width | Description |
|-------|------|-------|-------------|
| 0 | Tight | 1x (~50px) | Constraint-based corridor |
| 1 | Medium | 2x (~100px) | First expansion |
| 2 | Wide | 3x (~150px) | Second expansion |
| 3 | Maximum | 1/3 frame | Full vertical, centered on origin |

**Visual representation:**

```
Level 0 (tight):        Level 1 (2x):          Level 2 (3x):          Level 3 (maximum):

    ┌──┐                   ┌────┐                 ┌──────┐             ┌──────────────┐
    │  │                   │    │                 │      │             │              │
    │  │                   │    │                 │      │             │              │
    │  │                   │    │                 │      │             │              │
    └──┘                   └────┘                 └──────┘             │              │
     ⚪                      ⚪                      ⚪                 │      ⚪      │
  (~50px)                 (~100px)               (~150px)              └──────────────┘
                                                                        (1/3 width)
```

**Algorithm:**

```python
MIN_REQUIRED_DETECTIONS = 5

for level in range(4):
    # Detect at current expansion level
    candidates = detect_at_level(level)
    tracks = validate_tracks(candidates)

    if tracks:
        best_track = max(tracks, key=lambda t: t.confidence)
        if len(best_track.detections) >= MIN_REQUIRED_DETECTIONS:
            return best_track  # Good enough, stop here

        # Keep best result so far
        if best_track.confidence > best_confidence:
            best_result = best_track

    # Continue to next expansion level

return best_result  # Return best we found (may be partial)
```

**Threshold adjustment:** Wider searches use slightly stricter validation to filter additional noise.

### 1.6 Retroactive Detection Refinement

When user marks apex and landing, we can refine early detection using these constraints.

**The insight:** Once endpoints are known, we know the ball's path must connect:

```
Origin → (early detections) → Apex → Landing
```

**Refined corridor calculation:**

```python
def calculate_refined_search_corridor(
    origin, apex, landing, shot_shape, starting_line, shot_height,
    elapsed_sec, total_flight_time
):
    # Interpolate expected position based on known endpoints
    if apex and elapsed_sec <= apex_time:
        # Ascending: interpolate origin → apex
        t = elapsed_sec / apex_time
        expected_x = origin_x + (apex_x - origin_x) * ease_out(t)
        expected_y = origin_y + (apex_y - origin_y) * ease_out(t)
    else:
        # Descending: interpolate apex → landing
        ...

    # Apply shot shape curve offset
    curve_offset = {"hook": -0.08, "draw": -0.04, "straight": 0.0,
                    "fade": 0.04, "slice": 0.08}[shot_shape]

    # Apply starting line offset (affects early trajectory more)
    start_offset = {"left": -0.03, "center": 0.0, "right": 0.03}[starting_line]

    # Create tight window around expected position
    return (x1, y1, x2, y2)
```

---

## Part 2: UI Improvements

### 2.1 Apex Point Marking

**Updated marking flow:**

```
Step 1: Mark Target (where you aimed)     → crosshair icon ⊕
Step 2: Mark Landing (where ball landed)  → arrow icon ↓
Step 3: Mark Apex (optional, highest point) → diamond icon ◇
Step 4: Configure & Generate
```

**Apex marker visual (gold diamond):**

```typescript
// Diamond shape with gold glow
ctx.save()
ctx.shadowColor = 'rgba(255, 215, 0, 0.8)'  // Gold glow
ctx.shadowBlur = 8
ctx.fillStyle = '#ffd700'  // Gold color
ctx.strokeStyle = '#ffffff'
ctx.lineWidth = 2

ctx.beginPath()
ctx.moveTo(markerX, markerY - size)      // Top
ctx.lineTo(markerX + size, markerY)      // Right
ctx.lineTo(markerX, markerY + size)      // Bottom
ctx.lineTo(markerX - size, markerY)      // Left
ctx.closePath()
ctx.fill()
ctx.stroke()
ctx.restore()
```

**Skip option:** Apex is optional - user can skip to configure step.

**Backend: Apex-constrained trajectory:**

When apex is provided, generate trajectory using two quadratic Bezier segments:
- Segment 1: origin → apex (ascending)
- Segment 2: apex → landing (descending)

This ensures the trajectory passes exactly through the user-marked apex point.

### 2.2 Point Status Tracker

**Visual design:**

```
┌─────────────────────────────────────────────────────────────┐
│  ◉ Target    ◉ Landing    ○ Apex (optional)    ◉ Generate  │
└─────────────────────────────────────────────────────────────┘
   ✓ marked     ✓ marked      not set             ✓ ready
```

**States:**

| State | Visual | Meaning |
|-------|--------|---------|
| `pending` | Dimmed circle | Not yet reached in flow |
| `active` | Pulsing blue border | Currently marking this point |
| `complete` | Green checkmark | Point has been marked |
| `optional` | Dimmed, labeled "optional" | Can be skipped |
| `ready` | Green background | Ready to proceed |

**Component structure:**

```typescript
interface PointStatusTrackerProps {
  targetPoint: { x: number; y: number } | null
  landingPoint: { x: number; y: number } | null
  apexPoint: { x: number; y: number } | null
  markingStep: 'target' | 'landing' | 'apex' | 'configure'
  onClearPoint: (point: 'target' | 'landing' | 'apex') => void
}
```

**Features:**
- Click × button on completed items to clear and re-mark
- Clearing a point also clears subsequent points (clearing target clears landing and apex)
- Animated pulse on active step
- Connected by lines showing flow progression

---

## File Structure

**New files:**

```
src/backend/detection/
├── early_tracker.py       # EarlyBallTracker class
├── color_family.py        # Color template extraction & matching
└── search_expansion.py    # Progressive search expansion logic

src/frontend/src/components/
└── PointStatusTracker.tsx # Status tracker UI component
```

**Modified files:**

```
src/backend/detection/tracker.py      # Integration with early tracker
src/backend/api/routes.py             # New endpoint for refinement
src/frontend/src/components/
├── ClipReview.tsx                    # Add apex marking, status tracker
└── TrajectoryEditor.tsx              # Add apex marker rendering
```

---

## API Changes

**New endpoint:**

```
POST /api/trajectory/{job_id}/{shot_id}/refine-early-detection

Request body:
{
  "apex": {"x": 0.5, "y": 0.2} | null,
  "landing": {"x": 0.6, "y": 0.85},
  "shot_shape": "draw",
  "starting_line": "center",
  "shot_height": "medium",
  "flight_time": 3.0
}

Response:
{
  "detections": [
    {"timestamp": 18.25, "x": 1580, "y": 1750, "confidence": 0.85},
    ...
  ],
  "track_confidence": 0.78,
  "expansion_level_used": 1
}
```

**Updated trajectory generation endpoint:**

Add optional `apex_x` and `apex_y` query parameters to:
```
GET /api/trajectory/{job_id}/{shot_id}/generate
```

---

## Implementation Plan

### Phase 1: Core Detection (Backend)

1. Create `color_family.py` - Template extraction and HSV color matching
2. Create `search_expansion.py` - Progressive expansion strategy
3. Create `early_tracker.py` - Main EarlyBallTracker class
4. Update `tracker.py` - Integrate EarlyBallTracker
5. Add tests for color matching and track validation

### Phase 2: Retroactive Refinement (Backend)

1. Add refinement endpoint to `routes.py`
2. Implement constraint-based corridor calculation
3. Wire up progressive expansion with constraints
4. Add tests for refinement flow

### Phase 3: Apex Marking (Frontend + Backend)

1. Update `ClipReview.tsx` - Add apex marking step
2. Update `TrajectoryEditor.tsx` - Render apex marker
3. Update trajectory generation endpoint - Accept apex parameter
4. Implement apex-constrained Bezier in `tracker.py`

### Phase 4: Status Tracker (Frontend)

1. Create `PointStatusTracker.tsx` component
2. Add CSS styles for status states
3. Integrate into `ClipReview.tsx`
4. Test clear/re-mark functionality

### Phase 5: Integration & Polish

1. End-to-end testing with real videos
2. Tune detection thresholds based on test results
3. Performance optimization if needed
4. Documentation updates

---

## Success Criteria

1. **Detection rate:** ≥80% of shots have ≥5 early detections (up from current ~40%)
2. **False negative reduction:** Maximum expansion level used in <20% of cases
3. **UI clarity:** User can see marking progress at a glance
4. **Apex accuracy:** When marked, trajectory passes within 5% of apex point
5. **No regressions:** Existing shots that work well continue to work

---

## Design Decisions

1. **Expose confidence level:** Yes - show detection confidence and expansion level used to help users understand detection quality
2. **Apex marking visibility:** Enabled by default alongside other controls, with "(optional)" tag
3. **Detection trigger:** Only run detection after user clicks "Generate" button - no auto-detection. The Generate button is the sole trigger for the identification/detection process

---

## Appendix: Color Family Classification

```python
def classify_ball_color(hue: int, saturation: int, value: int) -> ColorFamily:
    """
    Classify ball into color family based on HSV values.

    Args:
        hue: 0-180 (OpenCV HSV range)
        saturation: 0-255
        value: 0-255

    Returns:
        ColorFamily enum value
    """
    # White ball: low saturation, high value
    if saturation < 30 and value > 150:
        return ColorFamily.WHITE

    # Gray/silver ball: low saturation, medium value
    if saturation < 40 and 80 < value <= 150:
        return ColorFamily.WHITE  # Treat as white family

    # Colored balls: classify by hue (OpenCV uses 0-180 range)
    if 5 <= hue <= 18:      # Orange
        return ColorFamily.ORANGE
    elif 20 <= hue <= 35:   # Yellow
        return ColorFamily.YELLOW
    elif 40 <= hue <= 75:   # Green
        return ColorFamily.GREEN
    elif 155 <= hue <= 180 or 0 <= hue < 5:  # Pink/Magenta
        return ColorFamily.PINK
    elif 100 <= hue <= 130: # Blue (rare but possible)
        return ColorFamily.BLUE
    else:
        return ColorFamily.OTHER
```
