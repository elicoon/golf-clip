# Constraint-Based Ball Tracking Design

**Date:** 2026-01-24
**Status:** Approved

## Problem

The current YOLO-based ball detection fails to track golf balls in flight because:
- Golf balls are small (~1% of frame width)
- Fast movement (150+ mph) causes motion blur
- YOLO's "sports ball" class is trained on larger balls (soccer, basketball)
- Detection confidence is only 3-7% even when successful

YOLO works well for stationary balls (on tee) but misses the ball during flight.

## Solution

Use domain knowledge and geometric constraints to track the ball:

1. **Ball Origin Detection** - Use multiple methods to find the ball before impact
2. **Trajectory Cone Constraints** - Limit where the ball can be post-impact
3. **Motion Detection** - Use frame differencing and optical flow instead of object classification

## Design

### Section 1: Ball Origin Detection

**Goal:** Find the ball's starting position before impact using shaft and clubhead detection.

**Status:** ✅ IMPLEMENTED AND WORKING

**Key Insight:** Ball position requires TWO separate detections:
- **X coordinate:** Center of the clubhead (where ball sits in front of face)
- **Y coordinate:** Center of the hosel/clubhead (ground level where ball sits)

**DO NOT** use percentage-based estimates from golfer dimensions - this was tried and produces inconsistent results.

**Implementation Pipeline:**

```
Frame at (strike_time - 2.5s)  # Address position before backswing
    │
    ├─→ YOLO Person Detection (conf > 0.3)
    │      → Get golfer bounding box (gx1, gy1, gx2, gy2)
    │      → gy2 = feet level (ground reference)
    │
    ├─→ Shaft Line Detection (LSD + Hough)
    │      → Search region: around golfer, extending right
    │      → Geometric constraints:
    │         • Grip end: within golfer bbox (gy1 <= grip_y <= gy2)
    │         • Clubhead end: near feet level (gy2 - 50 to gy2 + 10)
    │         • Shaft direction: upper-left to lower-right
    │         • Angle: 15-60° from horizontal
    │         • Hosel: maximum x-value point of line
    │      → Color analysis: shaft is darker than grass (avg brightness < 150)
    │      → Score threshold: 0.75 minimum
    │
    └─→ Clubhead Center Detection
           → Search region: 80px right of hosel, ±40px vertical
           → Color masks:
              • Bright + low saturation = metallic/white crown
              • Very dark (V < 60) = matte black clubhead
           → Find largest contour matching clubhead size (100-8000 area)
           → Centroid = clubhead center

    Final Ball Position:
    - ball_x = clubhead_center_x
    - ball_y = clubhead_center_y
```

**Test Results (IMG_0991.mov, 4K @ 60fps):**

| Shot | Strike Time | Ball Origin | Method | Shaft Score |
|------|-------------|-------------|--------|-------------|
| 1 | 18.25s | (1579, 1814) | shaft+clubhead | 0.96 |
| 2 | 60.28s | (2100, 1835) | shaft+clubhead | 0.96 |
| 3 | 111.46s | (1524, 1822) | shaft+clubhead | 0.92 |

**Class:** `BallOriginDetector` in `detection/origin.py`
- `detect_origin(video_path, strike_time, look_before=2.5) -> OriginDetection`
- `detect_origin_from_frame(frame) -> OriginDetection`

### Section 2: Trajectory Cone & Motion Detection

**Goal:** Track the ball post-impact using geometric constraints + motion detection.

**Trajectory Cone Logic:**

```
For each frame at time T after impact:

    elapsed = T - strike_time  # seconds since impact

    # Generous geometric narrowing
    # Start at 180°, narrow ~15° per 0.1s of flight
    base_angle = 180 - (elapsed * 150)  # degrees
    base_angle = max(base_angle, 30)    # never narrower than 30°

    # Cone is centered on "expected trajectory" (default: 45° up)
    # Forms a wedge from ball_origin upward
    cone_min_angle = 90 - (base_angle / 2)   # e.g., 0° at start
    cone_max_angle = 90 + (base_angle / 2)   # e.g., 180° at start

    # Adaptive refinement
    if detected_trajectory_angle is not None:
        # Narrow to ±15° around detected angle
        cone_min_angle = detected_trajectory_angle - 15
        cone_max_angle = detected_trajectory_angle + 15
```

**Motion Detection Pipeline:**

```
For each frame in cone region:
    1. Frame differencing: |frame[T] - frame[T-1]|
       → Threshold to find bright moving pixels
       → Filter to pixels within trajectory cone

    2. Optical flow (Lucas-Kanade):
       → Compute flow vectors for candidate pixels
       → Keep pixels with flow direction within cone angles
       → Require minimum velocity (ball moves fast)

    3. Cluster remaining candidates
       → Find the brightest, most consistent cluster
       → That's our ball position for this frame
```

### Section 3: Integration & Data Flow

**Modified Pipeline Flow:**

```
detect_shots() [existing - audio detection]
    │
    ▼
For each detected shot with strike_time:
    │
    ├─→ BallOriginDetector.detect_origin(video, strike_time)
    │      → Returns: origin_point (x, y), confidence
    │
    ├─→ ConstrainedBallTracker.track_flight(
    │        video,
    │        origin_point,
    │        strike_time,
    │        end_time=strike_time + 4s  # typical flight duration
    │    )
    │    │
    │    ├─→ For each frame: compute trajectory cone
    │    ├─→ Frame differencing within cone
    │    ├─→ Optical flow validation
    │    └─→ Returns: list[TrajectoryPoint]
    │
    └─→ Store trajectory in database (existing)
```

**New Classes:**

| Class | Location | Purpose |
|-------|----------|---------|
| `BallOriginDetector` | `detection/origin.py` | Multi-method ball origin detection |
| `ConstrainedBallTracker` | `detection/tracker.py` | Cone-constrained motion tracking |
| `TrajectoryConeSolver` | `detection/tracker.py` | Compute valid cone for each frame |

**Existing Code Changes:**
- `pipeline.py`: Call new tracker instead of `BallDetector.analyze_ball_flight()`
- Keep `BallDetector` for YOLO-based detection (used by origin detector)

### Section 4: Implementation Order & Testing

**Implementation Phases:**

```
Phase 1: Ball Origin Detection ✅ COMPLETE
├─ ✅ Implement BallOriginDetector class
├─ ✅ Shaft line detection with geometric constraints
├─ ✅ Clubhead center detection for accurate X/Y
├─ ✅ Test on 3 shots - all detected accurately
└─ ✅ Verify origin within 20px of actual ball position

Phase 2: Trajectory Cone (TODO)
├─ Implement TrajectoryConeSolver
├─ Add debug visualization (draw cone on frame)
└─ Verify cone correctly bounds ball in test videos

Phase 3: Motion Detection (TODO)
├─ Frame differencing within cone
├─ Optical flow validation
├─ Combine into ConstrainedBallTracker
└─ Test: should find ball in clips where YOLO failed

Phase 4: Integration (TODO)
├─ Wire into pipeline.py
├─ E2E test with full video processing
└─ Compare trajectory quality vs old YOLO-only approach
```

**Test Strategy:**

| Test | Purpose | Status |
|------|---------|--------|
| `test_origin_detection.py` | Verify ball found at clubhead center | ✅ Passing |
| `test_trajectory_cone.py` | Verify cone contains ball at each frame | TODO |
| `test_motion_tracker.py` | Verify motion detection finds ball | TODO |
| `test_integration.py` | E2E: audio → origin → tracking → trajectory | TODO |

**Success Criteria:**
- ✅ Origin detected within 20px of actual ball in 100% of test clips (3/3)
- Trajectory captured for clips where YOLO-only found 0 points
- Trajectory points stay within cone bounds

## Dependencies

- OpenCV (already installed) - for Hough lines, optical flow, frame differencing
- YOLO (already installed) - for person and ball detection
- NumPy (already installed) - for geometric calculations

No new dependencies required.
